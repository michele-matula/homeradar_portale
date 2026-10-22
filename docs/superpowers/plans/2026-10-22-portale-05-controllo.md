# Portale, tappa 5: controllo — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'admin capisce dal pannello, senza chiedere niente ai piloti, se il portale e i connettori funzionano: pagina «Controllo» (una riga per agente con verde/arancio/rosso, scheda dell'agente con connettori, giri e ricerche) e pagina «Errori» (errori di portale, connettore e server raggruppati).

**Architecture:** Una tabella `errors` raggruppa gli errori (una riga per provenienza, versione, messaggio ripulito, utente, dispositivo, con conteggio e date) e riceve da `POST /api/errors` (portale, anche senza sessione), `POST /connector/errors` (connettore) e dal `catch` del Worker. Il connettore si fa sentire con `POST /connector/hello` all'avvio e una volta al giorno, tiene gli errori in un piccolo buffer e manda il motivo delle ricerche finite in errore. Le API admin calcolano lo stato di ogni agente con una funzione pura (`controlHealth`) e le pagine web le mostrano.

**Tech Stack:** Cloudflare Workers + D1 (Vitest con runtime Workers), WXT MV3 (Vitest con dipendenze iniettate), React 19 + Vite (Vitest + Testing Library), zod 4.

**Spec:** `docs/superpowers/specs/2026-10-22-tappa-5-controllo-design.md` (vale su `2026-10-21-homeradar-portale-design.md` §6.6–6.7 dove divergono).

## Global Constraints

- Testi in italiano; errori delle API come `{ "error": "<messaggio in italiano>" }`; timestamp in ms epoch UTC.
- Ogni messaggio e contesto d'errore passa da `sanitizeError` (`@homeradar/shared/core/report`) **sul server** prima di essere salvato; il client non è fidato.
- Al più 20 errori per richiesta; al più **100 errori l'ora** per utente con sessione o per dispositivo, **30 l'ora** per IP senza sessione; oltre si scarta in silenzio (risposta sempre 204). Un invio d'errore fallito non si ritenta e non genera un altro errore.
- Gruppi d'errore con `last_at` oltre **90 giorni** si cancellano.
- Rotte `/api/admin/*` solo per il ruolo `admin` (helper `admin` di `routes/admin-users.ts`, da esportare). Le note degli agenti non compaiono mai.
- Liste SQL con un solo parametro: `IN (SELECT value FROM json_each(?))`. Le query della pagina «Controllo» sono un numero fisso, non una per agente.
- Schema: solo la migrazione nuova `apps/server/migrations/0005_control.sql`; le vecchie non si toccano.
- Colori e motivi in un'unica funzione pura (`controlHealth`): rosso = nessun connettore, nessun connettore con un giro riuscito, mai fatto un giro; arancio = connettore senza contatto da più di **7 giorni**, ultimo giro finito non `completed` o con ricerche `blocked`/`error`, errori negli ultimi 7 giorni, nessun accesso da più di 7 giorni; verde il resto. Un giro in corso non è un problema.
- **Giro riuscito** = `outcome = 'completed'` e nessuna ricerca `blocked` o `error`.
- `PRIVACY_VERSION` resta 1: l'informativa è ancora un segnaposto (`pages/Privacy.tsx`); gli errori raccolti si aggiungono all'elenco della tappa 6 nella roadmap.

## Review Focus

1. Errore che contiene dati di un annuncio (URL, prezzo di 6 cifre, titolo tra virgolette, chiave del lead nel percorso) → nel database solo il messaggio ripulito e il percorso col segnaposto. Test nel Task 1 (server) e nel Task 6 (percorso normalizzato dal portale).
2. Errore che si ripete in ciclo (render React che fallisce, `/api/errors` che risponde 500) → il portale non manda più di un invio al secondo, non segnala gli errori del proprio invio, il server ne salva al più 100 l'ora. Test nei Task 1 e 6.
3. Agente eliminato che aveva errori e connettori → la pagina «Errori» li mostra senza agente e non si rompe; nessun errore del vincolo `UNIQUE` sull'aggiornamento. Test nel Task 1.
4. Connettore revocato dall'admin mentre ha un giro aperto → il giro si chiude come interrotto, i suoi errori restano con il nome salvato e l'etichetta «connettore revocato». Test nel Task 5.
5. Agente appena creato (nessun accesso, nessun connettore, nessun giro) o sospeso → riga rossa coi motivi giusti, nessun campo `null` che rompe la pagina; i sospesi in fondo. Test nei Task 5 e 7.

---

## Struttura dei file

```
apps/server/
  migrations/0005_control.sql     NUOVO  errors, error_quota, search_runs.reason
  src/errors.ts                   NUOVO  recordErrors, takeQuota, recordServerError
  src/control.ts                  NUOVO  controlHealth (puro) + query di «Controllo»
  src/routes/errors.ts            NUOVO  POST /api/errors
  src/routes/admin-control.ts     NUOVO  /api/admin/control*, /api/admin/errors, /api/admin/devices/:id
  src/routes/admin-users.ts       esporta `admin`; DELETE utente anonimizza i suoi errori
  src/routes/connector.ts         /connector/hello, /connector/errors, link con previousToken
  src/device.ts                   limite codici, hello, sostituzione al ricollegamento
  src/sweeps.ts                   reportRun salva `reason`
  src/index.ts, src/env.ts        errori del server, VERSION
  scripts/deploy.mjs              NUOVO  wrangler deploy --var VERSION:<hash>
packages/shared/src/
  api/types.ts                    ErrorReportBody + tipi di «Controllo» ed «Errori»
  api/connector.ts                RunBody.reason, LinkBody.previousToken, HelloBody
  core/sweep.ts                   SearchRun.reason
apps/connector/src/
  errors.ts                       NUOVO  buffer degli errori
  runner.ts, queue.ts, outgoing.ts, reader.ts, content.ts, entrypoints/background.ts
apps/web/src/
  errors.ts                       NUOVO  invio errori del portale
  components/ErrorBoundary.tsx    NUOVO
  pages/Control.tsx, pages/ControlAgent.tsx, pages/Errors.tsx   NUOVI
  components/ErrorGroups.tsx      NUOVO  tabella degli errori (pagina «Errori» e scheda agente)
  api.ts, main.tsx, App.tsx, router.ts, components/Layout.tsx, vite.config.ts, vite-env.d.ts
```

---

### Task 1: Tabella degli errori e raccolta sul server

**Files:**
- Create: `apps/server/migrations/0005_control.sql`, `apps/server/src/errors.ts`, `apps/server/src/routes/errors.ts`, `apps/server/scripts/deploy.mjs`, `apps/server/test/errors.test.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/src/env.ts`, `apps/server/src/routes/connector.ts`, `apps/server/src/routes/admin-users.ts` (DELETE utente), `apps/server/package.json` (`deploy`), `packages/shared/src/api/types.ts`

**Interfaces:**
- Produces (shared `api/types.ts`):
  ```ts
  export const MAX_ERRORS_PER_REPORT = 20;
  export const ErrorReportBody: z.ZodType<{ version: string; errors: { message: string; context?: string; at: number }[] }>;
  // version 1..40 caratteri; message 1..2000; context ≤ 300; errors 1..20; messaggi zod in italiano ('Segnalazione non valida')
  export type ErrorSource = 'portal' | 'connector' | 'server';
  ```
- Produces (`src/errors.ts`):
  ```ts
  export const ERROR_TTL_MS = 90 * 86_400_000;
  export const QUOTA = { user: 100, device: 100, ip: 30 } as const;   // per ora
  export interface ErrorOrigin { source: ErrorSource; version: string; userId?: string; deviceId?: string; deviceName?: string }
  export async function takeQuota(db: D1Database, bucket: string, wanted: number, max: number, now: number): Promise<number>; // quanti se ne possono salvare
  export async function recordErrors(db: D1Database, origin: ErrorOrigin, errors: { message: string; context?: string; at: number }[], now: number): Promise<void>;
  export async function recordServerError(env: Env, err: unknown, path: string, now: number): Promise<void>; // non lancia mai
  ```

- [ ] **Step 1: Migrazione `0005_control.sql`**

```sql
CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('portal','connector','server')),
  version TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',     -- '' = nessuno; niente chiave esterna: un connettore revocato non fa perdere i suoi errori
  device_id TEXT NOT NULL DEFAULT '',
  device_name TEXT,
  context TEXT,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  UNIQUE (source, version, message, user_id, device_id)
);
CREATE INDEX errors_last ON errors(last_at);
CREATE INDEX errors_user ON errors(user_id, last_at);
CREATE TABLE error_quota (bucket TEXT NOT NULL, hour INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (bucket, hour));
ALTER TABLE search_runs ADD COLUMN reason TEXT;
```

- [ ] **Step 2: Test che falliscono** in `test/errors.test.ts` (helper esistenti `fetchApi`, `fetchConnector`, `loginAs`, `linkDevice`, `resetDb`):
  - `POST /api/errors` con sessione e `{ version: 'abc', errors: [{ message: 'Errore su https://www.immobiliare.it/annunci/123456 prezzo 250000 "Villa al mare"', context: '/lead/:chiave', at }] }` → 204; nella tabella `message` è `'Errore su <url> prezzo # <testo>'`, `source = 'portal'`, `user_id` = agente, `count = 1`.
  - Stesso errore due volte → una riga, `count = 2`, `last_at` aggiornato, `first_at` invariato.
  - Senza cookie → 204, riga con `user_id = ''`; senza `Origin` uguale → 403 (controllo esistente).
  - 21 errori in un corpo → 400 `'Segnalazione non valida'`.
  - Quota: 101 errori diversi in 6 richieste con la stessa sessione → 100 righe; 31 senza sessione dallo stesso `CF-Connecting-IP` → 30.
  - `at` nel futuro o più vecchio di 7 giorni → si usa `now`.
  - `POST /connector/errors` con token → riga `source = 'connector'`, `device_id` e `device_name` del dispositivo; senza token → 401.
  - Gruppo con `last_at` di 91 giorni fa → cancellato al primo `recordErrors`.
  - Una rotta che lancia (rotta di prova registrata nel test, oppure `env.DB` rotto per una richiesta) → 500 `'Errore interno'` e riga `source = 'server'`, `version = 'dev'`.
  - `DELETE /api/admin/users/:id` di un agente con errori, quando esiste già un gruppo anonimo con lo stesso messaggio → 204, nessun errore, i suoi gruppi hanno `user_id = ''` e `device_id = ''`.

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run test/errors.test.ts` (in `apps/server`)
Expected: FAIL (rotte 404, tabella assente finché la migrazione non c'è)

- [ ] **Step 4: Implementa**
  - `takeQuota`: `hour = Math.floor(now / 3_600_000)`; `INSERT … ON CONFLICT(bucket, hour) DO UPDATE SET n = n + excluded.n RETURNING n`; restituisce `max(0, min(wanted, max - (n - wanted)))`. Bucket: `u:<userId>`, `d:<deviceId>`, `ip:<CF-Connecting-IP o 'sconosciuto'>`.
  - `recordErrors`: `message = sanitizeError(m)`, `context = sanitizeError(c)` se c'è; `at` fuori da `[now - 7 giorni, now]` diventa `now`; un `db.batch` con un upsert per errore (`ON CONFLICT (source, version, message, user_id, device_id) DO UPDATE SET count = count + 1, last_at = MAX(last_at, excluded.last_at), context = excluded.context, device_name = excluded.device_name`) più `DELETE FROM errors WHERE last_at < now - ERROR_TTL_MS` e `DELETE FROM error_quota WHERE hour < ?` (ora corrente − 1).
  - `routes/errors.ts`: `route('POST', '/api/errors', …)`: legge `ErrorReportBody`; se c'è il cookie prova `authenticate` e, se fallisce, tratta la richiesta come anonima; quota; `recordErrors` con `source: 'portal'`; 204.
  - `routes/connector.ts`: `deviceRoute('POST', '/connector/errors', …)` con `ErrorReportBody`, quota `d:<deviceId>`, `deviceName` letto da `devices`, `source: 'connector'`.
  - `index.ts`: nel `catch` `await recordServerError(env, e, pathname, Date.now())` prima della risposta 500; contesto = `pathname`, versione = `env.VERSION ?? 'dev'`. `env.ts`: `VERSION?: string`.
  - DELETE utente in `admin-users.ts`: prima del `DELETE FROM users`, `UPDATE OR REPLACE errors SET user_id = '', device_id = '' WHERE user_id = ?`.
  - `scripts/deploy.mjs`: `git rev-parse --short HEAD` (ripiego `'dev'`) e `wrangler deploy --var VERSION:<hash>` con `stdio: 'inherit'`; `package.json`: `"deploy": "node scripts/deploy.mjs"`.

- [ ] **Step 5: Verifica**

Run: `npm test -w apps/server && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit** — `feat(server): errori di portale, connettore e server`

---

### Task 2: Motivo delle ricerche finite in errore

**Files:**
- Modify: `packages/shared/src/core/sweep.ts`, `packages/shared/src/api/connector.ts`, `apps/connector/src/outgoing.ts`, `apps/server/src/sweeps.ts`
- Test: i test esistenti di `core/sweep` in `packages/shared`, `apps/connector/tests/unit/outgoing.test.ts`, `apps/server/test/runs.test.ts`

**Interfaces:**
- Produces: `export type SearchErrorReason = 'timeout' | 'unreadable';` in `core/sweep.ts`; `SearchRun.reason?: SearchErrorReason`; `RunBody.reason` = `z.enum(['timeout', 'unreadable']).optional()`; colonna `search_runs.reason` (Task 1).

- [ ] **Step 1: Test che falliscono**
  - sweep: `onTimeout` → la ricerca ha `outcome: 'error', reason: 'timeout'`; `onPageRead` con `parseErrors: 2` → `reason: 'unreadable'`; una pagina letta bene dopo non lascia un `reason` su una ricerca `complete`.
  - outgoing: `settledRuns` di una ricerca in errore per timeout → corpo con `reason: 'timeout'`; ricerca `complete` → corpo senza `reason`.
  - server: `POST /connector/runs` con `outcome: 'error', reason: 'unreadable'` → `search_runs.reason = 'unreadable'`; `reason: 'altro'` → 400 `'Esito non valido'`.

- [ ] **Step 2: Verifica che falliscano** — `npm test -w packages/shared`, `npm test -w apps/connector`, `npx vitest run test/runs.test.ts` in `apps/server`: FAIL.

- [ ] **Step 3: Implementa**: `onTimeout` e il ramo `parseErrors` di `onPageRead` impostano `reason`; `settledRuns` lo aggiunge al corpo solo se c'è; `reportRun` lo scrive nell'`UPDATE search_runs` (`reason = ?`, `null` se manca).

- [ ] **Step 4: Verifica** — `npm test && npm run typecheck`: PASS.

- [ ] **Step 5: Commit** — `feat: motivo delle ricerche finite in errore`

---

### Task 3: Contatto del connettore, ricollegamento e limite dei codici (server)

**Files:**
- Modify: `packages/shared/src/api/connector.ts`, `apps/server/src/device.ts`, `apps/server/src/routes/connector.ts`, `apps/server/src/routes/devices.ts`
- Test: `apps/server/test/link.test.ts`, `apps/server/test/device.test.ts`

**Interfaces:**
- Produces (shared): `HelloBody = body({ name: field(100), version: field(20) })`; `LinkBody` con in più `previousToken: z.string(BAD_REQUEST).max(200, BAD_REQUEST).optional()`.
- Produces (`device.ts`):
  ```ts
  export const MAX_OPEN_LINK_CODES = 5;
  export async function touchDevice(db: D1Database, deviceId: string, name: string, version: string, now: number): Promise<void>;
  export async function replaceDevice(db: D1Database, userId: string, previousToken: string, newId: string, now: number): Promise<void>;
  ```
  `createLinkCode` restituisce `null` se l'utente ha già `MAX_OPEN_LINK_CODES` codici non scaduti.

- [ ] **Step 1: Test che falliscono**
  - `POST /connector/hello` `{ name: 'Edge · Windows', version: '0.4.0' }` → 204; il dispositivo ha nome, versione e `last_seen_at = now` (anche se l'ultimo contatto era 1 minuto prima).
  - Link con `previousToken` di un dispositivo dello stesso utente che ha 2 giri → 201; il dispositivo vecchio non c'è più, i 2 giri hanno `device_id` del nuovo; il token vecchio → 401.
  - Link con `previousToken` di un dispositivo di **un altro** utente → 201, il dispositivo dell'altro resta intatto.
  - Link con `previousToken` sconosciuto → 201 come oggi.
  - Sesto `POST /api/devices/link-code` entro 5 minuti → 429 `'Troppi codici di collegamento: riprova tra qualche minuto'`.

- [ ] **Step 2: Verifica che falliscano** — `npx vitest run test/link.test.ts test/device.test.ts`: FAIL.

- [ ] **Step 3: Implementa**: `touchDevice` = `UPDATE devices SET name, version, last_seen_at`; `replaceDevice` cerca il dispositivo per hash del token **e** `user_id`, poi in un batch `UPDATE sweeps SET device_id = newId WHERE device_id = old` e `DELETE FROM devices WHERE id = old`; la rotta di link lo chiama dopo `insertDevice`; `createLinkCode` conta i codici aperti dell'utente prima di inserire.

- [ ] **Step 4: Verifica** — `npm test -w apps/server && npm run typecheck`: PASS.

- [ ] **Step 5: Commit** — `feat(server): contatto del connettore e ricollegamento dello stesso browser`

---

### Task 4: Connettore — errori, contatto, ricollegamento, finestra che non si apre

**Files:**
- Create: `apps/connector/src/errors.ts`, `apps/connector/tests/unit/errors.test.ts`
- Modify: `apps/connector/src/runner.ts`, `src/queue.ts`, `src/reader.ts` (tipo `ReaderMessage`), `src/content.ts`, `src/entrypoints/background.ts`
- Test: `tests/unit/runner.test.ts`, `tests/unit/queue.test.ts`

**Interfaces:**
- Consumes: `POST /connector/errors` (`ErrorReportBody`), `POST /connector/hello` (`HelloBody`), `LinkBody.previousToken`, `SearchRun.reason`.
- Produces (`src/errors.ts`):
  ```ts
  export const MAX_STORED_ERRORS = 50;
  export interface StoredError { message: string; context?: string; at: number }
  export interface ErrorLogDeps {
    load(): Promise<StoredError[]>; save(list: StoredError[]): Promise<void>;
    post(path: string, body: unknown): Promise<ServerReply>; now(): number; version: string;
  }
  export function createErrorLog(d: ErrorLogDeps): { report(message: string, context?: string): Promise<void>; flush(): Promise<void> };
  ```
- Produces: `ReaderMessage` con in più `{ type: 'error'; message: string }`; `RunnerDeps.reportError(message: string, context?: string): void`; `SendQueueDeps.onRejected(path: string, status: number, error: string | null): void`.

- [ ] **Step 1: Test che falliscono**
  - errors: `report` tronca a 2000 caratteri e tiene al più 50 voci (scarta le più vecchie); `flush` manda al più 20 voci per richiesta a `/connector/errors` con `version`, e le toglie su 2xx, 400 o 429; su status 0 o 5xx le tiene; su 401 svuota; voci più vecchie di 24 ore si scartano senza inviarle; due `flush` in contemporanea non mandano due volte le stesse voci.
  - runner: `openWindow` che lancia → `start` rifiuta con l'errore, in coda c'è la fine `interrupted` del giro del piano e `reportError` è chiamato con `'Finestra del giro non aperta: …'`; una ricerca che va in timeout → `reportError('Ricerca non riuscita: pagina non arrivata in tempo', <portale>)`; con `parseErrors` → `'Ricerca non riuscita: annunci non letti'`.
  - queue: un invio rifiutato con 400 → `onRejected('/connector/sweeps/:id/finish', 400, 'Esito non valido')` (gli UUID nel percorso diventano `:id`); niente più `console.warn`.

- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/connector`: FAIL.

- [ ] **Step 3: Implementa**
  - `errors.ts` come da interfaccia; nel background `load`/`save` su `browser.storage.local` (chiave `errors`), `post` = `client.post`.
  - `runner.ts`: `openWindow` in `try/catch` dentro `start`; le ricerche che passano a `error` in `timeoutTick` e `page` chiamano `reportError` col portale come contesto.
  - `queue.ts`: `onRejected` al posto del `console.warn`; il `catch` di `enqueue` chiama anch'esso `onRejected(path, 0, String(err))`.
  - `content.ts`: `warn` manda anche `{ type: 'error', message: String(err) }` a `browser.runtime.sendMessage` (ignorando i suoi errori); il background lo passa a `errorLog.report(message, sender.url ? new URL(sender.url).hostname : undefined)`.
  - `background.ts`: `self.addEventListener('error' | 'unhandledrejection')` → `errorLog.report`; `hello()` = `client.post('/connector/hello', { name, version })` seguito da `errorLog.flush()`, chiamato all'avvio del worker, in `runtime.onStartup`, dopo un collegamento riuscito e dall'allarme `hello` (`periodInMinutes: 1440`); `errorLog.flush()` anche dopo ogni `queue.flush` riuscito; `link()` manda `previousToken` se in `storage.local` c'è già un token. Il nome del dispositivo si calcola in una funzione riusata da `link` e `hello`.

- [ ] **Step 4: Verifica** — `npm test -w apps/connector && npm run typecheck -w apps/connector && npm run test:e2e -w apps/connector`: PASS (gli e2e non devono importare `errors.ts` se tirasse dentro `comuni.json`: non lo fa, non usa `sanitizeError`).

- [ ] **Step 5: Commit** — `feat(connector): errori al server, contatto quotidiano e ricollegamento`

---

### Task 5: API admin di «Controllo» ed «Errori»

**Files:**
- Create: `apps/server/src/control.ts`, `apps/server/src/routes/admin-control.ts`, `apps/server/test/control.test.ts`
- Modify: `apps/server/src/routes/admin-users.ts` (esporta `admin`), `apps/server/src/index.ts`, `packages/shared/src/api/types.ts`

**Interfaces:**
- Produces (shared `api/types.ts`):
  ```ts
  export type Health = 'ok' | 'warn' | 'bad';
  export interface ControlDevice { id: string; name: string; version: string | null; createdAt: number; lastSeenAt: number | null; lastGoodSweepAt: number | null }
  export interface ControlSweep { id: string; startedAt: number; finishedAt: number | null; outcome: SweepOutcome | null; deviceName: string | null; searches: number; problems: number }
  export interface ControlRow { userId: string; email: string; status: UserStatus; lastSeenAt: number | null; devices: ControlDevice[]; lastSweep: ControlSweep | null; sweeps30d: number; errors7d: number; health: Health; reasons: string[] }
  export interface ControlRun { searchKey: string; portal: Portal; label: string; status: string; pages: number; privates: number; reason: SearchErrorReason | null }
  export interface ErrorGroup { source: ErrorSource; version: string; message: string; count: number; firstAt: number; lastAt: number; context: string | null; agents: string[]; devices: { name: string | null; revoked: boolean }[] }
  ```
- Produces (`control.ts`):
  ```ts
  export const QUIET_MS = 7 * 86_400_000;
  export function controlHealth(r: Omit<ControlRow, 'health' | 'reasons'>, now: number): { health: Health; reasons: string[] };
  export async function controlRows(db: D1Database, now: number, userId?: string): Promise<ControlRow[]>;
  export async function agentSweeps(db: D1Database, userId: string, limit: number): Promise<ControlSweep[]>;
  export async function sweepRuns(db: D1Database, sweepId: string): Promise<ControlRun[]>;
  export async function errorGroups(db: D1Database, now: number, f: { source?: ErrorSource; userId?: string }): Promise<ErrorGroup[]>;
  ```
- Rotte (tutte `admin`):
  - `GET /api/admin/control` → `ControlRow[]` (attivi e invitati prima, sospesi in fondo; dentro, per email)
  - `GET /api/admin/control/:userId` → `{ row: ControlRow; sweeps: ControlSweep[] /* ultimi 20 */; errors: ErrorGroup[] }`, 404 `'Agente non trovato'`
  - `GET /api/admin/sweeps/:id/runs` → `ControlRun[]`, 404 `'Giro non trovato'`
  - `GET /api/admin/errors?source=portal|connector|server` → `ErrorGroup[]` degli ultimi 90 giorni, una riga per (provenienza, versione, messaggio), ordinate per `lastAt` decrescente; `source` non valido → 400 `'Provenienza non valida'`
  - `DELETE /api/admin/devices/:id` → 204, 404 `'Dispositivo non trovato'`

- [ ] **Step 1: Test che falliscono** (`test/control.test.ts`)
  - `controlHealth` (pura, `now` fisso):
    - nessun dispositivo, nessun giro, `lastSeenAt: null` → `bad`, motivi `['Nessun connettore', 'Mai fatto un giro', 'Mai entrato']`.
    - un dispositivo con `lastGoodSweepAt: null`, ultimo giro `completed` con `problems: 2` → `bad`, motivi contengono `'Nessun giro riuscito'` e `'Ultimo giro: 2 ricerche con problemi'`.
    - dispositivo «Chrome · Windows» con `lastSeenAt` 9 giorni fa e giro riuscito → `warn`, `'Connettore Chrome · Windows muto da 9 giorni'`.
    - ultimo giro `interrupted` → `warn`, `'Ultimo giro: interrotto'` (`partial` → `'parziale'`, `stopped` → `'fermato'`).
    - `errors7d: 3` → `warn`, `'3 errori negli ultimi 7 giorni'`; accesso 12 giorni fa → `'Nessun accesso da 12 giorni'`.
    - giro in corso (`finishedAt: null`) e tutto il resto a posto → `ok`, `reasons: []`.
  - Rotte:
    - agente con un dispositivo, un giro `completed` senza problemi e uno successivo con una ricerca `blocked` → `lastGoodSweepAt` = fine del primo, `lastSweep.problems = 1`, `health: 'warn'` (un giro riuscito c'è).
    - giro senza dispositivo (`device_id` NULL) → non conta per nessun connettore, `deviceName: null`.
    - `GET /api/admin/control` come agente → 403 `"Riservato all'amministratore"`; l'admin non compare nelle righe.
    - `sweepRuns` restituisce `label` da `spec` (JSON di `SearchSpec`) e `reason`.
    - `errorGroups`: lo stesso messaggio da due agenti → una riga con `count` sommato e `agents` con le due email; un errore di un dispositivo revocato → `devices: [{ name: 'Chrome · Windows', revoked: true }]`; un gruppo con `user_id = ''` → `agents: []`; filtro `userId` → solo i suoi.
    - `DELETE /api/admin/devices/:id` con un giro aperto → 204, giro chiuso come `interrupted` (via `closeDeviceSweeps`), dispositivo assente.

- [ ] **Step 2: Verifica che falliscano** — `npx vitest run test/control.test.ts`: FAIL.

- [ ] **Step 3: Implementa** `control.ts` e le rotte. `controlRows` con un numero fisso di query (agenti; dispositivi; ultimo giro per agente con conteggio di ricerche e problemi; ultimo giro riuscito per dispositivo con `NOT EXISTS` sulle ricerche `blocked`/`error`; giri degli ultimi 30 giorni; errori degli ultimi 7 giorni per agente), poi `controlHealth` per riga. I giorni nei motivi sono `Math.floor((now - t) / 86_400_000)`.

- [ ] **Step 4: Verifica** — `npm test -w apps/server && npm run typecheck`: PASS.

- [ ] **Step 5: Commit** — `feat(server): API admin di controllo ed errori`

---

### Task 6: Errori del portale

**Files:**
- Create: `apps/web/src/errors.ts`, `apps/web/src/components/ErrorBoundary.tsx`, `apps/web/test/errors.test.tsx`
- Modify: `apps/web/src/api.ts`, `apps/web/src/main.tsx`, `apps/web/vite.config.ts`, `apps/web/src/vite-env.d.ts` (o il file di dichiarazioni esistente)

**Interfaces:**
- Produces (`src/errors.ts`):
  ```ts
  export function reportError(message: string): void;      // mette in coda e invia al più una volta al secondo
  export function installErrorReporting(): void;           // window 'error' e 'unhandledrejection'
  export function routeOf(path: string): string;           // '/lead/immobiliare%3A123' → '/lead/:chiave', '/admin/controllo/<id>' → '/admin/controllo/:id'
  ```
  `declare const __APP_VERSION__: string` (Vite `define`: `git rev-parse --short HEAD`, ripiego `'dev'`).

- [ ] **Step 1: Test che falliscono** (fetch finto)
  - tre `reportError` di fila → una sola `POST /api/errors` dopo 1 s con 3 errori, `version`, `context: routeOf(location.pathname)`, `keepalive: true`.
  - `routeOf('/lead/immobiliare%3A123456')` → `'/lead/:chiave'`.
  - `/api/errors` risponde 500 o la rete fallisce → nessun nuovo `reportError`, nessun ritentativo.
  - più di 20 errori nello stesso secondo → invio dei primi 20, gli altri scartati.
  - `api('GET', '/api/leads')` con 500 → `reportError('API GET /api/leads: 500 Errore interno')`; con 400 → nessuna segnalazione; con rete assente → `'API GET /api/leads: rete'`.
  - `ErrorBoundary` con un figlio che lancia → testo «Qualcosa non va.» e pulsante «Ricarica la pagina», e una segnalazione.

- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/web`: FAIL.

- [ ] **Step 3: Implementa**: `errors.ts` usa `fetch` diretto (mai `api()`), percorso dell'API normalizzato con `routeOf` nel messaggio; `main.tsx` chiama `installErrorReporting()` e avvolge `<App />` in `<ErrorBoundary>`.

- [ ] **Step 4: Verifica** — `npm test -w apps/web && npm run typecheck -w apps/web && npm run build`: PASS.

- [ ] **Step 5: Commit** — `feat(web): errori del portale al server`

---

### Task 7: Pagine admin «Controllo» ed «Errori»

**Files:**
- Create: `apps/web/src/pages/Control.tsx`, `pages/ControlAgent.tsx`, `pages/Errors.tsx`, `components/ErrorGroups.tsx`, `apps/web/test/control.test.tsx`
- Modify: `apps/web/src/App.tsx`, `src/router.ts`, `src/components/Layout.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: le rotte e i tipi del Task 5.
- Produces: `controlPath(userId: string): string` e `controlUserOf(path: string): string | null` in `router.ts` (come `leadPath`/`leadKeyOf`); rotte `/admin/controllo`, `/admin/controllo/<userId>`, `/admin/errori`; menu admin «Utenti · Controllo · Errori».

- [ ] **Step 1: Test che falliscono** (risposte finte di `fetch`, helper esistenti di `test/helpers.tsx`)
  - «Controllo»: una riga per agente con email, ultimo accesso, connettori, ultimo giro (con «N giri in 30 gg» da `sweeps30d`), errori 7 gg; la riga `bad` ha la classe `health--bad` e mostra i motivi; clic sulla riga → percorso `/admin/controllo/<id>`; un agente senza niente mostra «mai» / «nessuno» senza errori di render.
  - Scheda agente: tabella dei connettori con versione, ultimo contatto e «nessun giro riuscito» quando `lastGoodSweepAt` è `null`; «Revoca» chiede conferma (pulsante «Conferma revoca», non `window.confirm`) e poi chiama `DELETE /api/admin/devices/<id>` e ricarica; ultimo giro con le sue ricerche (etichetta, esito, pagine, privati, motivo «pagina non arrivata in tempo» / «annunci non letti»); clic su un giro precedente → ne carica le ricerche; 404 → «Agente non trovato».
  - «Errori»: righe ordinate come arrivano, filtro «Tutti / Portale / Connettore / Server» che richiede `?source=`; dispositivo revocato mostrato come «Chrome · Windows (connettore revocato)»; nessun errore → «Nessun errore negli ultimi 90 giorni».
  - Un agente (non admin) su `/admin/controllo` → rimandato a `/` (regola esistente di `App.tsx`).

- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/web`: FAIL.

- [ ] **Step 3: Implementa** le pagine con `Layout`, classi e stile coerenti con `AdminUsers.tsx`; date con `toLocaleString('it-IT')`; colori `health--ok|warn|bad` in `styles.css` (verde/arancio/rosso, leggibili anche col solo testo dei motivi). Sotto i 900 px le tabelle scorrono in orizzontale dentro il loro riquadro.

- [ ] **Step 4: Verifica** — `npm test && npm run typecheck && npm run build`: PASS.

- [ ] **Step 5: Commit** — `feat(web): pagine admin di controllo ed errori`

---

### Task 8: Documenti

**Files:**
- Modify: `docs/deploy.md`, `docs/roadmap.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-22-tappa-5-controllo-design.md`

- [ ] **Step 1**: `deploy.md`: migrazione `0005_control.sql` da applicare prima del deploy; deploy con `npm run deploy -w apps/server` (porta la versione negli errori del server); il connettore va ricostruito e reinstallato (nuove rotte `hello`/`errors`).
- [ ] **Step 2**: `roadmap.md`: tappa 5 → piano `docs/superpowers/plans/2026-10-22-portale-05-controllo.md`, stato «fatto» a fine branch; nella tappa 6 l'informativa deve dire anche «errori di portale e connettore, ripuliti, legati all'agente e al computer, tenuti 90 giorni»; rinviati dalla tappa 5: «vedi come l'agente», parametri regolabili, eventi d'uso completi, avvisi.
- [ ] **Step 3**: `CLAUDE.md` (Struttura): `src/errors.ts`, `src/control.ts`, `routes/admin-control.ts`, `routes/errors.ts` nel server; `src/errors.ts` nel connettore e nel portale; nuove pagine admin. Design: la sezione «Informativa» dice che `PRIVACY_VERSION` resta 1 perché il testo è ancora un segnaposto.
- [ ] **Step 4**: `npm test && npm run typecheck`: PASS.
- [ ] **Step 5: Commit** — `docs: tappa 5 completata`
