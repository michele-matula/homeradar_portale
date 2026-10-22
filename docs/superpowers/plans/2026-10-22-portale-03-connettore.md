# Portale, tappa 3: connettore — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un'estensione MV3 senza interfaccia (`apps/connector`) che si collega all'account dell'agente dal portale, fa il giro delle ricerche quando l'agente preme «Cerca» nel portale, legge solo nella scheda del giro e manda al server lotti, esiti e fine del giro attraverso una coda persistente che rispetta l'ordine in cui nascono.

**Architecture:** Il connettore riprende da `../homeradar` bridge, lettura delle pagine (controller senza badge né banner) e runner del giro; il piano arriva da `POST /connector/sweeps`, e ogni pagina letta diventa un lotto messo in coda (IndexedDB) insieme agli esiti delle ricerche e alla fine del giro. La coda manda un elemento alla volta, in ordine, con attese crescenti. Il portale parla al connettore con `chrome.runtime.sendMessage(CONNECTOR_ID, …)` (`externally_connectable` limitato all'origine del portale); il server aggiunge il collegamento con codice monouso e la lista dei dispositivi. L'avanzamento il portale lo legge dal server (`GET /api/sweep`), non dal connettore.

**Tech Stack:** TypeScript 7, zod 4, WXT 0.21 (MV3), Vitest 5 + fake-indexeddb, Playwright (Chromium con estensione), Cloudflare Workers + D1, React 19.

**Spec:** `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md` (§4 punto 4; §6.2 Collegare il connettore; §6.3 Il giro delle ricerche; §6.4 Rete assente o server giù; §7 cosa si riprende; §8; §9). Codice da riprendere: `../homeradar/src/background/sweep-runner.ts`, `src/content/controller.ts`, `src/bridge/bridge.ts`, `src/entrypoints/*.content.ts`, `tests/unit/background/sweep-runner.test.ts`, `tests/unit/content/controller.test.ts`, `tests/unit/bridge/bridge.test.ts`, `tests/e2e/{fixtures,fixture-page,sweep.spec}.ts`, `public/icon/*`.

## Global Constraints

- Il connettore legge solo durante un giro e solo nella scheda del giro: i content script chiedono al background (`isSweepTab`) prima di leggere; il background scarta comunque i messaggi di altre schede o di pagine non attese.
- Dal connettore escono solo annunci con `sellerType: 'private'` e solo i campi di `ObservationSchema` (`packages/shared/src/api/connector.ts`), validati con lo stesso schema prima dell'invio. Mai nomi né telefoni.
- Il server non fa richieste ai portali; il connettore non fa richieste proprie ai portali (legge ciò che la pagina ha caricato).
- Ogni pagina contata dal giro produce un lotto, **anche vuota** (pagina 1 con 0 risultati compresa): senza lotti il server non applica "non più visto".
- Coda: un elemento alla volta, nell'ordine d'inserimento; attese `RETRY_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000]` (l'ultima si ripete); oltre `GIVE_UP_MS = 86_400_000` dalla nascita l'elemento non si ritenta più da solo (resta in coda, notifica "HomeRadar non riesce a inviare i dati: controlla la connessione" e "!" sull'icona).
- Messaggi esterni accettati solo se `sender.origin` è l'origine del portale (`WXT_PORTAL_URL`); il manifest ha `externally_connectable.matches = ["<origine>/*"]`.
- Codice di collegamento: monouso, 5 minuti (`LINK_CODE_TTL_MS = 5 * 60_000`), salvato solo come SHA-256 (`hashToken`); il token del dispositivo sta in `chrome.storage.local` (chiave `token`).
- Tempi di prova (`WXT_SWEEP_FAST=1`) solo nella build e2e, letti con il letterale `import.meta.env.WXT_SWEEP_FAST` nel codice del connettore; `packages/shared` non legge più variabili d'ambiente.
- Testi in italiano; errori delle API `{ "error": "…" }`; timestamp ms epoch UTC; nessun segreto nel repository (la chiave pubblica del manifest non lo è).
- Migrazioni: si aggiunge `0004_link_codes.sql`, le esistenti non si toccano.
- `PRIVACY_VERSION` resta 1 (informativa ancora segnaposto); il Task 9 aggiunge alla riga della tappa 6 della roadmap cosa dirà sui dispositivi.

## Review Focus

1. Service worker riavviato o browser chiuso a giro in corso → al riavvio il giro si chiude come interrotto: in coda, dopo i lotti e gli esiti già nati, va la fine `interrupted`; la coda riparte da sola. Test nel Task 5.
2. L'agente apre a mano Immobiliare in un'altra scheda durante il giro (o senza giro) → nessun lotto parte da quella scheda. Test nei Task 5 e 8.
3. Server giù o rete assente per qualche minuto a metà giro → il giro continua, i lotti restano in coda nell'ordine, partono quando il server torna; il portale vede "N pagine in attesa d'invio". Test nei Task 4 e 8.
4. Dispositivo scollegato dal portale mentre la coda ha elementi → il primo 401 svuota la coda e cancella il token; il ping dice `linked: false` e il portale ricollega al «Cerca» successivo. Test nei Task 4 e 6.
5. Ricerca senza annunci (pagina 1 con 0 risultati) → parte comunque il lotto della pagina 1 e poi l'esito `complete`. Test nel Task 5.

---

## Struttura dei file

```
packages/shared/src/
  core/sweep.ts                 tolti FAST e la lettura dell'ambiente; pauseMs(range, random)
  api/connector.ts              + LinkBody, DeviceInfo
  api/connector-messages.ts     NUOVO  messaggi portale ↔ connettore, CONNECTOR_ID
apps/server/
  migrations/0004_link_codes.sql
  src/device.ts                 + codici di collegamento, lista e cancellazione dei dispositivi
  src/routes/devices.ts         NUOVO  /api/devices*
  src/routes/connector.ts       + POST /connector/link
  src/ingest.ts                 started_at della ricerca = lettura più vecchia
apps/connector/                 NUOVO  estensione WXT
  wxt.config.ts, package.json, tsconfig.json, vitest.config.ts, playwright.config.ts, .gitignore
  scripts/generate-key.mjs, scripts/build-e2e.mjs
  public/icon/*                 copiate da ../homeradar
  src/timing.ts                 tempi normali / di prova
  src/key.ts                    chiave pubblica del manifest
  src/bridge.ts                 da homeradar
  src/reader.ts                 lettura delle pagine (controller senza badge)
  src/outgoing.ts               osservazioni → campi ammessi; lotti, esiti, fine
  src/queue.ts, src/queue-store.ts   coda d'invio e suo IndexedDB
  src/client.ts                 richieste a /connector/*
  src/runner.ts                 giro (da sweep-runner.ts)
  src/external.ts               messaggi del portale
  src/device-name.ts            "Chrome su Windows"
  src/entrypoints/background.ts, *.content.ts, *-bridge.content.ts
  tests/unit/*.test.ts, tests/e2e/*
apps/web/src/
  connector.ts                  NUOVO  messaggi al connettore
  components/Sweep.tsx          NUOVO  «Cerca», «Ferma», stato, installazione
  components/Devices.tsx        NUOVO  computer collegati
  pages/Home.tsx
```

---

### Task 1: Pacchetto condiviso — tempi fuori da `core/sweep.ts`, messaggi del connettore

**Files:**
- Modify: `packages/shared/src/core/sweep.ts`, `packages/shared/src/api/connector.ts`
- Create: `packages/shared/src/api/connector-messages.ts`
- Test: `packages/shared/tests/unit/core/sweep.test.ts`, `packages/shared/tests/unit/api/connector-messages.test.ts`

**Interfaces:**
- Produces:
  - `core/sweep.ts`: `PAGE_TIMEOUT_MS = 45_000` e `PAUSE_MS` (valori normali, senza `FAST`); `pauseMs(range: [number, number], random: () => number): number`. Nessun riferimento a `import.meta`.
  - `api/connector.ts`: `LinkBody = body({ code: string 1..200, name: string 1..100, version: string 1..20 })` (errore `'Richiesta non valida'`); `interface DeviceInfo { id: string; name: string; createdAt: number; lastSeenAt: number | null }`.
  - `api/connector-messages.ts`:
    ```ts
    export const CONNECTOR_ID: string;                     // fissato nel Task 3 dalla chiave del manifest
    export const PortalMessage: z.ZodType<PortalMessage>;  // discriminatedUnion su type, oggetti strict
    export type PortalMessage = { type: 'ping' } | { type: 'link'; code: string } | { type: 'startSweep' } | { type: 'stopSweep' };
    export interface ConnectorState { version: string; linked: boolean; sweeping: boolean; pending: number; stuck: boolean }
    export interface SweepStarted { sweepId: string | null; total: number; skipped: number }
    export type ConnectorReply<T> = { ok: true; data: T } | { ok: false; error: string; notLinked?: true };
    export const NOT_LINKED = 'Connettore non collegato';
    ```

- [ ] **Step 1: Test** — in `sweep.test.ts` sostituisci le attese di `pauseMs` con `pauseMs(PAUSE_MS.immobiliare, () => 0) === 4000`, `pauseMs([100, 200], () => 0.5) === 150`; aggiungi `expect(PAGE_TIMEOUT_MS).toBe(45_000)`. In `connector-messages.test.ts`: `PortalMessage.safeParse({ type: 'link', code: 'x' }).success === true`; falsi per `{ type: 'link' }`, `{ type: 'ping', extra: 1 }`, `{ type: 'boh' }`, `null`.
- [ ] **Step 2:** `npm test -w packages/shared` → FAIL sui test nuovi.
- [ ] **Step 3: Implementa** come da Interfaces; `CONNECTOR_ID` provvisorio `'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`, sostituito nel Task 3.
- [ ] **Step 4:** `npm test -w packages/shared && npm run typecheck` → PASS (il server non usa `pauseMs`).
- [ ] **Step 5: Commit** `feat(shared): tempi del giro senza ambiente, messaggi del connettore`

---

### Task 2: Server — collegamento con codice, dispositivi, inizio della ricerca

**Files:**
- Create: `apps/server/migrations/0004_link_codes.sql`, `apps/server/src/routes/devices.ts`, `apps/server/test/link.test.ts`
- Modify: `apps/server/src/device.ts`, `apps/server/src/routes/connector.ts`, `apps/server/src/index.ts`, `apps/server/src/ingest.ts`, `apps/server/test/helpers.ts` (`resetDb` con `link_codes`), `apps/server/test/ingest.test.ts`

**Interfaces:**
- Consumes: `LinkBody`, `DeviceInfo` (Task 1); `insertDevice`, `hashToken`, `newToken`, `userRoute`, `route`, `readBody`.
- Produces:
  - Tabella `link_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)`.
  - `device.ts`: `LINK_CODE_TTL_MS`; `createLinkCode(db, userId, now): Promise<string>` (cancella prima i codici scaduti); `redeemLinkCode(db, code, now): Promise<string | null>` (user id; `DELETE … WHERE code_hash = ? AND expires_at > ? RETURNING user_id`, quindi monouso anche in parallelo); `listDevices(db, userId): Promise<DeviceInfo[]>` (per `created_at`); `deleteDevice(db, userId, id): Promise<boolean>`. `insertDevice(db, userId, name, now, version: string | null = null)` salva anche la versione (chi la chiama oggi, `linkDevice` dei test, non cambia).
  - Rotte: `POST /api/devices/link-code` → 201 `{ code }`; `GET /api/devices` → `DeviceInfo[]`; `DELETE /api/devices/:id` → 204, 404 `'Dispositivo non trovato'` se non è dell'utente. `POST /connector/link` (senza token) → 201 `{ token }`; 400 `'Codice di collegamento non valido o scaduto'`; 403 `'Account sospeso'` se l'utente non è attivo.

- [ ] **Step 1: Test** in `link.test.ts`:
  - codice dal portale → `/connector/link` con `{ code, name: 'Chrome su Windows', version: '0.1.0' }` → 201; il token apre `POST /connector/sweeps` (non 401); `GET /api/devices` ha un elemento con quel nome e `lastSeenAt` numerico.
  - stesso codice due volte → la seconda 400; due richieste in parallelo con lo stesso codice → una 201 e una 400.
  - codice scaduto (`vi.setSystemTime` oltre 5 minuti, o `expires_at` riscritto nel passato) → 400.
  - utente sospeso dopo la creazione del codice → 403.
  - `DELETE /api/devices/:id` di un altro agente → 404 e il dispositivo resta; il proprio → 204 e il suo token riceve 401 su `/connector/sweeps`.
  - `POST /api/devices/link-code` senza sessione → 401; senza `Origin` → 403.
  In `ingest.test.ts`: due lotti della stessa ricerca con `readAt` 2000 e poi 1000 (dopo l'inizio del giro) → `search_runs.started_at` = 1000.
- [ ] **Step 2:** `npm test -w apps/server` → FAIL.
- [ ] **Step 3: Implementa.** In `ingest.ts` `started_at = MIN(COALESCE(started_at, ?3), ?3)`. Le rotte dei dispositivi vanno nell'elenco `routes` di `index.ts`; `/connector/link` in `connectorRoutes` con `route()` (non `deviceRoute`).
- [ ] **Step 4:** `npm test -w apps/server && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(server): collegamento del connettore con codice monouso e lista dei dispositivi`

---

### Task 3: Scheletro del connettore e tempi di prova verificati

**Files:**
- Create: `apps/connector/{package.json,tsconfig.json,wxt.config.ts,vitest.config.ts,.gitignore}`, `scripts/generate-key.mjs`, `scripts/build-e2e.mjs`, `src/key.ts`, `src/timing.ts`, `src/entrypoints/background.ts` (vuoto per ora: `defineBackground(() => {})`), `public/icon/*` (da `../homeradar/public/icon`), `tests/unit/key.test.ts`
- Modify: `packages/shared/src/api/connector-messages.ts` (`CONNECTOR_ID` vero), `package.json` di radice (`allowScripts` se `npm install` lo chiede)

**Interfaces:**
- Produces:
  - `package.json` `@homeradar/connector`: dipendenze `@homeradar/shared`, `zod`; dev `wxt`, `vitest`, `fake-indexeddb`, `jsdom`, `@playwright/test`, `typescript`; script `postinstall: wxt prepare`, `build: wxt build`, `typecheck: tsc --noEmit`, `test: vitest run`, `test:e2e: node scripts/build-e2e.mjs && playwright test`.
  - `src/key.ts`: `MANIFEST_KEY` (chiave pubblica base64, una riga) ed `extensionId(key: string): Promise<string>` (SHA-256 del DER, primi 32 caratteri esadecimali mappati `0-f → a-p`).
  - `src/timing.ts`:
    ```ts
    export interface ConnectorTiming { pageTimeoutMs: number; pauseMs: Record<Portal, [number, number]>; retryMs: number[]; giveUpMs: number }
    export const NORMAL_TIMING: ConnectorTiming;  // PAGE_TIMEOUT_MS, PAUSE_MS, RETRY_MS, 86_400_000
    export const FAST_TIMING: ConnectorTiming;    // 5_000; [100, 200] per ogni portale; [500, 1_000]; 60_000
    export const TIMING: ConnectorTiming = import.meta.env.WXT_SWEEP_FAST === '1' ? FAST_TIMING : NORMAL_TIMING;
    ```
  - `wxt.config.ts`: `WXT_PORTAL_URL` obbligatorio (errore di build se manca); `outDir` `.output-e2e` con `WXT_SWEEP_FAST=1`; manifest `name: 'HomeRadar connettore'`, `key: MANIFEST_KEY`, `permissions: ['storage', 'alarms', 'notifications']`, `host_permissions`: i quattro portali (come `../homeradar/wxt.config.ts`) più `<origine>/*`, `externally_connectable: { matches: ['<origine>/*'] }`, `action: { default_title: 'HomeRadar' }` senza popup.
  - `scripts/build-e2e.mjs`: `wxt build` con `WXT_SWEEP_FAST=1` e `WXT_PORTAL_URL=http://localhost:8799`.

- [ ] **Step 1:** crea il workspace e lancia `npm install` dalla radice; `node apps/connector/scripts/generate-key.mjs` genera una coppia RSA 2048 con `node:crypto` e stampa solo la chiave pubblica SPKI DER in base64 e l'ID (la privata non si salva: per l'ID basta la pubblica; alla pubblicazione, tappa 6, si mette quella del Web Store). Copia la chiave in `src/key.ts` e l'ID in `CONNECTOR_ID`.
- [ ] **Step 2: Test** `key.test.ts`: `await extensionId(MANIFEST_KEY) === CONNECTOR_ID`, e l'ID è `/^[a-p]{32}$/`.
- [ ] **Step 3:** `npm test -w apps/connector && npm run typecheck -w apps/connector` → PASS.
- [ ] **Step 4: Verifica la sostituzione di `WXT_SWEEP_FAST`** (vincolo della roadmap). Usa `TIMING.pageTimeoutMs` in `background.ts` con un `console.debug` provvisorio, poi:
  `WXT_PORTAL_URL=http://localhost:8799 npm run build -w apps/connector` → nel `.output/chrome-mv3/background.js` c'è `45e3` (o `45000`) e non `5e3` come timeout; `node apps/connector/scripts/build-e2e.mjs` → in `.output-e2e/chrome-mv3/background.js` il contrario, e `import.meta.env` non compare in nessuno dei due. Togli il `console.debug`. Senza `WXT_PORTAL_URL` la build fallisce con un messaggio chiaro.
- [ ] **Step 5: Commit** `feat(connector): scheletro WXT con chiave fissa e tempi di prova`

---

### Task 4: Coda d'invio e client del server

**Files:**
- Create: `apps/connector/src/{queue.ts,queue-store.ts,client.ts}`, `tests/unit/{queue.test.ts,queue-store.test.ts,client.test.ts}`

**Interfaces:**
- Consumes: `ConnectorTiming` (Task 3), `NOT_LINKED` (Task 1).
- Produces:
  ```ts
  // queue-store.ts — IndexedDB "homeradar-connector", store "outbox" (keyPath seq, autoIncrement)
  export interface Outgoing { path: string; body: unknown }
  export interface QueueItem extends Outgoing { seq?: number; createdAt: number; attempts: number; nextAt: number }
  export interface QueueStore { add(i: QueueItem): Promise<void>; first(): Promise<QueueItem | null>; put(i: QueueItem): Promise<void>; remove(seq: number): Promise<void>; all(): Promise<QueueItem[]>; clear(): Promise<void> }
  export function openQueueStore(name?: string): QueueStore
  // client.ts
  export interface ServerReply { status: number; data: unknown }   // status 0 = rete assente
  export function createClient(d: { baseUrl: string; token(): Promise<string | null>; fetch: typeof fetch }): { post(path: string, body: unknown): Promise<ServerReply> }
  // queue.ts
  export function createSendQueue(d: {
    store: QueueStore; post(path: string, body: unknown): Promise<ServerReply>; now(): number;
    timing: Pick<ConnectorTiming, 'retryMs' | 'giveUpMs'>;
    schedule(at: number): void;            // background: setTimeout + chrome.alarms
    onStuck(stuck: boolean): void;         // cambia solo al passaggio
    onUnlinked(): Promise<void>;           // cancella il token
  }): { enqueue(o: Outgoing): Promise<void>; flush(opts?: { force?: boolean }): Promise<void>; state(): Promise<{ pending: number; stuck: boolean }> }
  ```
  Regole di `flush`: un solo invio alla volta (una seconda chiamata durante un flush aspetta quello in corso); si manda sempre il primo elemento, solo se `nextAt <= now` o `force` e mai se ha superato `giveUpMs` senza `force`. 2xx → rimosso, avanti. 400, 404, 413 → rimosso (`console.warn` con path e messaggio del server), avanti. 401 → `store.clear()`, `onUnlinked()`, stop. Altro (0, 403, 429, 5xx) → `attempts + 1`, `nextAt = now + retryMs[min(attempts, len) - 1]`, `schedule(nextAt)`, stop. `pending` conta gli elementi con path `/connector/batches`; `stuck` = un elemento con `now - createdAt >= giveUpMs`. `enqueue` aggiunge con `createdAt = nextAt = now`, poi `flush()`.

- [ ] **Step 1: Test** (fake-indexeddb; store finto in memoria per `queue.test.ts`):
  - `queue-store`: tre `add` → `first()` è il primo, `all()` in ordine di `seq`; `remove` e `clear` funzionano; dati sopravvivono a una nuova `openQueueStore()` sullo stesso nome.
  - ordine: tre elementi, `post` 200 → chiamato tre volte nell'ordine d'inserimento.
  - 503 sul primo → secondo non mandato; `attempts: 1`, `schedule(now + 30_000)`; dopo 5 errori le attese sono 30 s, 2 min, 10 min, 30 min, 1 h, poi ancora 1 h.
  - `flush()` prima di `nextAt` → nessun `post`; con `force` → `post`.
  - elemento nato `giveUpMs` fa: `flush()` non manda, `onStuck(true)` una volta, `state().stuck === true`; `flush({ force: true })` 200 → coda vuota e `onStuck(false)`.
  - 400 sul primo → rimosso, il secondo parte.
  - 401 → coda vuota, `onUnlinked` chiamato, nessun altro `post`.
  - `state().pending` conta solo i lotti.
  - due `flush()` in parallelo → ogni elemento mandato una volta sola.
  - `client`: `Authorization: Bearer t` e `Content-Type: application/json` sull'URL `baseUrl + path`; `fetch` che lancia → `{ status: 0 }`; senza token → `{ status: 401, data: { error: NOT_LINKED } }` senza chiamare `fetch`.
- [ ] **Step 2:** `npm test -w apps/connector` → FAIL.
- [ ] **Step 3: Implementa** come da Interfaces.
- [ ] **Step 4:** `npm test -w apps/connector && npm run typecheck -w apps/connector` → PASS.
- [ ] **Step 5: Commit** `feat(connector): coda d'invio persistente con tentativi in ordine`

---

### Task 5: Lettura delle pagine e runner del giro

**Files:**
- Create: `apps/connector/src/{bridge.ts,reader.ts,outgoing.ts,runner.ts}`, `tests/unit/{bridge.test.ts,reader.test.ts,outgoing.test.ts,runner.test.ts}`
- Riferimento: `../homeradar/src/bridge/bridge.ts` e il suo test (copiati senza cambi), `src/content/controller.ts`, `src/background/sweep-runner.ts` e i loro test.

**Interfaces:**
- Consumes: `core/sweep.ts` (Task 1), `ObservationSchema`, `SweepPlan`, `BatchBody`/`RunBody`/`FinishBody` (forme dei corpi), `Outgoing` (Task 4), `ConnectorTiming`, `SweepStarted`.
- Produces:
  ```ts
  // reader.ts — messaggi dal content script al background
  export type ReaderMessage = { type: 'isSweepTab' } | { type: 'page'; url: string; observations: ListingObservation[]; newestId?: number; report: PageReport | null };
  export function createReader(d: { adapter: PortalAdapter; send(m: ReaderMessage): Promise<unknown>; root: ParentNode; getUrl(): string }): { handle(kind: PayloadKind, url: string, payload: unknown): Promise<void>; scan(): Promise<void>; checkProblem(doc: Document): Promise<boolean> }
  // outgoing.ts
  export function toWire(observations: ListingObservation[]): { observations: z.input<typeof ObservationSchema>[]; invalid: number }
  export function batchFor(a: { id: string; sweepId: string; searchKey: string; readAt: number; page: number; report: PageReport; observations: ListingObservation[]; newestId?: number }): Outgoing
  export function settledRuns(before: SweepState, after: SweepState): Outgoing[]
  export function finishFor(sweepId: string, outcome: SweepOutcome): Outgoing
  // runner.ts
  export const SWEEP_RUNNING = 'Giro già in corso';
  export interface RunnerState { sweep: SweepState; windowId: number; tabId: number; awaiting: boolean; expectedUrl: string; previousUrl: string | null; pageObs: ListingObservation[]; newestId: number | null }
  export function createRunner(d: {
    now(): number; random(): number; uuid(): string; setTimer(fn: () => void, ms: number): unknown; clearTimer(h: unknown): void; keepAlive(): () => void;
    openWindow(url: string): Promise<{ windowId: number; tabId: number }>; navigate(tabId: number, url: string): Promise<void>; closeWindow(windowId: number): Promise<void>;
    loadState(): Promise<RunnerState | null>; saveState(s: RunnerState | null): Promise<void>;
    timing: Pick<ConnectorTiming, 'pageTimeoutMs' | 'pauseMs'>;
    plan(): Promise<SweepPlan>;                 // lancia Error col messaggio del server
    enqueue(o: Outgoing): Promise<void>;
  }): { start(): Promise<SweepStarted>; stop(): Promise<void>; running(): Promise<boolean>; isSweepTab(tabId: number | undefined): Promise<boolean>; page(tabId: number | undefined, m: Extract<ReaderMessage, { type: 'page' }>): Promise<void>; windowRemoved(windowId: number): Promise<void>; recover(): Promise<void> }
  ```
  - `createReader` è `createController` senza badge, banner, `portalState` e `parseStatus`: prima di leggere chiede `isSweepTab` e, se `false`, non legge e non manda nulla; legge solo pagine con `adapter.pageKind(url) === 'search'`; una lettura manda **un** messaggio `page` con osservazioni e report insieme (`report` null se la lettura non ha `page`); `checkProblem` manda `page` con 0 osservazioni e report `blocked`/`notFound`.
  - `toWire`: tiene solo `sellerType === 'private'`, copia i soli campi di `ObservationSchema`, scarta (e conta in `invalid`) chi non passa `ObservationSchema.safeParse`.
  - Runner: lo stato del giro usa come id il `sweepId` del piano. `start` con `sweepId` null → `{ sweepId: null, total: 0, skipped }` senza aprire finestre. `page`: accettato solo dalla scheda del giro con `awaiting`; osservazioni accodate in `pageObs` solo se `samePage(expectedUrl, url)` (stesse regole di reindirizzamento e messaggi in ritardo di `pageRead` nel vecchio runner; `markSeen` resta); con `report`: `toWire(pageObs)`, `invalid` sommato a `report.parseErrors`, `onPageRead`; se le pagine della ricerca sono aumentate → `enqueue(batchFor(...))` con `page` = nuove pagine; poi `settledRuns(prima, dopo)` in coda; poi `advance`. Timeout → `onTimeout` e `settledRuns`. Fine (da sé, `stop`, `windowRemoved`, `recover`) → `settledRuns` e `finishFor(id, esito)`, dove l'esito è `finishSweep(...).status` o `'stopped'`/`'interrupted'`. `settledRuns` restituisce un esito `/connector/runs` per ogni ricerca passata da `pending` a un esito diverso da `pending` e da `skipped` (le saltate le chiude il server alla fine). Niente `skipDisabled`, `countNew`, `finish` locale: il piano ha già solo i portali attivi e il risultato lo calcola il server.

- [ ] **Step 1: Test** `bridge.test.ts` copiato. `reader.test.ts` dai casi di `controller.test.ts` che riguardano la lettura (payload, DOM, `checkProblem`, solo pagine di ricerca), più: `isSweepTab` false → `send` chiamato solo con `isSweepTab`; una lettura con `page` → un solo messaggio `page` con `observations` e `report`.
- [ ] **Step 2: Test** `outgoing.test.ts`: `toWire` con un privato, un'agenzia e un privato con `url` di un altro dominio → 1 osservazione, `invalid: 1`, nessuna chiave fuori da `ObservationSchema`; `batchFor` → `path: '/connector/batches'` e corpo che passa `BatchBody.safeParse`; `settledRuns` su un giro con una ricerca da `pending` a `complete` e una a `skipped` → un solo esito, che passa `RunBody.safeParse`; `finishFor` → `path: '/connector/sweeps/<id>/finish'`, corpo `{ outcome }`.
- [ ] **Step 3: Test** `runner.test.ts` dai casi di `sweep-runner.test.ts` (finestra, pause, timeout, reindirizzamento, messaggi in ritardo, `windowRemoved`, `recover`, un passo alla volta), con `plan` e `enqueue` finti; in più:
  - giro di una ricerca Immobiliare: pagina 1 con privati e un'agenzia → in coda, in quest'ordine, il lotto (`page: 1`, solo privati) e l'esito `complete`, poi la fine `completed`; la finestra si chiude.
  - pagina 1 con `results: 0` → lotto della pagina 1 con `observations: []`, poi esito `complete`.
  - pagina di verifica (`blocked`) → nessun lotto, esito `blocked`, fine `partial`.
  - `page` da un'altra scheda, o fuori da `awaiting`, → niente in coda e stato invariato; `isSweepTab(altra)` false, `isSweepTab(scheda del giro)` true, senza giro false.
  - `recover` con uno stato salvato → in coda la fine `interrupted` dopo quanto già accodato.
  - `stop` a metà → esiti delle ricerche già finite, fine `stopped`; nessun esito `skipped`.
  - piano con `sweepId: null` → `{ sweepId: null, total: 0, skipped: 3 }`, nessuna finestra; secondo `start` durante un giro → `SWEEP_RUNNING`; `plan` che lancia → errore propagato, nessuno stato salvato.
- [ ] **Step 4:** `npm test -w apps/connector` → FAIL; implementa; → PASS; `npm run typecheck -w apps/connector` → PASS.
- [ ] **Step 5: Commit** `feat(connector): lettura nella sola scheda del giro e giro con lotti in coda`

---

### Task 6: Background, content script e messaggi del portale

**Files:**
- Create: `apps/connector/src/{external.ts,device-name.ts}`, `src/entrypoints/{immobiliare,idealista,subito,casadaprivato}.content.ts`, `src/entrypoints/{immobiliare,subito}-bridge.content.ts`, `tests/unit/{external.test.ts,device-name.test.ts}`
- Modify: `apps/connector/src/entrypoints/background.ts`

**Interfaces:**
- Consumes: Task 1 (`PortalMessage`, `ConnectorState`, `ConnectorReply`, `SweepStarted`, `NOT_LINKED`), Task 4 (coda, client), Task 5 (reader, runner).
- Produces:
  ```ts
  // external.ts
  export function handleExternal(msg: unknown, origin: string | undefined, d: {
    portalOrigin: string; version: string;
    linked(): Promise<boolean>; link(code: string): Promise<void>;  // link lancia Error col messaggio del server
    start(): Promise<SweepStarted>; stop(): Promise<void>; sweeping(): Promise<boolean>;
    queueState(): Promise<{ pending: number; stuck: boolean }>;
  }): Promise<ConnectorReply<ConnectorState | SweepStarted | null>>
  // device-name.ts
  export function deviceName(brands: { brand: string }[] | undefined, os: string): string
  ```
  - `handleExternal`: origine diversa → `{ ok: false, error: 'Origine non ammessa' }`; messaggio non valido → `'Messaggio non valido'`; `ping` → `ConnectorState`; `link` → `null`; `startSweep` → `SweepStarted`; `stopSweep` → `null`. Un errore con messaggio `NOT_LINKED` diventa `{ ok: false, error, notLinked: true }`.
  - `deviceName`: marchio fra Google Chrome → `Chrome`, Microsoft Edge → `Edge`, Brave → `Brave`, Opera → `Opera`, altrimenti `Browser`; sistema `win` → `Windows`, `mac` → `macOS`, `linux` → `Linux`, `cros` → `ChromeOS`, altrimenti nessuno: `'Edge su Windows'`, `'Browser'`.
  - Background: `link(code)` → `POST /connector/link` con `{ code, name: deviceName(navigator.userAgentData?.brands, (await getPlatformInfo()).os), version }` e salva il token (201), altrimenti lancia il messaggio del server; `plan` → `POST /connector/sweeps` (401 → `onUnlinked` e `Error(NOT_LINKED)`); `start` fa prima `queue.flush({ force: true })`; `onUnlinked` cancella `token`; `onStuck` → `action.setBadgeText('!' | '')` e, al passaggio a vero, `notifications.create` col testo dei vincoli; `schedule(at)` → `setTimeout` e `alarms.create('queue', { when: at })`; all'avvio del worker `runner.recover()` e `queue.flush({ force: true })`; `windows.onRemoved` → `runner.windowRemoved`; `runtime.onMessage` del content script: `isSweepTab` con `sender.tab.id`, `page` → `runner.page(sender.tab?.id, msg)`. Lo stato del runner sta in `storage.session` come nel vecchio background.
  - Content script: come in `../homeradar` ma con `createReader` al posto di `createController` (niente `RouteWatcher`, banner, `MutationObserver` dei badge; il `MutationObserver` che rilancia `scan` su Idealista e CasaDaPrivato resta).

- [ ] **Step 1: Test** `external.test.ts`: origine sbagliata → errore e nessuna dipendenza chiamata; `undefined` → errore; `{ type: 'ping' }` → `{ ok: true, data: { version, linked, sweeping, pending, stuck } }`; `start` che lancia `Error(NOT_LINKED)` → `notLinked: true`; `link` che lancia `'Codice di collegamento non valido o scaduto'` → quel messaggio. `device-name.test.ts`: i casi sopra, più marchi `[{ brand: 'Not A Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }]` → `Chrome`.
- [ ] **Step 2:** `npm test -w apps/connector` → FAIL; implementa; → PASS.
- [ ] **Step 3:** `npm run typecheck -w apps/connector` e `WXT_PORTAL_URL=http://localhost:8787 npm run build -w apps/connector` → PASS; nel manifest generato ci sono `key`, `externally_connectable` con `http://localhost:8787/*`, i content script dei quattro portali e i due bridge in `MAIN` a `document_start`.
- [ ] **Step 4: Commit** `feat(connector): background, content script e messaggi dal portale`

---

### Task 7: Portale — «Cerca», collegamento e computer collegati

**Files:**
- Create: `apps/web/src/connector.ts`, `apps/web/src/components/{Sweep.tsx,Devices.tsx}`, `apps/web/test/sweep.test.tsx`
- Modify: `apps/web/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `CONNECTOR_ID`, `PortalMessage`, `ConnectorReply`, `ConnectorState`, `SweepStarted` (Task 1); `/api/devices*` (Task 2); `GET /api/sweep` (`SweepStatus`).
- Produces:
  ```ts
  // connector.ts
  export interface ConnectorPort { send<T>(m: PortalMessage): Promise<ConnectorReply<T> | null> }   // null = connettore assente o muto (timeout 2 s)
  export const chromeConnector: ConnectorPort;   // chrome.runtime.sendMessage(CONNECTOR_ID, m); assente se chrome.runtime non c'è
  export const isPhone: () => boolean;           // matchMedia('(hover: none) and (pointer: coarse)')
  // Sweep.tsx
  export function Sweep(p: { connector?: ConnectorPort; phone?: boolean }): JSX.Element
  ```
  Comportamento di `Sweep` (testi esatti):
  - telefono → «Le ricerche partono dal computer» più l'ultimo esito; nessun pulsante.
  - `ping` null → «Installa il connettore HomeRadar per cercare dal computer. Questa pagina se ne accorge da sola.»; nuovo `ping` ogni 3 s finché non risponde.
  - «Cerca»: `ping`; se `linked` è falso → `POST /api/devices/link-code` e `link`; poi `startSweep`; se risponde `notLinked` → un solo nuovo collegamento e un solo nuovo `startSweep`. `sweepId` null → «Dati già aggiornati da meno di un'ora». Errori → il messaggio ricevuto in un `role="alert"`.
  - Stato da `GET /api/sweep` all'apertura e ogni 3 s mentre `running` non è null: «Giro in corso: {done} di {total} ricerche» e il pulsante «Ferma» (`stopSweep`); finito: «Ultimo giro: completato | completato in parte | fermato | interrotto · {newCount} nuovi».
  - `pending > 0` dal `ping` → «{n} pagine in attesa d'invio» (1 → «1 pagina in attesa d'invio»); `stuck` → «Il connettore non riesce a inviare i dati: controlla la connessione».
  - `Devices`: «I tuoi computer», per ognuno nome e «ultimo uso» (data locale o «mai»), pulsante «Scollega» → `DELETE /api/devices/:id` e lista ricaricata. Nessuna lista se vuota.

- [ ] **Step 1: Test** `sweep.test.tsx` (Testing Library; connettore finto che registra i messaggi; `fetch` finto come negli altri test di `apps/web/test`):
  - non collegato → «Cerca» manda `ping`, `POST /api/devices/link-code`, `link` col codice ricevuto, `startSweep`, in quest'ordine.
  - `startSweep` con `notLinked` → ricollega e riprova una volta sola; al secondo `notLinked` mostra l'errore.
  - `sweepId: null` → «Dati già aggiornati da meno di un'ora».
  - connettore assente → testo d'installazione e nessun «Cerca»; quando il `ping` successivo risponde compare «Cerca» (timer finti).
  - `phone` → «Le ricerche partono dal computer», nessun «Cerca».
  - `GET /api/sweep` con `running: { done: 2, total: 5, … }` → «Giro in corso: 2 di 5 ricerche» e «Ferma» manda `stopSweep`.
  - `pending: 3` → «3 pagine in attesa d'invio».
  - `Devices`: «Scollega» chiama `DELETE /api/devices/<id>` e la riga sparisce.
- [ ] **Step 2:** `npm test -w apps/web` → FAIL; implementa; aggiungi `<Sweep />` e `<Devices />` a `Home.tsx`; → PASS; `npm run typecheck && npm run build` → PASS.
- [ ] **Step 3: Commit** `feat(web): «Cerca» dal portale, collegamento del connettore e computer collegati`

---

### Task 8: End-to-end del connettore con un server finto

**Files:**
- Create: `apps/connector/playwright.config.ts` (come `../homeradar`), `tests/e2e/{fixtures.ts,fake-server.ts,fixture-page.ts,sweep.spec.ts}`

**Interfaces:**
- Consumes: build e2e (Task 3), tutto il connettore; fixture `packages/shared/tests/fixtures/immobiliare/search-privati.json`; `buildSearchHtml` di `../homeradar/tests/e2e/fixture-page.ts` (solo la parte Immobiliare); `searchesFor` per il piano.
- Produces:
  - `fake-server.ts`: `startFakeServer(port = 8799): Promise<{ received: { path: string; auth: string | null; body: any }[]; failNext(path: string, n: number, status?: number): void; close(): Promise<void> }>` su `http://localhost:8799`. `GET /` → pagina HTML vuota (l'origine del portale). `POST /connector/link` → 201 `{ token: 'tok' }`. `POST /connector/sweeps` → piano con le ricerche `searchesFor({ comuni: [Cassano d'Adda 015059 MI], categories: ['residential'] }, solo immobiliare)` e un `sweepId` UUID. `batches`, `runs`, `…/finish` → 200 `{ ok: true }` salvo `failNext`.
  - `fixtures.ts`: contesto persistente con `.output-e2e/chrome-mv3`, `extensionId` dal service worker (deve essere `CONNECTOR_ID`), server finto avviato per ogni test; helper `portal(context)` che apre `http://localhost:8799/` e `send(page, msg)` che fa `chrome.runtime.sendMessage(CONNECTOR_ID, msg)` nella pagina.
  - Le pagine di Immobiliare sono servite con `context.route` (pagina 1 di Cassano = privati della fixture più un'agenzia, come `cassanoPage()` di `../homeradar/tests/e2e/sweep.spec.ts`); ogni altra richiesta esterna è interrotta tranne `localhost:8799`.

- [ ] **Step 1: Test** `sweep.spec.ts`:
  - **collegamento e giro**: `link` con un codice → `ping` dice `linked: true`; `startSweep` → `sweepId` non null; attendi la `finish`. `received` (path) è esattamente `/connector/link`, `/connector/sweeps`, `/connector/batches`, `/connector/runs`, `/connector/sweeps/<id>/finish`; il lotto ha `page: 1`, tutte le osservazioni con `sellerType: 'private'` e nessuna chiave fuori da `ObservationSchema`; l'esito è `complete`; la fine `completed`; ogni richiesta dopo il link ha `Authorization: Bearer tok`.
  - **solo nella scheda del giro**: senza giro, apri a mano la pagina di Cassano in una scheda normale e aspetta 4 s → `received` non contiene lotti. Poi, durante un giro con la pagina del giro lenta (3 s), apri a mano la stessa pagina in un'altra scheda → arriva un solo lotto.
  - **server giù**: `failNext('/connector/batches', 2, 503)` → la fine arriva comunque dopo il lotto (ordine come sopra); durante l'attesa un `ping` riporta `pending: 1`; alla fine `pending: 0`.
  - **Ferma**: pagina lenta, `startSweep`, `stopSweep` → fine con `outcome: 'stopped'`, la finestra del giro si chiude.
  - **verifica DataDome**: pagina con l'iframe di `captcha-delivery` → nessun lotto, esito `blocked`, fine `partial`.
  - **origine non ammessa**: in una pagina servita su `http://127.0.0.1:8799/` (fuori da `externally_connectable`) `typeof chrome?.runtime?.sendMessage` è `'undefined'` e `received` resta vuoto. Il controllo di `sender.origin` è coperto dal test di `handleExternal` (Task 6).
- [ ] **Step 2:** `npx playwright install chromium` se manca; `npm run test:e2e -w apps/connector` → PASS (correggi il codice, non i test, se qualcosa non torna con i vincoli).
- [ ] **Step 3: Commit** `test(connector): end-to-end del giro con server finto`

---

### Task 9: Documenti

**Files:**
- Modify: `CLAUDE.md`, `docs/roadmap.md`, `docs/deploy.md`

- [ ] **Step 1:** `CLAUDE.md`: comandi del connettore (`npm test -w apps/connector`, `npm run test:e2e -w apps/connector`, build con `WXT_PORTAL_URL`), voce `apps/connector` nella struttura (file principali come nella Struttura dei file sopra; "legge solo nella scheda del giro"; coda in ordine; chiave del manifest pubblica e ID in `CONNECTOR_ID`), `/connector/link` senza token.
- [ ] **Step 2:** `docs/deploy.md`: migrazione `0004_link_codes.sql` da applicare in produzione insieme a `0002`/`0003` se non fatte; come costruire e caricare il connettore non pacchettizzato (`WXT_PORTAL_URL=https://<portale> npm run build -w apps/connector`, `chrome://extensions` → modalità sviluppatore → carica `apps/connector/.output/chrome-mv3`); prova locale con `wrangler dev` su `http://localhost:8787` e `npm run build` della SPA (l'origine di `externally_connectable` deve essere quella da cui si apre il portale).
- [ ] **Step 3:** `docs/roadmap.md`: tappa 3 col piano `docs/superpowers/plans/2026-10-22-portale-03-connettore.md`, stato "fatto"; nella riga della tappa 6 aggiungi che l'informativa dice dei dispositivi collegati (nome del browser e del sistema, versione, ultima connessione) e che il connettore legge solo nella scheda del giro; nella riga della tappa 4 togli dall'elenco quello che c'è già («Cerca» e stato minimo del giro) lasciando l'avanzamento completo; nella riga della tappa 5 aggiungi la revoca dei dispositivi dall'admin e gli errori del connettore.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `docs: tappa 3 completata`
