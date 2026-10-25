# Pagina dei lead in stile idealista: piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lista dei lead leggibile (schede grandi, filtri a sinistra, 25 per pagina), lead nuovi dell'ultimo giro evidenti e in cima, dettaglio in una finestra sopra la lista.

**Architecture:** La regola del "nuovo" diventa una funzione pura condivisa (`isNewLead`) usata dal server (conteggio del giro) e dalla parte web. Filtri, gruppo dei nuovi e paginazione restano logica pura in `apps/web/src/leads/filters.ts`. I componenti React cambiano disposizione: `LeadList` diventa colonna dei filtri più lista, `LeadRow` diventa una scheda grande e `LeadDetail` va dentro una nuova finestra `LeadModal`. Server e API restano come sono, tranne `newLeadsSince`.

**Tech Stack:** TypeScript, React 19 + Vite, Vitest + Testing Library, Playwright, Cloudflare Worker + D1.

**Spec:** `docs/superpowers/specs/2026-10-25-lead-stile-idealista-design.md`

## Global Constraints

- Testi dell'interfaccia in italiano. Nessuna libreria nuova (niente routing, niente UI kit).
- La parte web parla col server solo tramite `src/api.ts`. Il dettaglio resta su `/lead/<chiave>` (`src/router.ts`).
- Nessun dato nuovo salvato. `PRIVACY_VERSION` non cambia e nessuna migrazione.
- "Nuovo" = il più vecchio `firstSeenAt` del gruppo (`listing` + `others`, precedenti compresi) `>=` inizio dell'ultimo giro (in corso, altrimenti l'ultimo finito). Nessun giro, nessun nuovo.
- Stato `new` mostrato come **"Da lavorare"**. Il valore `new` nei dati resta.
- 25 lead per pagina. Soglia telefono/desktop: 900 px (`max-width: 899px`), come oggi.
- Colore dei nuovi: `--new: #0a8f4e; --new-soft: #e3f6ec;` (distinto da `--high` e `--brand`).
- Mantenere l'accessibilità di oggi: `role="tab"`, `aria-pressed`/`aria-checked` sui filtri, `aria-label="Apri il lead: <titolo>"` sui link della lista, `region` "Scheda del lead".

## Review Focus

- Lead aperto da indirizzo diretto (`/lead/<chiave>` ricaricato) che non è nella pagina corrente della lista: la finestra si apre comunque, senza la riga "Lead N di 25", e chiudendola si vede la lista alla pagina 1.
- Un filtro che riduce i lead mentre si è a pagina 5 di 8: si torna alla pagina 1, non a una pagina vuota.
- Nota scritta nella finestra e chiusura con Esc o clic fuori: la nota si salva come oggi alla chiusura con "← Lead".
- Giro che parte mentre la lista è aperta: i nuovi del giro precedente perdono il segno al primo aggiornamento di `/api/sweep`, senza ricaricare la pagina.
- Scheda "Richiami": niente gruppo dei nuovi (lì vale il raggruppamento per scadenza), ma la scritta "NUOVO" resta sulla scheda.

---

### Task 1: Regola condivisa del "nuovo", conteggio del giro e rinomina dello stato

**Files:**
- Modify: `packages/shared/src/core/lead-groups.ts` (accanto a `seenSince`, riga ~134)
- Modify: `packages/shared/src/core/leads.ts:13` (`STATUS_LABELS.new`)
- Modify: `apps/server/src/sweeps.ts:72-76` (`newLeadsSince`)
- Test: `packages/shared/tests/unit/core/lead-groups.test.ts`, `apps/server/test/runs.test.ts`

**Interfaces:**
- Produces: `isNewLead(v: LeadView, since: number | null): boolean` da `@homeradar/shared/core/lead-groups`. `STATUS_LABELS.new === 'Da lavorare'`.

- [ ] **Step 1: Test che falliscono** in `lead-groups.test.ts`. Costruisci i `LeadView` con gli helper già presenti nel file. Se mancano, un oggetto minimo con `listing.firstSeenAt` e `others[].listing.firstSeenAt`.

```ts
describe('isNewLead', () => {
  const T = 1_000_000;
  it('nuovo se tutto il gruppo è visto dopo l\'inizio del giro', () => {
    expect(isNewLead(view({ firstSeenAt: T }), T)).toBe(true);
    expect(isNewLead(view({ firstSeenAt: T + 5 }, [{ firstSeenAt: T + 9 }]), T)).toBe(true);
  });
  it('non nuovo se un annuncio del gruppo era già visto (altro portale o ripubblicato)', () => {
    expect(isNewLead(view({ firstSeenAt: T + 5 }, [{ firstSeenAt: T - 1 }]), T)).toBe(false);
    expect(isNewLead(view({ firstSeenAt: T - 1 }, [{ firstSeenAt: T + 5 }]), T)).toBe(false);
  });
  it('senza giro nessun nuovo', () => {
    expect(isNewLead(view({ firstSeenAt: T }), null)).toBe(false);
  });
});
```

- [ ] **Step 2:** `npm test -w packages/shared -- lead-groups`. Atteso: FAIL, `isNewLead` non esportata.
- [ ] **Step 3:** Implementa `isNewLead`: `since != null && Math.min(...firstSeenAt del gruppo) >= since`. Commento di una riga sulla regola (ripubblicati e nuovi portali non contano). `seenSince` resta se è ancora usata, altrimenti si toglie alla fine del task 3.
- [ ] **Step 4:** In `newLeadsSince` sostituisci il filtro con `isNewLead(v, since)` e togli `v.state.status === 'new'` (si contano i nuovi di qualunque stato, scelta della spec).
- [ ] **Step 5:** Test del server in `runs.test.ts`, nel `describe('fine del giro e avanzamento')`: un annuncio visto prima del giro, che viene riletto nel lotto, non conta.

```ts
it('newCount non conta gli annunci già visti prima del giro', async () => {
  await putListing({ portal: 'immobiliare', portalId: 50, firstSeenAt: Date.now() - 30 * HOUR, sweepScope: KEY });
  const plan = await start(a);
  await batch(a, plan.sweepId!, [50, 51]);
  await report(a, plan.sweepId!, 'complete');
  const { result } = (await (await finish(a, plan.sweepId!)).json()) as { result: SweepResult };
  expect(result.newCount).toBe(1);
});
```

Se `putListing` non accetta `firstSeenAt`, aggiungilo all'helper del test come gli altri campi.
- [ ] **Step 6:** `STATUS_LABELS.new = 'Da lavorare'`. Correggi i test che si aspettano "Nuovo" come stato (cerca `'Nuovo'` in `packages/shared/tests` e `apps/web/test`, in particolare l'esportazione).
- [ ] **Step 7:** `npm test -w packages/shared && npm test -w apps/server && npm run typecheck`. Atteso: tutto verde.
- [ ] **Step 8: Commit** `feat: regola condivisa dei lead nuovi; lo stato «Nuovo» diventa «Da lavorare»`

### Task 2: Filtri, gruppo dei nuovi e pagine (logica pura)

**Files:**
- Modify: `apps/web/src/leads/filters.ts`
- Test: `apps/web/test/filters.test.ts`

**Interfaces:**
- Consumes: `isNewLead` (task 1).
- Produces:
  - `LeadFilters.newOnly: boolean` al posto di `since`. `EMPTY_FILTERS.newOnly = false`. `TagKey`: `'newOnly'` al posto di `'since'`, etichetta `'Solo nuovi'`.
  - `filterLeads(leads, f, tab, zone, sortByTab, now, newSince: number | null): FilteredLeads`, con il nuovo ultimo parametro.
  - `FilteredLeads.newCount: number` (nuovi nella scheda, prima del filtro "Solo nuovi", per il conteggio della casella) e `FilteredLeads.newHead: number` (quanti dei primi `visible` sono il gruppo dei nuovi; sempre 0 nella scheda `recall`).
  - `TAB_LABELS.new = 'Da lavorare'`.
  - `export const PAGE_SIZE = 25;`
  - `export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; from: number; to: number }`. La pagina va da 1. Una pagina fuori intervallo viene riportata nell'intervallo, e se `items` è vuoto il risultato ha `pages: 1`. `from`/`to` partono da 1 per il testo "Lead 1–25 di 182" (`from: 0, to: 0` se vuoto).

- [ ] **Step 1: Test che falliscono** in `filters.test.ts`. Il helper `run` passa `newSince` come parametro opzionale, `null` per default.

```ts
const T = NOW - 3_600_000;
it('nelle schede di stato i nuovi stanno in cima, ognuno col suo ordinamento', () => {
  const leads = [
    lead({ key: 'subito:1', price: 100_000, firstSeenAt: T - 1 }),
    lead({ key: 'subito:2', price: 300_000, firstSeenAt: T + 1 }),
    lead({ key: 'subito:3', price: 200_000, firstSeenAt: T + 2 }),
    lead({ key: 'subito:4', price: 50_000, firstSeenAt: T - 1 }),
  ];
  const r = run(leads, {}, 'new', { ...DEFAULT_SORT_BY_TAB, new: 'price_asc' }, T);
  expect(keys(r)).toEqual(['subito:3', 'subito:2', 'subito:4', 'subito:1']);
  expect(r.newHead).toBe(2);
  expect(r.newCount).toBe(2);
});
it('Solo nuovi', () => {
  const r = run([lead({ key: 'subito:1', firstSeenAt: T + 1 }), lead({ key: 'subito:2', firstSeenAt: T - 1 })], { newOnly: true }, 'new', DEFAULT_SORT_BY_TAB, T);
  expect(keys(r)).toEqual(['subito:1']);
  expect(r.tags.map((t) => t.label)).toEqual(['Solo nuovi']);
});
it('un lead con un annuncio già visto non è nuovo', () => {
  const r = run([lead({ key: 'subito:1', firstSeenAt: T + 1, others: [source('idealista:2', { firstSeenAt: T - 1 })] })], {}, 'new', DEFAULT_SORT_BY_TAB, T);
  expect(r.newHead).toBe(0);
});
it('nella scheda Richiami niente gruppo dei nuovi', () => {
  const r = run([lead({ key: 'subito:1', firstSeenAt: T + 1, recallAt: today })], {}, 'recall', DEFAULT_SORT_BY_TAB, T);
  expect(r.newHead).toBe(0);
});
it('pagine da 25', () => {
  const xs = Array.from({ length: 60 }, (_, i) => i);
  expect(pageOf(xs, 1)).toMatchObject({ page: 1, pages: 3, from: 1, to: 25 });
  expect(pageOf(xs, 3)).toMatchObject({ page: 3, from: 51, to: 60 });
  expect(pageOf(xs, 3).items).toHaveLength(10);
  expect(pageOf(xs, 9).page).toBe(3);
  expect(pageOf([], 4)).toMatchObject({ items: [], page: 1, pages: 1, from: 0, to: 0 });
});
```

Togli o aggiorna i test che usano `since`. "Ordina per prezzo crescente" va nella firma di `run`, che oggi riceve già `sort`.
- [ ] **Step 2:** `npm test -w apps/web -- filters`. Atteso: FAIL.
- [ ] **Step 3:** Implementa. In `filterLeads`, `newOnly` agisce dove oggi agisce `since` (prima delle schede, così i conteggi lo seguono). Fuori dalla scheda `recall`, `visible = [...sortLeadsBy(nuovi), ...sortLeadsBy(altri)]` e `newHead = nuovi.length`. `newCount` si calcola su `filtered` senza il filtro `newOnly`, quindi `newOnly` va applicato dopo aver contato. In alternativa si conta su una copia senza quel filtro: scegli la forma più semplice che fa passare i test.
- [ ] **Step 4:** `npm test -w apps/web -- filters`. Atteso: PASS.
- [ ] **Step 5: Commit** `feat(web): nuovi in cima, filtro «Solo nuovi» e pagine da 25`

### Task 3: Il giro dice alla pagina da quando contare i nuovi

**Files:**
- Modify: `apps/web/src/components/Sweep.tsx` (props, `refresh`, bottone "Vedi i nuovi")
- Modify: `apps/web/src/pages/Leads.tsx` (stato `newSince`, `onShowNew`)
- Test: `apps/web/test/sweep.test.tsx:160-177`, `apps/web/test/leads.test.tsx:118-134`

**Interfaces:**
- Consumes: `filterLeads(..., newSince)` e `LeadFilters.newOnly` (task 2).
- Produces: prop di `Sweep` `onStatus?(s: SweepStatus): void`, chiamata a ogni risposta di `GET /api/sweep`. `onShowNew?(): void` diventa senza argomenti. In `Leads.tsx`: `newSince = status?.running?.startedAt ?? status?.last?.startedAt ?? null`.

- [ ] **Step 1:** Aggiorna il test di `sweep.test.tsx`: `expect(onShowNew).toHaveBeenCalledWith()`. Aggiungi un test: `onStatus` riceve lo stato letto (`expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ last: FINISHED }))`).
- [ ] **Step 2:** Aggiorna "Vedi i nuovi filtra i lead del giro" in `leads.test.tsx`. Dopo il clic: `rows()` uguale a `['Apri il lead: Nuovo del giro']`, il bottone `'Togli il filtro Solo nuovi'` presente e la scheda `/^Da lavorare/` selezionata.
- [ ] **Step 3:** `npm test -w apps/web -- sweep leads`. Atteso: FAIL.
- [ ] **Step 4:** Implementa. `refresh` chiama `setStatus` e `onStatus`, tenendo `onStatus` in un ref per non rifare l'effetto. `onShowNew` in `Leads` fa `setFilters({ ...EMPTY_FILTERS, newOnly: true }); setTab('new'); navigate('/')`. Se `seenSince` non ha più usi, toglila da `lead-groups.ts`.
- [ ] **Step 5:** `npm test -w apps/web && npm run typecheck`. Atteso: verde. I test di `leads.test.tsx` che cercano `/^Nuovi/` vanno portati a `/^Da lavorare/` in questo task.
- [ ] **Step 6: Commit** `feat(web): la lista sa quando è partito l'ultimo giro`

### Task 4: Lista in stile idealista (colonna filtri, schede grandi, pagine)

**Files:**
- Modify: `apps/web/src/components/LeadList.tsx`, `apps/web/src/components/LeadRow.tsx`, `apps/web/src/pages/Leads.tsx`, `apps/web/src/components/Cover.tsx` (solo una misura `size="card"` se serve), `apps/web/src/styles.css` (sezioni "Lista dei lead" e "Lista e scheda")
- Modify: `apps/web/src/prefs.ts` (`filtersOpen` vale solo sotto i 900 px: stessa chiave, commento aggiornato)
- Test: `apps/web/test/leads.test.tsx`

**Interfaces:**
- Consumes: `FilteredLeads.newHead`, `newCount`, `pageOf`, `PAGE_SIZE` (task 2), `newSince` (task 3).
- Produces: `LeadRow` riceve `isNew: boolean`. `LeadList` riceve `page: number`, `setPage(p: number): void` e `sweep: ReactNode` (il riquadro del giro, messo in cima alla colonna sinistra). `Leads` tiene `page` e lo riporta a 1 quando cambiano `filters`, `tab` o l'ordinamento della scheda.

Disposizione (spec, sezione "Disposizione della pagina", e bozza `layout.html`):
- Su desktop `.leadspage` è una griglia `270px 1fr`. A sinistra `<aside aria-label="Filtri">` con il giro e i gruppi di filtri sempre aperti (Priorità, Comune, Prezzo, Tipologia, Portale con "Su più portali", Altro con "Non più visti" e "Solo nuovi (N)"). In cima c'è "Azzera filtri" se `anyFilter`. I gruppi tengono gli stessi `role="group"`/`aria-label` e gli stessi bottoni con `aria-pressed`, ma ogni opzione è una riga a tutta larghezza con il conteggio a destra. La priorità resta `radiogroup`.
- Al centro: schede di stato, ricerca, riga "N lead" + "Ordina per", poi la lista. Se `newHead > 0` c'è un titolo `Nuovi dall'ultimo giro · N` prima dei nuovi e `Altri lead · N` prima degli altri (titoli come `li.leads__group`). Il gruppo si calcola sulla pagina mostrata: sulla pagina 2 compaiono solo i titoli dei gruppi presenti.
- Scheda (`LeadRow`): foto 300×210 a sinistra; prezzo grande (con prezzo massimo barrato e `−N%` se `evaluation.dropPercent > 0`), titolo, riga `N locali · N m² · città · zona` (salta i campi null), motivi, etichette (priorità, `Ribassato −N%` se `dropPercent > 0`, portali, "Su N portali", "Ripubblicato", "Non più visto dal…", richiamo), `Sparkline` in basso a destra. Se `isNew`, classe `lead--new` (bordo 2px `--new`, alone `--new-soft`) e scritta `NUOVO` sulla foto.
- Pagine sotto la lista: `<nav aria-label="Pagine">` con ‹, numeri (al più 7 voci, con … in mezzo) e ›. La pagina corrente ha `aria-current="page"`. Sotto c'è il testo `Lead {from}–{to} di {totale}`. Cambiando pagina si scorre fino alla cima della lista (`scrollIntoView` sulla lista). Nella scheda `recall` la paginazione vale sui `visible` già raggruppati e i titoli di gruppo si ricalcolano sulla pagina.
- `ExportBar` esporta tutti i `visible`, non solo la pagina.
- Sotto i 900 px niente colonna: il giro sta sopra la lista e i filtri sono dietro il bottone `Filtri (N)` (stesso comportamento del cassetto di oggi, con le etichette dei filtri attivi da togliere). La scheda mette la foto sopra il testo.
- Il vecchio `workspace` affiancato sparisce (il dettaglio diventa finestra nel task 5). In questo task `Leads` mostra ancora `LeadDetail` sotto la lista quando c'è `selectedKey`, così i test del dettaglio restano verdi fino al task 5.

- [ ] **Step 1: Test che falliscono** in `leads.test.tsx`:

```ts
it('i nuovi dell\'ultimo giro sono in cima e segnati', async () => {
  const startedAt = Date.now() - 60_000;
  const last = { startedAt, finishedAt: startedAt + 30_000, outcome: 'completed', portals: {}, notFound: [], newCount: 1, drops: 0, missing: 0 };
  mockApi(routes([lead({ key: 'subito:1', title: 'Vecchio', firstSeenAt: startedAt - 86_400_000 }), lead({ key: 'subito:2', title: 'Appena trovato', firstSeenAt: startedAt + 1 })],
    { 'GET /api/sweep': { status: 200, body: { running: null, last } } }));
  renderAt('/');
  fireEvent.click(await screen.findByRole('tab', { name: /^Da lavorare/ }));
  await vi.waitFor(() => expect(rows()).toEqual(['Apri il lead: Appena trovato', 'Apri il lead: Vecchio']));
  expect(screen.getByRole('heading', { name: 'Nuovi dall\'ultimo giro · 1' })).toBeTruthy();
  expect(within(screen.getByRole('link', { name: 'Apri il lead: Appena trovato' })).getByText('NUOVO')).toBeTruthy();
});
it('25 per pagina; cambiando filtro si torna alla prima', async () => {
  const many = Array.from({ length: 30 }, (_, i) => lead({ key: `subito:${i + 1}`, title: `Casa ${i + 1}`, priority: i < 28 ? 'high' : 'medium' }));
  mockApi(routes(many));
  renderAt('/');
  fireEvent.click(await screen.findByRole('tab', { name: /^Da lavorare/ }));
  expect(rows()).toHaveLength(25);
  expect(screen.getByText('Lead 1–25 di 30')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pagine' })).getByRole('button', { name: '2' }));
  expect(rows()).toHaveLength(5);
  fireEvent.click(screen.getByRole('radio', { name: 'Media (2)' }));
  expect(screen.getByText('Lead 1–2 di 2')).toBeTruthy();
});
it('i filtri sono sempre visibili su schermo largo', async () => {
  mockApi(routes());
  renderAt('/');
  await screen.findByRole('tab', { name: /^Da lavorare/ });
  expect(screen.getByRole('group', { name: 'Filtra per sito' })).toBeTruthy();
});
```

Adatta "Filtri: il riquadro si apre…": su schermo largo (jsdom senza `matchMedia` = largo) il bottone `Filtri` non c'è e i gruppi si usano direttamente.
- [ ] **Step 2:** `npm test -w apps/web -- leads`. Atteso: FAIL.
- [ ] **Step 3:** Implementa componenti e CSS seguendo la disposizione sopra. Togli le regole CSS di `workspace` affiancato non più usate e aggiungi `--new`/`--new-soft` in `:root`.
- [ ] **Step 4:** `npm test -w apps/web && npm run typecheck -w apps/web`. Atteso: verde.
- [ ] **Step 5:** Controllo a occhio: `npm run dev -w apps/web` con il server locale (`docs/deploy.md`), a 1280 px e a 390 px. Confronta con `layout.html`.
- [ ] **Step 6: Commit** `feat(web): lista dei lead con filtri a sinistra, schede grandi e pagine`

### Task 5: Dettaglio nella finestra sopra la lista

**Files:**
- Create: `apps/web/src/components/LeadModal.tsx`
- Modify: `apps/web/src/components/LeadDetail.tsx`, `apps/web/src/pages/Leads.tsx`, `apps/web/src/styles.css` (sezione del dettaglio)
- Test: `apps/web/test/lead-detail.test.tsx`, `apps/web/test/leads.test.tsx`, `apps/web/tests/e2e/onboarding.spec.ts:44-47`

**Interfaces:**
- Consumes: `isNewLead`/`newSince` (task 1 e 3), `pageOf` (task 2).
- Produces: `LeadModal({ onClose, position, children }: { onClose(): void; position: string | null; children: ReactNode })`: `role="dialog"`, `aria-modal="true"`, `aria-label="Scheda del lead"` sul contenitore (la `region` di `LeadDetail` resta dentro). `LeadDetail` riceve anche `isNew: boolean`.

Comportamento (spec, sezione "Dettaglio del lead", e bozza `detail.html`):
- `LeadModal`: sfondo scurito, riquadro largo al massimo 1040 px, riga in alto con `position` ("Lead 3 di 25 · pagina 1", oppure niente) e bottone `✕` (`aria-label="Chiudi"`). Si chiude con Esc (keydown sul documento), clic sullo sfondo (non sul riquadro) e ✕. Tutti chiamano `onClose`, che in `Leads` fa `navigate('/')`. Il tasto "indietro" funziona già da solo col router. Mentre è aperta: `document.body.style.overflow = 'hidden'`, ripristinato allo smontaggio. Fuoco sul riquadro all'apertura, Tab che resta dentro, e alla chiusura il fuoco torna all'elemento attivo prima dell'apertura. Sotto i 900 px prende tutto lo schermo.
- La lista resta montata sotto la finestra (stessa pagina e stessi filtri), quindi il vecchio salvataggio dello scorrimento (`listScroll`, `wasOpen`, `narrow`) non serve più e va tolto.
- `position`: indice del lead nella pagina corrente (`pageOf(...).items`) più 1, di `items.length`. Se il lead non è nella pagina, `null`.
- Lead non trovato: la finestra mostra il messaggio di oggi ("Questo lead non è nella tua lista…" con "Torna ai lead").
- `LeadDetail`: togli "← Lead". In alto, foto grande a sinistra e a destra etichette, `NUOVO` se `isNew`, prezzo molto grande, titolo (heading), indirizzo, una riga in evidenza con m², locali e `€ N al m²` (solo con prezzo e superficie), e il bottone `Apri l'annuncio su {PORTAL_TAGS[portal]} ↗`. Sotto, due colonne: a sinistra le sezioni di oggi nello stesso ordine; a destra `<aside>` "Il tuo lavoro" con `position: sticky`.
- Lo stato diventa `<div role="radiogroup" aria-label="Stato">` con quattro `<button role="radio" aria-checked>` (etichette da `STATUS_LABELS`), e un clic salva come oggi la tendina. I richiami rapidi sono sempre visibili: `RECALL_SHORTCUTS` più "Scegli data…", che apre il campo data. Con un richiamo fissato: data, "Fatto" e "Sposta…" come oggi. Se lo stato è "Scartato" i richiami non si mostrano, come oggi.
- Il salvataggio della nota alla chiusura c'è già (cleanup di `LeadDetail`) e copre Esc, clic fuori e ✕ perché tutti smontano il componente.

- [ ] **Step 1: Test che falliscono.** In `lead-detail.test.tsx` sostituisci gli usi di `combobox 'Stato'` con:

```ts
const status = (d: ReturnType<typeof within>, name: string) => d.getByRole('radio', { name });
fireEvent.click(status(within(detail()), 'Contattato'));
// …
expect(status(within(detail()), 'Contattato').getAttribute('aria-checked')).toBe('true');
```

Aggiungi:

```ts
it('si apre come finestra e si chiude con Esc lasciando la lista', async () => {
  mockApi(routes());
  renderAt('/lead/immobiliare%3A1');
  const dialog = await screen.findByRole('dialog', { name: 'Scheda del lead' });
  expect(within(dialog).getByText('Lead 1 di 2 · pagina 1')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(window.location.pathname).toBe('/');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('link', { name: 'Apri il lead: Villa con giardino' })).toBeTruthy();
});
it('nota scritta e chiusura con Esc: si salva', async () => {
  const calls = mockApi(routes({ 'PATCH /api/leads/state': (b) => ({ status: 200, body: { state: saved({ notes: (b as { notes: string }).notes }) } }) }));
  renderAt('/lead/immobiliare%3A1');
  await screen.findByRole('dialog');
  fireEvent.change(within(detail()).getByRole('textbox', { name: 'Note' }), { target: { value: 'Richiamare la sera' } });
  fireEvent.keyDown(document, { key: 'Escape' });
  await vi.waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ keys: ['immobiliare:1', 'idealista:2'], notes: 'Richiamare la sera' }));
});
it('prezzo al metro quadro', async () => {
  mockApi(routes());
  renderAt('/lead/immobiliare%3A1');
  await screen.findByRole('dialog');
  expect(within(detail()).getByText('€ 1.875 al m²')).toBeTruthy(); // 150.000 / 80
});
```

Il numero "Lead 1 di 2" dipende dall'ordine di `MAIN` e `OTHER` nella scheda "Da lavorare": se l'ordinamento li inverte, il test usa il valore giusto. In `onboarding.spec.ts` sostituisci la tendina con `detail.getByRole('radio', { name: 'Contattato' }).click()` e `toHaveAttribute('aria-checked', 'true')`.
- [ ] **Step 2:** `npm test -w apps/web -- lead-detail`. Atteso: FAIL.
- [ ] **Step 3:** Implementa `LeadModal`, il nuovo `LeadDetail` e il collegamento in `Leads`.
- [ ] **Step 4:** `npm test -w apps/web && npm run typecheck`. Atteso: verde.
- [ ] **Step 5:** `npm run test:e2e -w apps/web`. Atteso: verde.
- [ ] **Step 6:** Controllo a occhio a 1280 px e 390 px, confrontando con `detail.html`: Esc, clic fuori, indietro del browser, fuoco che torna alla scheda.
- [ ] **Step 7: Commit** `feat(web): dettaglio del lead in una finestra sopra la lista`

### Task 6: Documenti e verifica finale

**Files:**
- Modify: `CLAUDE.md` (paragrafo `apps/web`: lista con filtri a sinistra e pagine, dettaglio in `LeadModal` su `/lead/<chiave>` sopra la lista, regola dei nuovi in `isNewLead`)
- Modify: `docs/roadmap.md` (nuova riga prima del lancio: "Pagina dei lead in stile idealista (riscontro del pilota)", con spec e piano, stato "fatto" a fine lavoro)

- [ ] **Step 1:** Aggiorna i due documenti.
- [ ] **Step 2:** `npm test && npm run typecheck && npm run build && npm run test:e2e -w apps/web`. Atteso: tutto verde, build senza errori.
- [ ] **Step 3: Commit** `docs: pagina dei lead in stile idealista`
