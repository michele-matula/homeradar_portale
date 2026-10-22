# Tappa 6 — Pronti per il pilota: piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portale e connettore pronti per il primo pilota: minori che darebbero fastidio nell'uso quotidiano corretti, informativa minima, pacchetto per il Chrome Web Store («Non in elenco»), e2e invito → accesso → lead; dopo l'approvazione dello Store, ID e link d'installazione.

**Architecture:** correzioni puntuali nei file esistenti (nessuna migrazione). Build del connettore per lo Store scelta con `WXT_STORE=1` (senza `key`, cartella propria). E2E Playwright in `apps/web` contro `wrangler dev` con uno stato D1 locale costruito da uno script (migrazioni + seed SQL).

**Tech Stack:** TypeScript, React 19, Vitest, Cloudflare Workers + D1, WXT, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-tappa-6-pilota-design.md`

## Global Constraints

- Vincoli di `CLAUDE.md` tutti validi (testi in italiano, errori API `{ "error": "<messaggio>" }`, timestamp ms UTC, niente segreti nel repository).
- `PRIVACY_VERSION` resta `1`.
- Nessuna migrazione nuova.
- Contatto dell'informativa: `Michele Matula, matulamichele@gmail.com`.
- Portale di produzione: `https://homeradar-portale.homeradar-pilot-worker.workers.dev`.
- Lo Store non accetta `key` nel manifest; la build per lo Store non deve mai sovrascrivere `apps/connector/.output` (quella che si carica non pacchettizzata).

## Già fatti (verificati nel codice, fuori dal piano)

- «N pagine in attesa d'invio» si aggiorna con `pending > 0` (`Sweep.tsx`, test in `sweep.test.tsx`).
- Finestra del giro non aperta: il runner mette in coda la fine `interrupted` (`runner.ts` ~riga 175).
- Messaggio dell'incognito già corretto in `Sweep.tsx`.

## Review Focus

1. Ricollegamento con lo stesso gruppo d'errore su dispositivo vecchio e nuovo: i conteggi si sommano, nessun errore di vincolo UNIQUE (test in Task 1).
2. Impostazioni: `0` in «Ribasso di almeno» è valido e si salva; solo il campo vuoto blocca (test in Task 4).
3. Telefono (`narrow()`): chiudendo la scheda si torna ancora alla posizione della lista (test in Task 3).
4. Salvataggio più recente che fallisce mentre uno più vecchio riesce: l'errore si vede e lo stato a video non torna indietro (test in Task 2).
5. Build per lo Store lanciata dopo quella normale: `.output/chrome-mv3/manifest.json` ha ancora `key` (verifica in Task 6).

---

### Task 1: Minori del server (errori e ricollegamento)

**Files:**
- Modify: `apps/server/src/device.ts` (`replaceDevice`)
- Modify: `apps/server/src/errors.ts` (`recordErrors`)
- Modify: `apps/server/src/session.ts` (`authenticate`)
- Modify: `apps/server/src/routes/errors.ts`
- Test: `apps/server/test/link.test.ts`, `apps/server/test/errors.test.ts`

**Interfaces:**
- Produces: `authenticate(req, env, now, touch = true)`: con `touch` false non scrive `users.last_seen_at`. `replaceDevice` firma invariata.

- [ ] **Step 1: test che falliscono**

In `link.test.ts`, nel `describe` del ricollegamento (accanto a `linked(cookie, previousToken)`):

```ts
it('ricollegando, gli errori del dispositivo vecchio passano al nuovo e si sommano', async () => {
  // errore uguale (stessa versione e messaggio) registrato sia dal vecchio sia dal nuovo, più uno solo del vecchio
  // dopo il ricollegamento: nessuna riga con device_id del vecchio;
  // il gruppo comune ha count = somma, first_at = minimo; quello solo del vecchio ha device_id del nuovo
});
```

Gli errori si inseriscono con `recordErrors(env.DB, { source: 'connector', version: '0.1.0', userId, deviceId, deviceName }, [...], now)`.

In `errors.test.ts`:

```ts
it('un errore senza contesto non cancella quello già salvato', async () => {
  // stesso errore due volte, la prima con context 'pagina 2', la seconda senza → context resta 'pagina 2'
});
it('gli errori del portale non aggiornano l\'ultimo accesso', async () => {
  // utente con last_seen_at = null, POST /api/errors con il suo cookie → last_seen_at ancora null
});
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `npx vitest run test/link.test.ts test/errors.test.ts` (in `apps/server`)
Expected: i tre nuovi FAIL.

- [ ] **Step 3: implementare**

- `replaceDevice`: nel `db.batch`, prima del `DELETE FROM devices`, un `INSERT INTO errors (...) SELECT source, version, message, user_id, ?newId, device_name, context, count, first_at, last_at FROM errors WHERE device_id = ?oldId AND true ON CONFLICT (source, version, message, user_id, device_id) DO UPDATE SET count = count + excluded.count, first_at = MIN(first_at, excluded.first_at), last_at = MAX(last_at, excluded.last_at), context = COALESCE(context, excluded.context)` (stessa forma di `anonymizeErrors`), poi `DELETE FROM errors WHERE device_id = ?oldId`. Aggiornare il commento della funzione.
- `recordErrors`: `context = COALESCE(excluded.context, context)`.
- `authenticate(..., touch = true)`: il blocco di `last_seen_at` solo se `touch`. In `routes/errors.ts` chiamarla con `false`.

- [ ] **Step 4: test verdi**

Run: `npm test -w apps/server` e `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit** — `fix(server): errori al dispositivo nuovo, contesto conservato, ultimo accesso senza errori`

### Task 2: Scheda del lead — ultimo salvataggio e «Separa»

**Files:**
- Modify: `apps/web/src/components/LeadDetail.tsx`
- Test: `apps/web/test/lead-detail.test.tsx`

- [ ] **Step 1: test che falliscono**

```ts
it('due salvataggi ravvicinati: vince l\'ultimo partito anche se risponde prima', async () => {
  // fetch stubbato a mano: la PATCH con `notes` resta in attesa (promise risolta dal test),
  // la PATCH con `status: 'contacted'` risponde subito con status 'contacted'.
  // Scrivere la nota, cambiare stato (il blur della nota parte prima), risolvere la PATCH della nota
  // con uno stato che ha ancora status 'to_contact' → la select resta su 'contacted'.
});
it('se l\'ultimo salvataggio fallisce si vede l\'errore e lo stato a video non torna indietro', async () => {
  // PATCH nota lenta e riuscita (status vecchio), PATCH stato che risponde 500 → alert con l'errore,
  // la risposta della nota non riporta indietro la select rispetto a quanto mostrato prima.
});
it('Separa non parte due volte', async () => {
  // POST /api/leads/split lenta; due clic su «Separa Idealista» → una sola chiamata POST, bottone disabled durante l'attesa
});
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `npx vitest run test/lead-detail.test.tsx` (in `apps/web`)

- [ ] **Step 3: implementare**

- `const seq = useRef(0)`; in `save` `const mine = ++seq.current` prima della richiesta; `onSaved(r.state)` solo se `mine === seq.current`. L'errore si mostra sempre. Il salvataggio della nota alla chiusura resta com'è (la scheda è già smontata).
- `const [splitting, setSplitting] = useState(false)`; in `split` uscita immediata se `splitting`, `true` prima della richiesta e `false` in `finally`; i bottoni «Separa» `disabled={splitting}`.

- [ ] **Step 4: test verdi** — Run: `npm test -w apps/web`
- [ ] **Step 5: commit** — `fix(web): nella scheda vince l'ultimo salvataggio; Separa una volta sola`

### Task 3: Lista dei lead — scorrimento e ritorno dalla sospensione

**Files:**
- Modify: `apps/web/src/pages/Leads.tsx`
- Test: `apps/web/test/leads.test.tsx`

- [ ] **Step 1: test che falliscono**

```ts
it('su desktop chiudendo la scheda non si salta a una posizione vecchia', async () => {
  // spy su window.scrollTo; aprire un lead, «← Lead» → scrollTo non chiamato con la posizione della lista
});
it('sul telefono chiudendo la scheda si torna dov\'era la lista', async () => {
  // matchMedia stubbato con matches: true per '(max-width: 899px)'; window.scrollY = 500 al clic sulla riga,
  // «← Lead» → scrollTo(0, 500)
});
it('tornando sulla pagina dopo la mezzanotte i richiami si ricalcolano', async () => {
  // vi.useFakeTimers({ toFake: ['Date'] }) (i timer veri non scattano: come un PC sospeso);
  // 23:59 di Roma con un richiamo per domani; setSystemTime +2 minuti;
  // fireEvent(document, new Event('visibilitychange')) → link «1 da richiamare» e tab «Richiami (1 da fare)»
});
```

- [ ] **Step 2: eseguire e vederli fallire** — Run: `npx vitest run test/leads.test.tsx`

- [ ] **Step 3: implementare**

- Nell'effetto di `selectedKey`: `if (!open) { if (narrow()) window.scrollTo(0, listScroll.current); }`; commento aggiornato («sul telefono»).
- Nuovo effetto: su `visibilitychange` (quando `document.visibilityState === 'visible'`) e su `focus` di `window`, `setNow(Date.now())`; rimozione dei listener al cleanup. `Sweep` si ridisegna con `Leads`, quindi anche «Giro di oggi da fare» si ricalcola.

- [ ] **Step 4: test verdi** — Run: `npm test -w apps/web`
- [ ] **Step 5: commit** — `fix(web): scorrimento solo sul telefono, «oggi» ricalcolato al ritorno`

### Task 4: Impostazioni — campo numerico vuoto

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`
- Test: `apps/web/test/settings.test.tsx`

- [ ] **Step 1: test che falliscono**

```ts
it('un campo numerico vuoto non si manda e lo dice', async () => {
  // svuotare «Online da almeno (giorni)», Salva → nessuna PUT; alert
  // "Scrivi un numero in «Online da almeno» e in «Ribasso di almeno»"
});
it('ribasso 0 si salva', async () => {
  // «Ribasso di almeno (%)» = 0 → PUT con { minDropPercent: 0 }
});
```

- [ ] **Step 2: eseguire e vederli fallire** — Run: `npx vitest run test/settings.test.tsx`

- [ ] **Step 3: implementare**

In `submit`, prima della richiesta: se `!Number.isFinite(draft.minAgeDays) || !Number.isFinite(draft.minDropPercent)` → `setError('Scrivi un numero in «Online da almeno» e in «Ribasso di almeno»')` e uscita. Gli `input` mostrano `''` quando il valore è `NaN` (React non vuole `NaN` in `value`).

- [ ] **Step 4: test verdi** — Run: `npm test -w apps/web`
- [ ] **Step 5: commit** — `fix(web): impostazioni, campo numerico vuoto`

### Task 5: Informativa minima

**Files:**
- Modify: `apps/web/src/pages/Privacy.tsx`
- Test: `apps/web/test/routes.test.tsx`

- [ ] **Step 1: test che fallisce**

```ts
it('/informativa è pubblica e dice cosa non si salva mai e chi contattare', async () => {
  // GET /api/me → 401; renderAt('/informativa') → heading 'Informativa (versione di prova)',
  // testo /Mai numeri di telefono né nomi dei venditori/, link mailto:matulamichele@gmail.com
});
```

- [ ] **Step 2: eseguirlo e vederlo fallire** — Run: `npx vitest run test/routes.test.tsx`

- [ ] **Step 3: implementare** con questo testo (titoli `h1`/`h2` dentro la `card` esistente):

> **Informativa (versione di prova)**
>
> Questa è la versione per la fase di prova di HomeRadar. Il testo completo arriverà prima dell'apertura del servizio.
>
> **Cosa fa il connettore**
> Il connettore è l'estensione di Chrome che fa il giro delle ricerche. Legge Immobiliare.it, Idealista, Subito e CasaDaPrivato solo durante un giro che lanci tu dal portale con «Cerca», e solo nella scheda aperta per quel giro. Fuori dal giro non legge niente.
> Durante il giro, su Immobiliare.it e Subito i dati letti passano dalla pagina del sito al connettore: per come funzionano quei siti, sono visibili anche ai loro script.
>
> **Cosa arriva al portale**
> Solo annunci di privati, e di ognuno solo: link, titolo, indirizzo, comune e zona, tipologia, superficie, locali, prezzo e ribassi, data dell'annuncio, foto di copertina. Mai numeri di telefono né nomi dei venditori.
> Gli annunci formano un archivio condiviso fra gli agenti della stessa zona. Stati, note, richiami e impostazioni sono solo tuoi: nessun altro li vede.
>
> **Cos'altro registra il portale**
> I computer collegati (nome del browser e del sistema, versione del connettore, ultimo uso) e gli errori del portale e del connettore, ripuliti dai dati degli annunci e tenuti 90 giorni.
>
> **Contatti**
> Per domande o per chiedere la cancellazione dei tuoi dati: Michele Matula, matulamichele@gmail.com (link `mailto:`).

- [ ] **Step 4: test verdi** — Run: `npm test -w apps/web`
- [ ] **Step 5: commit** — `feat(web): informativa per la fase di prova`

### Task 6: Pacchetto per il Chrome Web Store

**Files:**
- Modify: `apps/connector/wxt.config.ts`, `apps/connector/package.json` (script `zip`), `.gitignore` (se `.output-store` non è già coperto)
- Create: `docs/web-store.md`
- Modify: `docs/deploy.md` (sezione «Connettore»)

- [ ] **Step 1: build per lo Store**

In `wxt.config.ts`: con `process.env.WXT_STORE === '1'` il manifest non ha `key` e `outDir` è `.output-store` (resta `.output-e2e` per `WXT_SWEEP_FAST`). Script `"zip": "wxt zip"` in `apps/connector/package.json`.

- [ ] **Step 2: verifica**

Run (bash, dalla radice):
```bash
WXT_PORTAL_URL=https://homeradar-portale.homeradar-pilot-worker.workers.dev npm run build -w apps/connector
WXT_STORE=1 WXT_PORTAL_URL=https://homeradar-portale.homeradar-pilot-worker.workers.dev npm run zip -w apps/connector
node -e "const m=require('./apps/connector/.output-store/chrome-mv3/manifest.json');console.log('key' in m, m.version, m.externally_connectable.matches)"
node -e "console.log('key' in require('./apps/connector/.output/chrome-mv3/manifest.json'))"
ls apps/connector/.output-store/*.zip
```
Expected: `false 0.1.0 [ 'https://homeradar-portale.homeradar-pilot-worker.workers.dev/*' ]`, poi `true`, e uno zip presente. `npm test -w apps/connector` verde.

- [ ] **Step 3: `docs/web-store.md`**

Testi pronti da incollare nella dashboard, in italiano:
- **Nome** (`HomeRadar connettore`), **descrizione breve** (quella del manifest), **descrizione lunga** (a cosa serve, che funziona solo con un account del portale, quando legge e cosa manda; nessuna interfaccia propria).
- **Scopo unico**: cercare, quando l'agente lo chiede dal portale HomeRadar, gli annunci di privati della sua zona sui quattro portali e mandarli al suo archivio.
- **Motivo di ogni permesso**: `storage` (token del collegamento, coda d'invio, errori), `alarms` (riprovare gli invii, contatto quotidiano), `notifications` (un solo avviso: i dati del giro non riescono a partire da tempo, `STUCK_TEXT` in `background.ts`), host Immobiliare/Idealista/Subito/CasaDaPrivato (leggere i risultati delle ricerche nella scheda del giro), host del portale (API del portale e messaggi dalla sua pagina). Codice remoto: no.
- **Uso dei dati**: categorie da spuntare (contenuti del sito web letti; dati di attività/identificativi tecnici: nome del browser e del sistema); dichiarazioni (non si vendono, non si usano per altro, non per la solvibilità); indirizzo informativa `https://homeradar-portale.homeradar-pilot-worker.workers.dev/informativa`.
- **Distribuzione**: visibilità «Non in elenco», paesi: Italia; categoria suggerita.
- **Istruzioni per i revisori**: creare dall'admin un agente di prova con un comune (es. Salerno) e scrivere email e password **solo** nel campo «Istruzioni per il test» della dashboard (mai nel repository); passi: accedi, «Cerca», il connettore apre la finestra del giro.
- **Da fare a mano**: almeno uno screenshot 1280×800 del portale (lista lead e giro), icona 128 già in `public/icon`; ogni nuovo caricamento richiede una `version` più alta in `apps/connector/package.json`.
- **Dopo l'approvazione**: rimando al Task 7.

- [ ] **Step 4: `docs/deploy.md`** — nella sezione «Connettore» un paragrafo «Pacchetto per lo Store» con il comando dello Step 2 e il rimando a `docs/web-store.md`.

- [ ] **Step 5: commit** — `feat(connector): pacchetto per il Chrome Web Store`

### Task 7: Test end-to-end del portale (invito → accesso → lead)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/scripts/e2e.mjs`, `apps/web/tests/e2e/onboarding.spec.ts`
- Modify: `apps/web/package.json` (script `test:e2e`, devDependency `@playwright/test` alla stessa versione del connettore), `apps/web/vitest.config.ts` o `vite.config.ts` (Vitest non deve prendere `tests/e2e`), `.gitignore` (`apps/web/.e2e-state`), `CLAUDE.md` (comando nella lista), `docs/deploy.md` se serve

**Interfaces:**
- `npm run test:e2e -w apps/web` = `node scripts/e2e.mjs`: (1) `npm run build -w apps/web`; (2) cancella e ricrea `apps/web/.e2e-state`; (3) da `apps/server`, con `CI=1`: `npx wrangler d1 migrations apply homeradar-portale --local --persist-to ../web/.e2e-state`; (4) scrive un SQL di seed in una cartella temporanea e lo esegue con `npx wrangler d1 execute homeradar-portale --local --persist-to ../web/.e2e-state --file <file>`; (5) `npx playwright test`.
- `playwright.config.ts`: `webServer` = `npx wrangler dev --port 8788 --persist-to ../web/.e2e-state` con `cwd` `../server`, `url` `http://localhost:8788`, `reuseExistingServer: false`; `use.baseURL` `http://localhost:8788`; `workers: 1`.

- [ ] **Step 1: seed**

In `scripts/e2e.mjs`:
- admin `admin@homeradar.test`, password `password-e2e-admin` (solo per lo stato locale di prova), hash PBKDF2-SHA256 100 000 iterazioni nel formato `pbkdf2$100000$<salt b64url>$<hash b64url>` (stessa funzione di `apps/server/scripts/create-admin.mjs`), riga `users` come in quello script;
- tre annunci di privati a Treviglio in `listings`: chiavi `immobiliare:1001`, `idealista:1002`, `subito:1003`, `url` validi per il portale (es. `https://www.immobiliare.it/annunci/1001/`), titoli `Trilocale in centro`, `Villa con giardino`, `Bilocale luminoso`, `city` `Treviglio`, `city_norm` `treviglio`, `scope_istat` `016219`, `category` `residential`, `current_price` valorizzato, `portal_created_at` = ora − 200 giorni, `first_seen_at` = ora − 1 giorno, `last_seen_at` = ora, `seen_count` 1 (gli altri NOT NULL ai default delle migrazioni).

- [ ] **Step 2: il test**

`onboarding.spec.ts`, un solo test:
1. `/`: accesso come admin → `/admin/utenti`; form «Nuovo agente»: email `agente@homeradar.test`, comune Treviglio dal selettore, invio → il link d'invito compare nel riquadro (`.linkbox__url`).
2. Nuovo `browser.newContext()` (nessun cookie): apre il link → password `password-e2e-agente` due volte, spunta l'informativa, invio → pagina dei lead con le tre righe (`Apri il lead: Trilocale in centro` ecc.).
3. Clic su `Trilocale in centro` → scheda; Stato = «Contattato» (etichetta da `STATUS_LABELS`) → ricarica la pagina → la select mostra ancora quello stato.
4. Esci → accesso con email e password dell'agente → di nuovo la lista con i lead.

- [ ] **Step 3: eseguire**

Run: `npm run test:e2e -w apps/web`
Expected: 1 passed. Poi `npm test -w apps/web` verde (gli e2e non entrano in Vitest).

- [ ] **Step 4: commit** — `test(web): e2e invito → accesso → lead`

---

### Task 8 (dopo l'approvazione dello Store): ID dello Store e link d'installazione

Si esegue solo quando Michele porta dalla dashboard l'**ID** dell'elemento e la **chiave pubblica** (Pacchetto → «Visualizza chiave pubblica», senza intestazioni `-----BEGIN…`).

**Files:**
- Modify: `apps/connector/src/key.ts` (`MANIFEST_KEY` = chiave dello Store; commento: «chiave pubblica del Web Store»)
- Modify: `packages/shared/src/api/connector-messages.ts` (`CONNECTOR_ID` = ID dello Store; nuova `export const CONNECTOR_STORE_URL = \`https://chromewebstore.google.com/detail/${CONNECTOR_ID}\``)
- Modify: `apps/web/src/components/Sweep.tsx` (messaggio «Connettore non trovato»)
- Modify: `docs/deploy.md`, `docs/web-store.md`
- Test: `apps/connector/tests/unit/key.test.ts` (invariato, deve passare), `apps/web/test/sweep.test.tsx`

- [ ] **Step 1: test che fallisce** — in `sweep.test.tsx`: connettore assente → link «installalo» con `href` = `CONNECTOR_STORE_URL`, `target="_blank"`.
- [ ] **Step 2: implementare** — chiave e ID; nel messaggio «installalo» diventa `<a href={CONNECTOR_STORE_URL} target="_blank" rel="noreferrer">installalo dal Chrome Web Store</a>`.
- [ ] **Step 3: verifica** — `npm test` e `npm run typecheck` verdi (il test della chiave conferma che chiave e ID coincidono).
- [ ] **Step 4: documenti** — `docs/deploy.md` «Connettore»: per i piloti installazione dallo Store e collegamento col primo «Cerca»; la non pacchettizzata resta per lo sviluppo; dopo il cambio di ID i connettori non pacchettizzati vecchi non parlano più col portale (vanno rimossi). Deploy del portale (`npm run deploy -w apps/server` dopo `npm run build`).
- [ ] **Step 5: commit** — `feat: connettore dal Chrome Web Store`

## Dopo il Task 7

Revisione finale del branch, push e PR (il merge lo fa Michele). Deploy del portale con le correzioni; caricamento dello zip sullo Store da parte di Michele. Il Task 8 si fa in una sessione successiva, su un branch nuovo, quando lo Store ha approvato.
