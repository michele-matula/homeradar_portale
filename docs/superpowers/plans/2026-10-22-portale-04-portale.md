# Portale, tappa 4: portale — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il portale diventa il posto dove l'agente lavora: lista dei lead con schede, filtri, ricerca e ordinamenti; scheda del lead con storico prezzi, altre fonti, mercato, stato, note, richiamo e separazione; richiami in evidenza; esportazione CSV/XLSX; impostazioni; avanzamento completo del giro; layout per il telefono.

**Architecture:** Il server c'è già (`GET /api/leads` restituisce i `LeadView` già raggruppati e valutati per l'agente; `PATCH /api/leads/state`, `POST /api/leads/split`, `GET|PUT /api/settings`, `GET /api/sweep`). Questa tappa è quasi solo `apps/web`: filtri e conteggi del pannello dell'estensione (`../homeradar/src/ui/sidepanel/App.tsx`) diventano un modulo puro testato (`src/leads/filters.ts`); la pagina dei lead tiene filtri e lista montati sia su `/` sia su `/lead/<chiave>`, così aprire e chiudere una scheda non perde niente. Su desktop lista e scheda stanno affiancate; sotto i 900 px la scheda prende tutta la pagina.

**Tech Stack:** React 19, Vite 8, Vitest 5 + Testing Library (jsdom), TypeScript 7; `xlsx` (già dipendenza di `packages/shared`, caricato solo al clic su «Esporta»).

**Spec:** `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md` (§2 obiettivi; §4 punto 1; §5 "Cosa vede un agente"; §6.2 punto 5; §6.3 punti 7–8; §6.4 ultimo punto; §6.5 Lavorare i lead; §9 portale). Codice da riprendere da `../homeradar/src/ui/sidepanel/`: `App.tsx` (filtri, schede, conteggi), `LeadItem.tsx`, `SweepCard.tsx`, `ExportBar.tsx`, `Cover.tsx`, `Sparkline.tsx`, `InfoTip.tsx`, `download.ts`, `sortPrefs.ts`, `filtersPrefs.ts`, `SettingsView.tsx` (solo i testi d'aiuto di soglie, categorie e portali), `styles.css` (classi di lead, pill, schede, filtri).

## Global Constraints

- Testi in italiano; il portale parla col server solo tramite `apps/web/src/api.ts`; errori mostrati col messaggio del server (`ApiError`).
- Nessuna richiesta del portale ai portali immobiliari tranne le copertine, caricate dal browser con `referrerPolicy="no-referrer"` e `loading="lazy"` (`core/cover.ts` sul server ha già scelto gli URL).
- Nel portale non si eliminano annunci: l'archivio è condiviso. Il «cestino» e «Elimina tutti» del pannello non si riprendono; per togliere un lead dalla vista l'agente lo mette in «Scartato».
- La zona (comuni) la decide l'admin: nelle impostazioni si vede ma non si modifica.
- Preferenze di sola vista (ordinamento per scheda, riquadro «Filtri» aperto) in `localStorage` con chiavi `homeradar.sortByTab` e `homeradar.filtersOpen`, lette dentro `try/catch` con ripiego sui default; filtri e ricerca non si salvano.
- Il giorno dei richiami è quello di Europe/Rome (`core/recall.ts`); `now` del portale è `Date.now()`.
- Il modulo di esportazione (`@homeradar/shared/core/export`, che importa `xlsx`) si carica con `import()` dinamico: non deve entrare nel bundle iniziale.
- Il server non cambia schema: nessuna migrazione in questa tappa. `PRIVACY_VERSION` resta 1.

## Review Focus

1. Lead aperto da un indirizzo che non è (più) nella lista dell'agente (separato, scartato da più di 90 giorni, chiave sbagliata, link di un altro account) → «Questo lead non è nella tua lista» con «Torna ai lead», nessun errore. Test nel Task 4.
2. Salvataggio di stato, nota o richiamo che fallisce (rete, 400 «Impossibile impostare un richiamo su un lead scartato») → messaggio d'errore nella scheda, lo stato mostrato resta quello salvato, il testo della nota scritta non si perde. Test nel Task 4.
3. Telefono: con un filtro attivo si apre un lead e si torna indietro (bottone o «indietro» del browser) → filtri, scheda e ricerca restano; la lista torna alla posizione di scorrimento di prima. Test nel Task 4.
4. Pagina lasciata aperta oltre la mezzanotte → i richiami di «oggi» e il numero «da richiamare» si ricalcolano da soli (`nextRecallCheck`). Test nel Task 3.
5. Agente senza comuni assegnati → la lista dice «L'amministratore non ti ha ancora assegnato una zona», non «Nessun lead»; «Cerca» non c'è. Test nei Task 3 e 5.

---

## Struttura dei file

```
apps/web/src/
  api.ts                        + metodo PUT
  router.ts                     + leadPath(key), leadKeyOf(path)
  App.tsx                       rotte /, /lead/<chiave>, /impostazioni, /admin/utenti
  prefs.ts                      NUOVO  ordinamento per scheda e riquadro filtri (localStorage)
  download.ts                   NUOVO  da homeradar
  leads/filters.ts              NUOVO  filtri, schede e conteggi (logica pura)
  pages/Leads.tsx               NUOVO  sostituisce Home.tsx: giro + lista + scheda
  pages/Settings.tsx            NUOVO  soglie, categorie, portali, zona, computer collegati
  components/Layout.tsx         menu: Lead (con «N da richiamare»), Impostazioni, Utenti, Esci
  components/LeadList.tsx       NUOVO  schede, ricerca, filtri, ordinamento, righe
  components/LeadRow.tsx        NUOVO  riga compatta della lista
  components/LeadDetail.tsx     NUOVO  scheda del lead
  components/Cover.tsx, Sparkline.tsx, InfoTip.tsx   NUOVI  da homeradar
  components/ExportBar.tsx      NUOVO
  components/Sweep.tsx          avanzamento completo, riepilogo, «Vedi i nuovi»
  styles.css                    classi riprese dal pannello + layout lista/scheda
apps/web/test/
  filters.test.ts, leads.test.tsx, lead-detail.test.tsx, settings.test.tsx, export.test.tsx, sweep.test.tsx (esteso)
```

---

### Task 1: Rotte, menu e preferenze di vista

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/router.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/Layout.tsx`
- Create: `apps/web/src/prefs.ts`, `apps/web/src/pages/Leads.tsx` (segnaposto che mostra `Sweep` e `Devices` come oggi `Home`), `apps/web/src/pages/Settings.tsx` (segnaposto con titolo «Impostazioni»)
- Delete: `apps/web/src/pages/Home.tsx` (i test in `sweep.test.tsx` che la usano passano a `Leads`)
- Test: `apps/web/test/routes.test.tsx`, `apps/web/test/prefs.test.ts`

**Interfaces:**
- Produces:
  - `api(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path, body?)`.
  - `router.ts`: `leadPath(key: string): string` → `/lead/${encodeURIComponent(key)}`; `leadKeyOf(path: string): string | null` (decodifica; `null` se il percorso non è `/lead/<x>` o la decodifica fallisce).
  - `prefs.ts`: `type SortByTab = Record<LeadStatus, SortKey>`; `DEFAULT_SORT_BY_TAB` (tutte `'priority'`); `loadSortByTab(): SortByTab`, `saveSortByTab(s)`, `loadFiltersOpen(): boolean`, `saveFiltersOpen(open)` — come `sortPrefs.ts` e `filtersPrefs.ts` di homeradar.
  - `Layout` accetta `dueRecalls?: number`: se > 0 il link «Lead» del menu mostra `«N da richiamare»` (`1 da richiamare`).
  - `Leads({ me, onSignOut, connector? })`, `Settings({ me, onSignOut })`.

- [ ] **Step 1: Test che falliscono.** `routes.test.tsx` (con `mockApi` e `renderAt` di `test/helpers.tsx`, `GET /api/me` → `AGENT`, `GET /api/leads` → `{ leads: [], dueRecalls: 0 }`, `GET /api/sweep` idle, `GET /api/devices` → `[]`, `GET /api/settings` → default):
  - `'/impostazioni' mostra le impostazioni'`: heading «Impostazioni».
  - `'/lead/immobiliare%3A1 resta sulla pagina dei lead'`: `location.pathname` invariato dopo il caricamento.
  - `'un percorso sconosciuto torna a /'`: `/xyz` → `/`.
  - `'il menu porta a Impostazioni e ai lead'`: clic su «Impostazioni» → `/impostazioni`; clic su «Lead» → `/`.
  - `'un agente su /admin/utenti torna a /'` (esiste già: deve restare verde).
  `prefs.test.ts`: valori sconosciuti nel `localStorage` tornano al default; `localStorage.getItem` che lancia → default; ritorno di `leadKeyOf(leadPath('subito:12'))` uguale a `'subito:12'`; `leadKeyOf('/lead/%E0')` → `null`.
- [ ] **Step 2:** `npm test -w apps/web` → falliscono (rotte e moduli assenti).
- [ ] **Step 3: Implementa.** In `App.tsx` la regola di reindirizzamento ammette `/`, `/impostazioni`, `/lead/<x>` e `/admin/*` (per l'admin); `/` e `/lead/<x>` rendono la stessa istanza di `Leads` (stesso posto nell'albero, nessuna `key` che cambi), così lo stato dei filtri sopravvive. Menu del `Layout`: «Lead», «Impostazioni», «Utenti» (solo admin), «Esci».
- [ ] **Step 4:** `npm test -w apps/web` e `npm run typecheck -w apps/web` → verdi.
- [ ] **Step 5: Commit** `feat(web): rotte dei lead e delle impostazioni, preferenze di vista`.

---

### Task 2: Filtri, schede e conteggi (logica pura)

**Files:**
- Create: `apps/web/src/leads/filters.ts`
- Test: `apps/web/test/filters.test.ts`

**Interfaces:**
- Consumes: `applyQuery`, `describeQuery`, `inComuni`, `isEmptyQuery`, `OTHER_COMUNI`, `parseThousands`, `type LeadQuery` (`core/lead-filters`); `seenSince` (`core/lead-groups`); `groupByRecall`, `groupByStatus`, `leadCategories`, `leadPortals`, `sortLeadsBy`, `PRIORITY_LABELS` (`core/leads`); `isDue` (`core/recall`); `SortByTab` (Task 1).
- Produces:
  ```ts
  export type Tab = 'recall' | LeadStatus;
  export const TABS: Tab[];                       // ['recall', 'new', 'to_contact', 'contacted', 'discarded']
  export const TAB_LABELS: Record<Tab, string>;   // Richiami, Nuovi, Da contattare, Contattati, Scartati
  export type PriorityFilter = 'all' | 'high' | 'medium' | 'verify';
  export interface LeadFilters {
    text: string; minInput: string; maxInput: string; reservedOnly: boolean;
    priority: PriorityFilter; portals: Portal[]; multi: boolean; categories: PropertyCategory[];
    comuni: string[];            // ISTAT e/o OTHER_COMUNI; vuoto = tutti
    missingOnly: boolean; since: number | null;
  }
  export const EMPTY_FILTERS: LeadFilters;
  export interface FilteredLeads {
    tabCounts: Record<Tab, number>;               // dopo ricerca, prezzo, comuni, categorie, non più visti, since
    dueCount: number;                             // richiami di oggi o scaduti (non scartati) fra quelli filtrati
    priorityCounts: Record<PriorityFilter, number>;
    comuneCounts: Record<string, number>;         // per ogni ISTAT della zona e OTHER_COMUNI, contati prima del filtro comuni
    portalCounts: Record<Portal, number>; multiCount: number;
    categoryCounts: Record<PropertyCategory, number>; missingCount: number;
    visible: LeadView[];                          // ordinati: per gruppo di richiamo nella scheda Richiami, altrimenti sortByTab[tab]
    recallGroups: { kind: RecallKind; leads: LeadView[] }[];  // solo per la scheda Richiami
    tags: { key: keyof LeadFilters; label: string }[];        // filtri del riquadro attivi, per le etichette togliibili
    priceInvalid: { min: boolean; max: boolean };
  }
  export function filterLeads(leads: LeadView[], f: LeadFilters, tab: Tab, zone: ComuneRef[], sortByTab: SortByTab, now: number): FilteredLeads;
  export function toggleIn<T>(all: readonly T[], chosen: T[], x: T): T[];  // sceglierli tutti = []
  export function initialTab(leads: LeadView[], now: number): Tab;         // 'recall' se c'è un richiamo dovuto, altrimenti 'new'
  ```
  Il calcolo è quello di `App.tsx` di homeradar righe 118–173 (ordine dei filtri e "ogni filtro del riquadro si conta prima di sé stesso"), con `comuni` filtrato sulla zona attuale (un comune tolto dall'admin esce dal filtro). Prezzi in migliaia: `parseThousands`; un prezzo `'invalid'` non filtra e accende `priceInvalid`.

- [ ] **Step 1: Test che falliscono.** Con una fabbrica `lead(over: Partial<...>)` nel test (listing, evaluation, state minimi; `others: []`, `missingPortals: []`, `covers: []`):
  - `'le schede contano dopo ricerca e prezzo'`: 3 lead (new/new/contacted), testo che ne esclude uno nuovo → `tabCounts.new === 1`, `tabCounts.contacted === 1`.
  - `'la scheda Richiami ha i lead con richiamo, ordinati per gruppo'`: richiami ieri, oggi, fra 3 giorni → `recallGroups.map(g => g.kind)` = `['overdue','today','upcoming']`, `dueCount === 2`.
  - `'un lead scartato non conta fra i richiami dovuti'`.
  - `'i conteggi per sito ignorano il filtro sito ma seguono priorità e su più portali'`.
  - `'i conteggi per comune ignorano il filtro comune'` e `'un comune non più in zona esce dal filtro'`.
  - `'prezzo non valido non filtra'`: `minInput: 'abc'` → tutti visibili, `priceInvalid.min === true`.
  - `'solo trattativa riservata'`: solo i lead con `currentPrice == null`.
  - `'since tiene i lead visti per la prima volta dal giro'` (usa `firstSeenAt`).
  - `'ordinamento della scheda'`: `sortByTab.new = 'price_asc'` → `visible` in prezzo crescente.
  - `'toggleIn: sceglierli tutti torna a []'`.
  - `'initialTab'`: con un richiamo di oggi → `'recall'`; senza → `'new'`.
  - `'tags'`: `portals: ['subito']`, `missingOnly: true` → etichette `['Subito', 'Non più visti']`.
- [ ] **Step 2:** `npx vitest run test/filters.test.ts` (in `apps/web`) → FAIL.
- [ ] **Step 3: Implementa** `filters.ts` con le firme sopra.
- [ ] **Step 4:** stesso comando → PASS; `npm run typecheck -w apps/web`.
- [ ] **Step 5: Commit** `feat(web): filtri, schede e conteggi dei lead`.

---

### Task 3: Pagina dei lead — lista

**Files:**
- Modify: `apps/web/src/pages/Leads.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/components/LeadList.tsx`, `apps/web/src/components/LeadRow.tsx`, `apps/web/src/components/Cover.tsx`, `apps/web/src/components/Sparkline.tsx`
- Test: `apps/web/test/leads.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`leadPath`, `navigate`, `prefs`), Task 2 (`filterLeads`, `EMPTY_FILTERS`, `TABS`, `TAB_LABELS`, `toggleIn`, `initialTab`); `LeadsResponse`.
- Produces:
  - `Leads` carica `GET /api/leads` all'avvio, tiene `leads`, `filters`, `tab`, `sortByTab`, `filtersOpen`, `now`; espone ai figli `reload(): Promise<void>` e `replaceState(mainKey: string, state: LeadState)` (aggiorna `state` del lead con quella `listing.key` senza ricaricare).
  - `LeadList({ result: FilteredLeads, filters, setFilters, tab, setTab, sort, setSort, filtersOpen, toggleFilters, zone, selectedKey })`.
  - `LeadRow({ lead, now, selected })`: link (`linkProps(leadPath(key))`) con copertina piccola, pill di priorità (`priorityLabel`), portali, «Su N portali», «Ripubblicato», «Non più visto dal …», titolo, prezzo (`€ 185.000` / «Trattativa riservata»), motivi (`evaluation.reasons`), sparkline, eventuale richiamo (`recallLabel`). Nessun comando di modifica nella riga.
  - `Cover({ covers, href })` e `Sparkline({ prices })` come in homeradar.
  - `now` si aggiorna con un timer a `nextRecallCheck(now)` (da `core/recall`), ripianificato a ogni scatto.

- [ ] **Step 1: Test che falliscono** (`leads.test.tsx`, `renderAt('/')` con `GET /api/leads` finto, due lead nuovi e uno con richiamo scaduto):
  - `'si apre su Richiami se c'è un richiamo da fare'`: scheda «Richiami» selezionata (`aria-selected`), nome accessibile `Richiami (1 da fare)`; il menu mostra «1 da richiamare».
  - `'cambiare scheda e filtrare per priorità'`: clic su «Nuovi», poi su «Alta» → resta solo il lead alto.
  - `'la ricerca a testo filtra tutte le schede'`.
  - `'Filtri: il riquadro si apre, il sito filtra, l'etichetta si toglie'`: apri «Filtri», scegli «Subito», chiudi, clic su «Togli il filtro Subito» → tutti di nuovo visibili; «Azzera filtri» compare solo con un filtro attivo.
  - `'l'ordinamento si ricorda per scheda'`: scegli «Prezzo crescente» in «Nuovi», smonta e rimonta → ancora scelto (`localStorage`).
  - `'clic su una riga apre /lead/<chiave>'`.
  - `'senza zona: messaggio per l'agente'`: `GET /api/me` con `comuni: []` → testo «L'amministratore non ti ha ancora assegnato una zona».
  - `'scheda vuota con filtri: lo dice'`: «Nessun lead «Subito» in questa scheda.».
  - `'errore del server: messaggio e Riprova'`: `GET /api/leads` 500 → messaggio, clic su «Riprova» ricarica.
  - `'a mezzanotte i richiami si ricalcolano'`: `vi.useFakeTimers({ toFake: ['setTimeout','Date'] })`, sistema alle 23:59 di Roma con un richiamo per domani; avanza di 2 minuti → «1 da richiamare» compare.
- [ ] **Step 2:** `npx vitest run test/leads.test.tsx` → FAIL.
- [ ] **Step 3: Implementa.** Struttura del markup e classi dal pannello (`tabs`, `chip`, `drawer`, `filter-tag`, `lead`, `pill`), stili ripresi da `../homeradar/src/ui/sidepanel/styles.css` con le variabili già in `styles.css`. `Leads` mostra in alto `Sweep` (Task 5 lo completa), poi la lista. Copertina della riga: 64×64; sotto i 600 px la riga va su due righe. Testo della lista vuota senza filtri: «Nessun lead in questa scheda. Premi «Cerca» dal computer per raccoglierne.».
- [ ] **Step 4:** `npm test -w apps/web` → PASS.
- [ ] **Step 5: Commit** `feat(web): lista dei lead con schede, ricerca, filtri e ordinamenti`.

---

### Task 4: Scheda del lead e layout lista/scheda

**Files:**
- Create: `apps/web/src/components/LeadDetail.tsx`, `apps/web/src/components/InfoTip.tsx`
- Modify: `apps/web/src/pages/Leads.tsx`, `apps/web/src/styles.css`
- Test: `apps/web/test/lead-detail.test.tsx`

**Interfaces:**
- Consumes: `replaceState`, `reload` (Task 3); `LeadStateBody`/`SplitBody` (forma delle richieste); `leadKeys`, `leadPortals`, `priorityLabel`, `STATUS_LABELS`; `aboveMarketText`, `isAboveMarket`, `marketExplanation`; `RECALL_SHORTCUTS`, `addDays`, `startOfLocalDay`, `recallStatus`, `recallLabel`, `formatRecallDate`, `toDateInput`, `fromDateInput`; `formatEuro`, `formatDate`, `formatDayMonth`.
- Produces: `LeadDetail({ lead: LeadView | null, now, onSaved(state: LeadState): void, onSplit(): Promise<void>, onClose(): void })`.
  - Sezioni: intestazione (copertina grande, titolo, prezzo, pill, «Apri l'annuncio» in nuova scheda), «Perché è un lead» (`evaluation.reasons`, `ageDays` con `~` se stimata), «Storico prezzi» (sparkline larga + tabella data/prezzo/`osservato|dichiarato` da `lead.prices`), «Mercato» (se `market`: `marketExplanation`, con `aboveMarketText` evidenziato se sopra mercato), «Stesso immobile» (`[principale, ...others]` come le fonti del pannello, con «Annuncio precedente · visto fino al …», «Apri» e «Separa»), «Il tuo lavoro» (stato, richiamo con scorciatoie e data, nota multilinea).
  - Stato e richiamo: `PATCH /api/leads/state` con `keys: leadKeys(lead)` → `onSaved(r.state)`. Nota: si salva all'uscita dal campo se cambiata; durante il salvataggio «Salvataggio…», poi «Salvata».
  - «Separa» (`POST /api/leads/split` con `key` e `fromKeys` = le altre chiavi) → `onSplit()` (ricarica la lista).
  - Errore di una richiesta: `<p role="alert">` nella scheda col messaggio del server; lo stato mostrato resta quello di `lead.state`; il testo della nota resta nel campo.
- Layout in `Leads`: contenitore `.workspace` con `.workspace--detail` quando `leadKeyOf(path)` non è null. ≥ 900 px: due colonne (lista 420 px, scheda `position: sticky` alta quanto la finestra con scorrimento proprio). < 900 px: con la scheda aperta la lista ha `display: none` e la scheda prende la pagina con «← Lead» in alto. Prima di aprire una scheda `Leads` salva `window.scrollY`; alla chiusura lo ripristina. Scheda senza lead scelto su desktop: «Scegli un lead dalla lista».

- [ ] **Step 1: Test che falliscono** (`lead-detail.test.tsx`, `renderAt('/lead/immobiliare%3A1')`, un lead con due fonti, storico di 3 prezzi, mercato sopra):
  - `'mostra storico, fonti e mercato'`: 3 righe nella tabella dello storico; «Annuncio precedente» per la fonte precedente; testo di `aboveMarketText`.
  - `'cambiare stato manda tutte le chiavi del gruppo e sposta il lead'`: scegli «Contattato» → chiamata `PATCH /api/leads/state` con `{ keys: ['immobiliare:1','idealista:2'], status: 'contacted' }`; tornando alla lista il lead è in «Contattati».
  - `'richiamo con scorciatoia'`: «Richiama…» → «Domani» → `recallAt` uguale a `addDays(startOfLocalDay(Date.now()), 1)`.
  - `'nota salvata all'uscita dal campo, non a ogni tasto'`: una sola PATCH con `notes`.
  - `'errore del server: messaggio, stato invariato, nota conservata'`: PATCH → 400 `Impossibile impostare un richiamo su un lead scartato` → `role="alert"` con quel testo; il campo nota tiene il testo scritto.
  - `'Separa ricarica la lista'`: POST split con `{ key: 'idealista:2', fromKeys: ['immobiliare:1'] }`, poi una seconda `GET /api/leads`.
  - `'lead non in lista'`: `renderAt('/lead/subito%3A999')` → «Questo lead non è nella tua lista» e «Torna ai lead» che porta a `/`.
  - `'tornando indietro i filtri restano'`: da `/`, attiva «Alta», apri un lead, `window.history.back()` (con `dispatchEvent(new PopStateEvent('popstate'))`) → «Alta» ancora attivo.
- [ ] **Step 2:** `npx vitest run test/lead-detail.test.tsx` → FAIL.
- [ ] **Step 3: Implementa** `LeadDetail`, `InfoTip` (da homeradar) e il layout.
- [ ] **Step 4:** `npm test -w apps/web` → PASS.
- [ ] **Step 5: Verifica a mano del layout.** `npm run dev -w apps/web` con il Worker locale (`docs/deploy.md`) e qualche lead nel D1 locale: finestra larga (lista + scheda) e strumenti per sviluppatori a 390 px (lista, poi scheda a tutta pagina, «← Lead» torna alla stessa posizione). Annota nel messaggio di commit se non è stato possibile.
- [ ] **Step 6: Commit** `feat(web): scheda del lead con storico, fonti, mercato, stato, note e richiamo`.

---

### Task 5: Avanzamento completo del giro

**Files:**
- Modify: `apps/web/src/components/Sweep.tsx`, `apps/web/src/pages/Leads.tsx`
- Test: `apps/web/test/sweep.test.tsx`

**Interfaces:**
- Consumes: `SweepStatus`, `SweepProgress`, `SweepResult`, `PORTAL_SITES`, `PORTALS`; `formatDateTime`.
- Produces: `Sweep({ userId, connector?, phone?, onLinked?, onFinished?(): void, onShowNew?(since: number): void, hasZone: boolean })`.
  - In corso: «Ricerca in corso · N min», `<progress>` `done`/`total`, ricerca corrente, per portale «Immobiliare.it: 4 pagine · 37 privati», «Finora: N annunci nuovi · M ribassi», «Ferma» (se c'è il connettore).
  - Appena finito (giro finito mentre la pagina era aperta, finché l'agente non preme «Chiudi»): titolo da `OUTCOME_TITLES` di `SweepCard.tsx` più durata, «N nuovi lead · M ribassi · K non più visti», i motivi per portale (`portalReason` di `SweepCard.tsx`) e «Non trovati: …», bottoni «Vedi i nuovi» (→ `onShowNew(last.startedAt)`: `Leads` imposta `filters.since` e la scheda «Nuovi») e «Chiudi».
  - A riposo: «Ultimo giro: 12/10 alle 09:30 · completato» o «Nessun giro fatto finora», motivi dell'ultimo giro, «Cerca» (primario se l'ultimo giro non è di oggi, giorno di Roma con `startOfLocalDay`).
  - Al passaggio da «in corso» a finito chiama `onFinished` (`Leads` ricarica i lead).
  - `hasZone === false`: niente «Cerca», solo il messaggio della zona (Task 3 lo mostra già nella lista: qui la scheda «Ricerche» non compare).
  - Il controllo ogni `POLL_MS` continua anche quando `conn.pending > 0` (pagine in attesa d'invio), non solo con giro in corso o connettore assente.
  - Connettore assente: «Connettore non trovato. Se non l'hai installato, installalo; se sei in una finestra in incognito, apri il portale in una finestra normale. Questa pagina se ne accorge da sola.»
  - Nota: durante il giro il server conta gli **annunci** nuovi, alla fine i **lead** nuovi (stesso immobile su più portali = uno); le due etichette lo dicono e non si confondono.

- [ ] **Step 1: Test che falliscono** (aggiunti a `sweep.test.tsx`, con `fakeConnector` esistente):
  - `'in corso: barra, portali, ricerca corrente e Ferma'`.
  - `'a fine giro: riepilogo, motivi e Vedi i nuovi'`: prima risposta `running`, poi `last` con `portals.idealista.outcome = 'blocked'` → testo «Idealista.it ha chiesto una verifica: aprilo tu e riprova domani.»; `onFinished` chiamata una volta; clic su «Vedi i nuovi» → `onShowNew(startedAt)`.
  - `'con pagine in attesa si continua a interrogare il connettore'`: `pending: 2` poi `pending: 0` → dopo `POLL_MS` il testo «2 pagine in attesa d'invio» sparisce.
  - `'connettore assente: testo con l'incognito'`.
  - `'senza zona non c'è Cerca'`.
  - I test esistenti restano verdi.
  - In `leads.test.tsx`: `'Vedi i nuovi filtra i lead del giro'` → etichetta «Da questo giro» e solo i lead con `firstSeenAt >= startedAt`.
- [ ] **Step 2:** `npx vitest run test/sweep.test.tsx test/leads.test.tsx` → FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4:** `npm test -w apps/web` → PASS.
- [ ] **Step 5: Commit** `feat(web): avanzamento completo del giro e riepilogo con «Vedi i nuovi»`.

---

### Task 6: Impostazioni

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`, `apps/web/src/pages/Leads.tsx` (toglie `Devices`), `apps/web/src/styles.css`
- Test: `apps/web/test/settings.test.tsx`

**Interfaces:**
- Consumes: `GET|PUT /api/settings` (`AgentSettings`, `AgentSettingsBody`), `Devices`, `CATEGORY_LABELS`, `PROPERTY_CATEGORIES`, `PORTAL_SITES`, `PORTALS`, `UNCERTAINTY_DAYS`.
- Produces: pagina con quattro sezioni:
  1. «Quando un annuncio è un lead»: `minAgeDays` («Online da almeno … giorni») e `minDropPercent` («Ribasso di almeno … %»), ciascuno con `InfoTip` e il testo di `FIELD_HELP` di `SettingsView.tsx` adattato (niente «navighi»: «più spesso fai il giro, più ne trovi»).
  2. «Cosa cercare»: categorie (caselle, almeno una) e portali del giro (caselle, almeno uno).
  3. «La tua zona»: comuni di `me.comuni` come etichette, «La zona la imposta l'amministratore: scrivigli per cambiarla.»
  4. «I tuoi computer»: `Devices`.
  - Un solo «Salva» per le sezioni 1–2, attivo solo con modifiche; `PUT /api/settings` con i soli campi cambiati; dopo il salvataggio «Impostazioni salvate» e i lead si ricalcolano alla prossima apertura della lista (`Leads` ricarica al montaggio). Errori del server mostrati sotto il bottone. Numeri non interi o fuori intervallo: il server risponde 400 col messaggio, che si mostra.

- [ ] **Step 1: Test che falliscono:**
  - `'carica e salva solo ciò che cambia'`: cambia i giorni a 60 → PUT con `{ minAgeDays: 60 }`, poi «Impostazioni salvate».
  - `'Salva disattivato senza modifiche'`.
  - `'togliere l'ultimo portale: errore del server'`: PUT → 400 «Attiva almeno un portale» → mostrato.
  - `'la zona si vede ma non si modifica'`: «Treviglio (BG)» presente, nessun campo per aggiungere comuni.
  - `'i computer collegati sono qui'`: `GET /api/devices` chiamata, heading «I tuoi computer».
- [ ] **Step 2:** `npx vitest run test/settings.test.tsx` → FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4:** `npm test -w apps/web` → PASS.
- [ ] **Step 5: Commit** `feat(web): impostazioni dell'agente`.

---

### Task 7: Esportazione

**Files:**
- Create: `apps/web/src/components/ExportBar.tsx`, `apps/web/src/download.ts`
- Modify: `apps/web/src/components/LeadList.tsx`
- Test: `apps/web/test/export.test.tsx`

**Interfaces:**
- Consumes: `toExportRows`, `toCsv`, `toXlsx`, `exportFileName` da `@homeradar/shared/core/export`, importati con `await import(...)` dentro il gestore del clic.
- Produces: `ExportBar({ leads: LeadView[], download?: (b: Blob, name: string) => void })` in fondo alla lista: «Esporta XLSX», «CSV», «Esporta la vista corrente (N)». Esporta esattamente `result.visible` della scheda e dei filtri attuali. Con 0 lead i bottoni sono disattivati.

- [ ] **Step 1: Test che falliscono:** `'CSV della vista corrente'` → `download` chiamata con un `Blob` di tipo `text/csv;charset=utf-8` il cui testo ha l'intestazione `EXPORT_COLUMNS` e una riga per lead visibile, nome che finisce in `.csv`; `'XLSX'` → tipo `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, nome `.xlsx`; `'senza lead i bottoni sono disattivati'`.
- [ ] **Step 2:** `npx vitest run test/export.test.tsx` → FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4:** `npm test -w apps/web` → PASS; `npm run build -w apps/web` e controlla nell'output di Vite che `xlsx` sia in un chunk separato da quello d'ingresso.
- [ ] **Step 5: Commit** `feat(web): esportazione CSV e XLSX della vista corrente`.

---

### Task 8: Verifica d'insieme e documenti

**Files:**
- Modify: `docs/roadmap.md` (tappa 4 → piano e «fatto»; nella riga della tappa 6 aggiungi «e2e del portale invito → accesso → lead (spec §9)», che questa tappa copre solo con i test dei componenti), `CLAUDE.md` (struttura di `apps/web`: `src/leads/filters.ts`, pagine `Leads` e `Settings`, `prefs.ts`)

- [ ] **Step 1:** dalla radice `npm test`, `npm run typecheck`, `npm run build` → tutti verdi.
- [ ] **Step 2: Prova locale** (`docs/deploy.md`: Worker locale con la SPA compilata, connettore costruito per `http://localhost:8787`): accesso agente, «Cerca» su un comune, lista popolata, apertura di un lead, cambio stato, nota, richiamo, «Separa» su un lead con più fonti, esportazione XLSX aperta in un foglio di calcolo, impostazioni salvate; finestra stretta (390 px) per lista e scheda.
- [ ] **Step 3:** aggiorna i documenti.
- [ ] **Step 4: Commit** `docs: tappa 4 completata`.

---

## Rinviati (decisi in questo piano)

- Dalla revisione della tappa 2: stato e separazioni scrivibili su annunci fuori zona e 404/200 che rivela le chiavi — restano al server (tappa 5, con l'admin e gli errori).
- Eventi d'uso dell'esportazione e dei cambi di stato: tappa 5 (`usage_events`).
- E2e del portale con Playwright: tappa 6 (vedi Task 8).
