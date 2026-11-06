# Avvia dal telefono — piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dal portale sul telefono l'agente avvia il giro su un suo computer acceso (il primo con «Avvia dal telefono» attivo che controlla), ne segue lo stato e lo può fermare; i computer hanno un nome scelto dall'agente e uno stato online.

**Architecture:** il server tiene una richiesta per agente (`remote_requests`, una riga per utente). Il connettore, con l'interruttore attivo, chiama ogni minuto `POST /connector/remote`, che risponde con la richiesta aperta e con lo stop del giro. Prendere la richiesta e aprire il giro avvengono nella stessa chiamata `POST /connector/sweeps` con `{ remote: <id> }`: il server segna l'esito sulla richiesta, quindi il telefono sa sempre perché il giro è partito o no. Il telefono legge tutto da `GET /api/sweep`.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, zod, WXT (Chrome MV3), React (Vite), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-avvia-dal-telefono-design.md`

## Global Constraints

- Il server non contatta mai i portali; il connettore legge solo durante il giro, nella scheda del giro.
- Migrazione nuova `apps/server/migrations/0008_remote_start.sql`; le esistenti non si toccano. Liste SQL con `json_each(?)`.
- Timestamp in ms epoch UTC. Errori delle API come `{ "error": "<messaggio in italiano>" }`; testi dell'interfaccia in italiano.
- Corpi delle richieste con `body()` (`strictObject`): un campo nuovo rompe i connettori vecchi solo se lo mandano, quindi i campi nuovi sono tutti facoltativi.
- Interruttore «Avvia dal telefono» spento di default, per computer.
- Richiesta: scade **2 minuti** dopo la creazione. Online: contatto `POST /connector/remote` negli ultimi **2 minuti**. Controllo del connettore: ogni **1 minuto** con l'interruttore attivo, ogni **15 minuti** (allarme `auto`) se spento.
- Versione minima del connettore che sa controllare le richieste: `0.3.0` (si alza `apps/connector/package.json` da `0.2.0`).
- Niente permesso `background`. Il giro dal telefono si apre nella finestra ridotta a icona e senza focus (come oggi `openWindow`).
- `PRIVACY_VERSION` sale a 3.
- Lavoro sul branch `feat/avvia-dal-telefono`; commit a fine di ogni task.

## Review Focus

1. **Doppio tocco o due telefoni**: premere «Avvia sul computer» due volte crea una sola richiesta (la riga per utente si sostituisce solo se la precedente è chiusa o scaduta). Test nel Task 3.
2. **Due computer che controllano nello stesso istante**: solo uno prende la richiesta, l'altro riceve 409 e non apre finestre. Test nel Task 3 (server) e nel Task 4 (connettore ignora il 409).
3. **Richiesta presa da un computer ma giro non partito** (piano vuoto, giro aperto altrove, nessun comune): il telefono deve mostrare il motivo vero, non «nessun computer ha risposto». Test nel Task 3.
4. **Interruttore spento dopo che la richiesta è stata creata**: un computer con `remote = 0` non la riceve più né la può prendere. Test nel Task 3.
5. **Connettore vecchio (< 0.3.0)**: nessun interruttore, non conta come abilitato né online, il telefono mostra 4b. Test nel Task 2 e nel Task 6.

---

### Task 1: tipi, schemi e logica pura condivisi

**Files:**
- Create: `packages/shared/src/core/remote.ts`
- Modify: `packages/shared/src/api/connector.ts`, `packages/shared/src/api/connector-messages.ts`, `packages/shared/src/shared/types.ts`
- Test: `packages/shared/tests/unit/core/remote.test.ts` (accanto a `auto-sweep.test.ts`; alias `@/`)

**Interfaces:**
- Produces (`core/remote.ts`):
  - `REMOTE_REQUEST_TTL_MS = 120_000`, `REMOTE_ONLINE_MS = 120_000`, `REMOTE_MIN_VERSION = '0.3.0'`
  - `versionAtLeast(version: string | null, min: string): boolean` — confronto numerico per parti `x.y.z`; `null` o non numerica → false.
  - `type RemoteOutcome = 'started' | 'fresh' | 'busy' | 'failed' | 'cancelled'`
  - `interface RemoteRow { createdAt: number; expiresAt: number; deviceId: string | null; outcome: RemoteOutcome | null }`
  - `remoteState(r: RemoteRow, now: number): RemoteState | null` con `type RemoteState = 'waiting' | 'noAnswer' | 'fresh' | 'busy' | 'failed' | 'started'`: `cancelled` → null; outcome valorizzato → quello; senza outcome e senza device → `waiting` prima di `expiresAt`, poi `noAnswer`; senza outcome ma con device → `failed`.
- Produces (`shared/types.ts`):
  - `SweepProgress` + `remote: boolean`, `deviceName: string | null`, `stopRequested: boolean`
  - `SweepResult` + `remote?: boolean`
  - `interface RemoteStatus { state: RemoteState; createdAt: number; deviceName: string | null }`
  - `SweepStatus` + `remote: RemoteStatus | null`, `computers: { enabled: number; online: string[] }` (`online` = nomi mostrati dei computer online)
- Produces (`api/connector.ts`):
  - `StartSweepBody` + `remote: z.uuid().optional()`
  - `LinkBody`: invariato (il nome scelto arriva già come `name`)
  - `DeviceInfo` diventa `{ id; name; label: string | null; createdAt; lastSeenAt; remote: boolean; remoteReady: boolean; online: boolean }` (`name` resta l'automatico; `remoteReady` = `versionAtLeast(version, REMOTE_MIN_VERSION)`; `online` solo se `remote && remoteReady`)
  - `DevicePatchBody = body({ label: z.string().trim().min(1).max(60).nullable().optional(), remote: z.boolean().optional() })`
  - `interface RemotePoll { enabled: boolean; requestId: string | null; stop: boolean }`
  - `interface HelloReply { deviceId: string; remote: boolean }`
  - `interface LinkReply { token: string; userId: string; deviceId: string }`
- Produces (`connector-messages.ts`):
  - `PortalMessage` + `{ type: 'link'; code: string; name?: string }` (nome 1–60 caratteri) e `{ type: 'remoteChanged' }`
  - `ConnectorState` + `deviceId: string | null`, `defaultName: string`

- [ ] **Step 1: test di `versionAtLeast` e `remoteState`**

```ts
expect(versionAtLeast('0.3.0', '0.3.0')).toBe(true);
expect(versionAtLeast('0.10.0', '0.3.0')).toBe(true);
expect(versionAtLeast('0.2.9', '0.3.0')).toBe(false);
expect(versionAtLeast(null, '0.3.0')).toBe(false);
const base = { createdAt: 0, expiresAt: 120_000, deviceId: null, outcome: null };
expect(remoteState(base, 60_000)).toBe('waiting');
expect(remoteState(base, 120_000)).toBe('noAnswer');
expect(remoteState({ ...base, deviceId: 'd' }, 60_000)).toBe('failed');
expect(remoteState({ ...base, outcome: 'fresh' }, 60_000)).toBe('fresh');
expect(remoteState({ ...base, outcome: 'cancelled' }, 60_000)).toBeNull();
```
E un test dello schema: `PortalMessage.safeParse({ type: 'link', code: 'x', name: '' }).success === false`, `{ type: 'remoteChanged' }` valido; `StartSweepBody.safeParse({ remote: 'non-uuid' }).success === false`.

- [ ] **Step 2:** `npm test -w packages/shared` → FAIL (moduli/campi mancanti).
- [ ] **Step 3:** implementare `core/remote.ts` e i tipi/schemi sopra.
- [ ] **Step 4:** `npm test -w packages/shared` → PASS; `npm run typecheck` mostrerà errori in server/web/connector per i campi nuovi di `SweepStatus`/`DeviceInfo`/`ConnectorState`: si chiudono nei task successivi.
- [ ] **Step 5:** commit `feat(shared): tipi e logica dell'avvio dal telefono`.

---

### Task 2: computer con nome, interruttore e stato online (server)

**Files:**
- Create: `apps/server/migrations/0008_remote_start.sql`
- Modify: `apps/server/src/device.ts`, `apps/server/src/routes/devices.ts`, `apps/server/src/routes/connector.ts` (link, hello, errors), `apps/server/src/control.ts`, `apps/server/test/helpers.ts` (`resetDb`: aggiungere `remote_requests` prima di `sweeps`)
- Test: `apps/server/test/device.test.ts`, `apps/server/test/link.test.ts`

**Interfaces:**
- Consumes: Task 1 (`DeviceInfo`, `DevicePatchBody`, `HelloReply`, `LinkReply`, `REMOTE_*`, `versionAtLeast`).
- Produces:
  - Migrazione 0008:
    ```sql
    ALTER TABLE devices ADD COLUMN label TEXT;
    ALTER TABLE devices ADD COLUMN remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1));
    ALTER TABLE devices ADD COLUMN polled_at INTEGER;
    ALTER TABLE sweeps ADD COLUMN remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1));
    ALTER TABLE sweeps ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1));
    CREATE TABLE remote_requests (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
      claimed_at INTEGER,
      outcome TEXT CHECK (outcome IN ('started','fresh','busy','failed','cancelled')),
      sweep_id TEXT
    );
    ```
  - SQL condiviso `DEVICE_NAME = "COALESCE(d.label, d.name)"` (esportato da `device.ts`) usato ovunque si mostra un computer: `control.ts` (righe 24, 52, 72), nome negli errori (`routes/connector.ts:68`), messaggio 409 di `startSweep` (Task 3).
  - `listDevices(db, userId, now): Promise<DeviceInfo[]>` (ora riceve `now` per `online`).
  - `updateDevice(db, userId, id, patch: { label?: string | null; remote?: boolean }): Promise<boolean>` — false se non è suo.
  - `PATCH /api/devices/:id` con `DevicePatchBody` → 200 `DeviceInfo` aggiornato, 404 «Dispositivo non trovato». Spegnere `remote` non tocca richieste già prese.
  - `POST /connector/link` → 201 `LinkReply` (aggiunge `deviceId`).
  - `POST /connector/hello` → 200 `HelloReply` (prima 204; i connettori vecchi guardano solo il 2xx). `touchDevice` non tocca `label`.

- [ ] **Step 1: test che falliscono**, in `device.test.ts`:
  - `PATCH /api/devices/:id { label: 'PC di casa' }` → `GET /api/devices` mostra `label: 'PC di casa'`, `name` automatico invariato; poi `POST /connector/hello { name: 'Edge su Windows', version: '0.3.0' }` cambia `name` ma non `label`.
  - `PATCH` di un dispositivo di un altro utente → 404; `{ label: '' }` → 400; `{ label: null }` torna al nome automatico.
  - `remote` false di default; `PATCH { remote: true }` → `remote: true`.
  - **Review Focus 5**: dispositivo con `version = '0.2.0'` e `remote = 1`, `polled_at = now` → `remoteReady: false`, `online: false`; con `'0.3.0'` → `remoteReady: true`, `online: true`; con `polled_at = now - 121_000` → `online: false`.
  - In `link.test.ts`: la risposta di `/connector/link` contiene `deviceId` uguale alla riga creata; `/connector/hello` risponde 200 `{ deviceId, remote: false }`.
  - Pagina «Controllo» (`control.test.ts` se c'è già un test sul nome): con `label` impostato il connettore si chiama col nome scelto.
- [ ] **Step 2:** `npm test -w apps/server` → FAIL.
- [ ] **Step 3:** migrazione, `device.ts`, rotte, `control.ts`, `helpers.ts`.
- [ ] **Step 4:** `npm test -w apps/server` → PASS.
- [ ] **Step 5:** commit `feat(server): nome, interruttore e stato online dei computer`.

---

### Task 3: richieste dal telefono, presa, esito e stop (server)

**Files:**
- Create: `apps/server/src/remote.ts`
- Modify: `apps/server/src/sweeps.ts`, `apps/server/src/control.ts`, `apps/web/src/pages/ControlAgent.tsx`, `apps/server/src/ingest.ts` (risposta), `apps/server/src/routes/connector.ts`, `apps/server/src/routes/leads.ts` (accanto a `GET /api/sweep`)
- Test: `apps/server/test/remote.test.ts` (nuovo), `apps/server/test/runs.test.ts` se tocca lo stato del giro

**Interfaces:**
- Consumes: Task 1 (`remoteState`, `RemoteStatus`, `RemotePoll`, `REMOTE_*`), Task 2 (colonne, `DEVICE_NAME`).
- Produces:
  - In `sweeps.ts`, estratta da `startSweep` senza cambiarne il comportamento: `planSearches(db, user, settings, now, blocked: Set<Portal>): Promise<{ specs: SearchSpec[]; searches: SearchSpec[] }>`.
  - `startSweep(db, user, deviceId, now, opts: { auto?: boolean; remote?: string } = {})` (oggi `auto` è il 5° argomento: aggiornare le chiamate e i test). Con `remote`: prima prende la richiesta in un solo `UPDATE remote_requests SET device_id = ?, claimed_at = ? WHERE user_id = ? AND id = ? AND device_id IS NULL AND outcome IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM devices WHERE id = ? AND remote = 1)`; `meta.changes !== 1` → `fail(409, 'Richiesta già presa o scaduta')`. Poi il giro normale (portali bloccati **inclusi**), e l'esito sulla richiesta: giro aperto → `started` + `sweep_id`; piano vuoto → `fresh`; 409 giro aperto altrove → `busy`; qualunque altra `Response` d'errore → `failed`. Il giro si scrive con `sweeps.remote = 1`.
  - Messaggio 409 di `startSweep`: `Giro già in corso su «<nome>»` col nome mostrato del computer del giro aperto.
  - `remote.ts`:
    - `requestRemote(db, user, now): Promise<Response>` — `POST /api/sweep/remote`:
      - giro aperto → `fail(409, 'Giro già in corso')`;
      - nessun dispositivo con `remote = 1` e versione ≥ minima → `fail(400, 'Nessun computer con «Avvia dal telefono» attivo: attivalo nelle impostazioni')`;
      - nessun comune → stesso 400 di `startSweep`;
      - `planSearches` vuoto → `json({ fresh: true })` (200), senza scrivere la richiesta;
      - richiesta aperta non scaduta già presente → 200 `{ fresh: false }` senza cambiarla (**Review Focus 1**);
      - altrimenti `INSERT … ON CONFLICT(user_id) DO UPDATE` con id nuovo, `expires_at = now + REMOTE_REQUEST_TTL_MS`, campi azzerati → 201 `{ fresh: false }`.
    - `cancelRemote(db, userId)` — `DELETE /api/sweep/remote` → `outcome = 'cancelled'` solo se `outcome IS NULL AND device_id IS NULL`; 204 sempre.
    - `stopRemote(db, userId)` — `POST /api/sweep/stop` → `UPDATE sweeps SET stop_requested = 1 WHERE user_id = ? AND finished_at IS NULL`; 204.
    - `pollRemote(db, user, deviceId, now): Promise<RemotePoll>` — `POST /connector/remote` (corpo vuoto `{}`): scrive `devices.polled_at = now` solo se più vecchio di 30 s; `enabled` = `remote = 1`; `requestId` solo se `enabled` e c'è una richiesta aperta non scaduta senza device; `stop` se il giro aperto di **questo** dispositivo ha `stop_requested = 1`.
    - `remoteStatus(db, userId, now): Promise<{ remote: RemoteStatus | null; computers: SweepStatus['computers'] }>` — `remote` da `remoteState` sulla riga, con `deviceName` del computer che l'ha presa; `null` se la richiesta è più vecchia di 10 minuti. `computers.enabled` conta i dispositivi `remote = 1` con versione ≥ minima; `online` ne dà i nomi mostrati con `polled_at` negli ultimi `REMOTE_ONLINE_MS`.
  - Pagina «Controllo»: `SWEEP_COLUMNS` in `control.ts` legge anche `s.remote`, il giro dell'admin ha `remote: boolean` e `ControlAgent.tsx` (riga 105) aggiunge «· dal telefono» come fa con «· automatico» (test in `control.test.ts` e `apps/web/test/control.test.tsx`).
  - `sweepStatus` include `remote` e `computers`; `progress` aggiunge `remote`, `deviceName` (nome mostrato del dispositivo del giro), `stopRequested`; `finishSweep` scrive `remote` nel risultato.
  - `POST /connector/batches`: la risposta `{ ok: true }` diventa `{ ok: true, stop: true }` quando il giro del lotto ha `stop_requested = 1` (anche per i lotti duplicati). Vale per qualunque giro, non solo quelli dal telefono.

- [ ] **Step 1: test che falliscono** (`remote.test.ts`, con `loginAs`, `linkDevice`, `fetchApi`, `fetchConnector`; dispositivi portati a `version = '0.3.0'`, `remote = 1`, utente con comuni):
  - `POST /api/sweep/remote` → 201; `GET /api/sweep` → `remote.state === 'waiting'`; secondo POST subito dopo → 200 e la riga ha lo stesso `id` (**RF 1**).
  - Senza dispositivi abilitati → 400 col testo sopra; con un dispositivo abilitato ma `version = '0.2.0'` → 400 (**RF 5**).
  - Tutte le ricerche fresche (`search_runs` complete recenti, come in `plan.test.ts`) → 200 `{ fresh: true }`, nessuna riga in `remote_requests`.
  - `POST /connector/remote` dal dispositivo abilitato → `{ enabled: true, requestId: <id>, stop: false }`; dal dispositivo con `remote = 0` → `{ enabled: false, requestId: null }`.
  - Due dispositivi: A fa `POST /connector/sweeps { remote: id }` → 201; B con lo stesso id → 409 «Richiesta già presa o scaduta» (**RF 2**); `GET /api/sweep` → `remote.state === 'started'`, `running.remote === true`, `running.deviceName === 'PC di prova'`.
  - Richiesta presa con piano vuoto → 200 `sweepId: null`, `remote.state === 'fresh'`; presa con un giro aperto da un altro dispositivo inserito a mano → 409 e `remote.state === 'busy'`; presa da un utente senza comuni → 400 e `remote.state === 'failed'` (**RF 3**).
  - Dopo `PATCH remote: false` il dispositivo non può prendere la richiesta → 409 (**RF 4**).
  - Richiesta non presa e `now` oltre 2 minuti (riga con `expires_at` nel passato) → `remote.state === 'noAnswer'`; `DELETE /api/sweep/remote` su una in attesa → `GET /api/sweep` `remote === null`.
  - `POST /api/sweep/stop` con un giro aperto → `running.stopRequested === true`; il lotto successivo di quel giro risponde `{ ok: true, stop: true }`; `POST /connector/remote` dal suo dispositivo → `stop: true`.
  - `computers.online` contiene il nome del dispositivo dopo un `POST /connector/remote`, non dopo `polled_at` di 3 minuti prima.
- [ ] **Step 2:** `npm test -w apps/server` → FAIL.
- [ ] **Step 3:** `planSearches`, `startSweep` con `opts`, `remote.ts`, rotte, risposta dei lotti.
- [ ] **Step 4:** `npm test -w apps/server` → PASS (anche i test esistenti di giro automatico e piano).
- [ ] **Step 5:** commit `feat(server): avvio del giro dal telefono`.

---

### Task 4: il connettore controlla le richieste

**Files:**
- Create: `apps/connector/src/remote.ts`
- Modify: `apps/connector/src/runner.ts`, `apps/connector/src/external.ts`, `apps/connector/src/entrypoints/background.ts`, `apps/connector/src/timing.ts`, `apps/connector/package.json` (version `0.3.0`)
- Test: `apps/connector/tests/unit/remote.test.ts` (nuovo), `runner.test.ts`, `external.test.ts`

**Interfaces:**
- Consumes: Task 1 (`RemotePoll`, `HelloReply`, `LinkReply`, messaggi), Task 3 (rotte).
- Produces:
  - `runner.start(opts: { auto?: boolean; remote?: string } = {})`; `RunnerDeps.plan(opts: { auto: boolean; remote?: string })` manda `{ auto: true }` oppure `{ remote }` oppure `{}`; `RunnerState.remote?: boolean`; `onEnd({ auto, remote, blocked })`.
  - `createRemote(d: RemoteDeps)` in `remote.ts`, con
    ```ts
    interface RemoteDeps {
      linked(): Promise<boolean>;
      poll(): Promise<RemotePoll | 'unlinked' | null>; // null = rete o errore del server
      running(): Promise<boolean>;
      start(requestId: string): Promise<SweepStarted>;
      stop(): Promise<void>;
      setFast(on: boolean): Promise<void>; // crea o toglie l'allarme 'remote' a TIMING.remoteEveryMin
      started(): void; // notifica d'avvio
    }
    ```
    e `check(): Promise<'started' | 'stopped' | 'idle'>`, una chiamata alla volta come `auto.check()`: se non collegato → `idle`; `poll`; `setFast(enabled)`; se `stop` e `running` → `stop()`; se `requestId` e non `running` → `start(requestId)`, poi `started()` solo se `sweepId` non è null; un errore di `start` (409 compreso) si ignora.
  - `TIMING.remoteEveryMin`: 1 normale, 0.5 in `FAST_TIMING`.
  - `background.ts`:
    - allarme `'remote'` e allarme `'auto'` chiamano `remote.check()`; anche all'avvio del worker e dopo `link`;
    - la `post` della coda controlla la risposta dei lotti e, se `data.stop === true`, chiama `runner.stop()`;
    - `link(code, name?)` usa `name ?? currentName()` e salva `deviceId` dalla risposta; `hello` salva `deviceId` dalla risposta 200 e chiama `remote.check()` se `remote` è true;
    - notifica d'avvio `'remote'`: «Giro avviato dal telefono: HomeRadar cerca i nuovi annunci in una finestra ridotta a icona», bottone «Ferma» (stesso gestore di `'auto'`); `onEnd` la chiude se `remote`.
  - `external.ts`: `ping` aggiunge `deviceId` e `defaultName` (deps nuove `deviceId()`, `defaultName()`); `link` passa `m.name`; `remoteChanged` chiama `d.remoteChanged()` (dep nuova) e risponde `{ ok: true, data: null }`.

- [ ] **Step 1: test che falliscono** (`remote.test.ts` con dipendenze finte):
  - `poll` → `{ enabled: true, requestId: 'r1', stop: false }`, non in corso → `start('r1')` chiamato una volta, `setFast(true)`, `started()` chiamato, risultato `'started'`.
  - `start` che rifiuta con `Error('Richiesta già presa o scaduta')` → nessuna eccezione, `started()` non chiamato (**RF 2**).
  - `start` che restituisce `sweepId: null` (dati freschi) → `started()` non chiamato.
  - `enabled: false` → `setFast(false)`, nessuno `start`.
  - `stop: true` e `running` → `stop()` chiamato; `requestId` mentre `running` → nessuno `start`.
  - Non collegato → `poll` non chiamato; `poll` → `'unlinked'` → nessun'altra chiamata.
  - Due `check()` contemporanei → un solo `poll`.
  - `runner.test.ts`: `start({ remote: 'r1' })` chiama `plan({ auto: false, remote: 'r1' })` e `onEnd` riceve `remote: true`.
  - `external.test.ts`: `ping` restituisce `deviceId` e `defaultName`; `{ type: 'link', code, name: 'PC di casa' }` passa il nome; `remoteChanged` chiama la dep.
- [ ] **Step 2:** `npm test -w apps/connector` → FAIL.
- [ ] **Step 3:** implementare `remote.ts`, `runner`, `external`, `background`, `timing`, versione.
- [ ] **Step 4:** `npm test -w apps/connector` → PASS; `npm run test:e2e -w apps/connector` → PASS (il giro normale non deve cambiare; il fake server deve accettare la risposta 200 di hello).
- [ ] **Step 5:** commit `feat(connector): avvio del giro chiesto dal telefono`.

---

### Task 5: nome al collegamento (web)

**Files:**
- Modify: `apps/web/src/components/Sweep.tsx`
- Test: `apps/web/test/sweep.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`ConnectorState.defaultName`, messaggio `link` con `name`).
- Produces: in `Sweep.tsx`, quando «Cerca» trova il connettore non collegato (o collegato a un altro account), invece di collegare subito mostra nel riquadro il modulo «Collega questo computer — Come lo chiami?» con il campo precompilato da `defaultName`, il suggerimento «es. PC di casa, PC ufficio» e il bottone «Collega»; al clic collega con `{ type: 'link', code, name }` e avvia il giro. Il ricollegamento automatico dopo `notLinked` resta senza domanda (il nome scelto c'è già sul server solo se il dispositivo è lo stesso: si passa `defaultName`).

- [ ] **Step 1: test che falliscono**: con il connettore finto che risponde `linked: false, defaultName: 'Chrome su Windows'`, clic su «Cerca» → compare un campo con valore `Chrome su Windows`; lo si cambia in `PC di casa`, clic su «Collega» → il connettore riceve `{ type: 'link', code: <codice>, name: 'PC di casa' }`, poi `startSweep`.
- [ ] **Step 2:** `npm test -w apps/web` → FAIL.
- [ ] **Step 3:** implementare.
- [ ] **Step 4:** `npm test -w apps/web` → PASS.
- [ ] **Step 5:** commit `feat(web): nome del computer al collegamento`.

---

### Task 6: «I tuoi computer» con nome, interruttore e online (web)

**Files:**
- Modify: `apps/web/src/components/Devices.tsx`, `apps/web/src/pages/Settings.tsx` (se serve passare il connettore), CSS esistente
- Test: `apps/web/test/settings.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`DeviceInfo`), Task 2 (`PATCH /api/devices/:id`), messaggio `remoteChanged`, `ping` con `deviceId`.
- Produces: per ogni computer (bozza approvata, `.superpowers/brainstorm/…/computer-online.html`):
  - prima riga: pallino (solo se `remote && remoteReady`: verde `online`, grigio altrimenti), nome mostrato (`label ?? name`), «(questo computer)» se `id === ping.deviceId`, interruttore «Avvia dal telefono» (solo se `remoteReady`);
  - seconda riga, piccola: «Online ora» / «Non raggiungibile · visto l'ultima volta <data e ora>» (con interruttore attivo), altrimenti «ultimo uso <data>»; poi il nome automatico se c'è un `label`; «Rinomina» (campo in linea, Invio salva, Esc annulla, vuoto = torna al nome automatico) e «Scollega»;
  - con `remoteReady` false: «Aggiorna il connettore per usare l'avvio dal telefono (Chrome lo fa da solo, di solito entro un giorno)» al posto dell'interruttore;
  - sotto l'elenco: «Per avviare le ricerche dal telefono il computer deve essere acceso, non in sospensione, con Chrome aperto. Consiglio: in Windows imposta "Sospensione: mai" quando è collegato alla corrente.»;
  - l'elenco si rilegge ogni 30 s mentre la pagina è visibile;
  - cambiando l'interruttore del computer su cui si è, il portale manda `{ type: 'remoteChanged' }` al connettore (errori ignorati).

- [ ] **Step 1: test che falliscono**: con `GET /api/devices` finto
  - un dispositivo `remote: true, remoteReady: true, online: true, label: 'PC di casa', name: 'Chrome su Windows'` → si vedono «PC di casa», «Online ora», «Chrome su Windows»;
  - un dispositivo `remoteReady: false` → nessun interruttore, testo «Aggiorna il connettore…» (**RF 5**);
  - clic sull'interruttore → `PATCH /api/devices/<id> { remote: true }`; se l'id è quello del `ping` → messaggio `remoteChanged`;
  - «Rinomina», scrivere «PC ufficio», Invio → `PATCH { label: 'PC ufficio' }`; vuoto + Invio → `PATCH { label: null }`.
- [ ] **Step 2:** `npm test -w apps/web` → FAIL.
- [ ] **Step 3:** implementare.
- [ ] **Step 4:** `npm test -w apps/web` → PASS.
- [ ] **Step 5:** commit `feat(web): computer con nome, avvio dal telefono e stato online`.

---

### Task 7: la scheda «Ricerche» sul telefono (web)

**Files:**
- Create: `apps/web/src/components/RemoteSweep.tsx`
- Modify: `apps/web/src/components/Sweep.tsx` (il ramo `phone` e il caso `conn === null` sul computer passano a `RemoteSweep`)
- Test: `apps/web/test/remote-sweep.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`SweepStatus.remote`, `computers`, `SweepProgress.remote/deviceName/stopRequested`), Task 3 (rotte `/api/sweep/remote`, `/api/sweep/stop`).
- Produces: `RemoteSweep({ status, refresh, openedAt, installHint, onShowNew })`, con gli stati della bozza approvata (`telefono-stati.html`):
  1. **Pronto**: riga dell'ultimo giro (`lastLine`, con «· dal telefono» se `last.remote`), riga online («<nome> è online», «<nome> e <nome> sono online», oppure «Nessun tuo computer è online ora»), bottone «Avvia sul computer». Con `computers.enabled === 0`: niente bottone, «Per avviare le ricerche dal telefono attiva «Avvia dal telefono» su un tuo computer in Impostazioni» con link a `/impostazioni` (stato 4b). Risposta `{ fresh: true }` → «Dati già aggiornati da meno di un'ora».
  2. **In attesa** (`remote.state === 'waiting'`): «Aspetto un computer acceso… (fino a 2 minuti)» e «Annulla» (`DELETE /api/sweep/remote`).
  3. **Giro in corso**: «Giro in corso su «<deviceName>»» (o «Giro automatico in corso»), avanzamento, «Finora: N annunci nuovi», «Ferma» (`POST /api/sweep/stop`); con `stopRequested`: «Si ferma entro un minuto…» al posto del bottone.
  4. **Non partito**, per richieste create dopo `openedAt`: `noAnswer` → «Nessun computer ha risposto» + «Serve un computer acceso, non in sospensione, con Chrome aperto e «Avvia dal telefono» attivo.» + «Riprova»; `fresh` → «Dati già aggiornati da meno di un'ora»; `failed` → ««<deviceName>» ha risposto ma il giro non è partito: riprova» + «Riprova»; `busy` → si vede il giro in corso.
  5. **Finito** (come oggi sul computer): titolo con esito e durata, conteggi, motivi (`reasons`), «Vedi i nuovi», «Chiudi». Sul telefono il motivo `blocked` dice «… ha chiesto una verifica: aprilo quando sei al computer.».
  - `GET /api/sweep` si rilegge ogni 3 s mentre c'è una richiesta in attesa o un giro in corso (oggi il telefono non rilegge durante l'attesa).
  - Sul computer senza connettore (`conn === null`) restano sopra le istruzioni d'installazione (`installHint`) e sotto il bottone.

- [ ] **Step 1: test che falliscono** (status finto passato come prop o da `api` finto):
  - `computers: { enabled: 1, online: ['PC di casa'] }`, nessun giro → «PC di casa è online» e il bottone; clic → `POST /api/sweep/remote`.
  - `enabled: 0` → nessun bottone, testo e link alle impostazioni (**RF 5**).
  - `remote: { state: 'waiting' }` → «Aspetto un computer acceso…», clic su «Annulla» → `DELETE /api/sweep/remote`.
  - `remote: { state: 'noAnswer', createdAt > openedAt }` → «Nessun computer ha risposto»; con `createdAt < openedAt` → stato pronto.
  - `remote: { state: 'failed', deviceName: 'PC di casa' }` → ««PC di casa» ha risposto ma il giro non è partito: riprova» (**RF 3**).
  - `running: { remote: true, deviceName: 'PC di casa', stopRequested: false }` → «Giro in corso su «PC di casa»», clic su «Ferma» → `POST /api/sweep/stop`; con `stopRequested: true` → «Si ferma entro un minuto».
  - `POST /api/sweep/remote` che risponde `{ fresh: true }` → «Dati già aggiornati da meno di un'ora».
  - I test esistenti del telefono in `sweep.test.tsx` vanno aggiornati: «Le ricerche partono dal computer» non c'è più.
- [ ] **Step 2:** `npm test -w apps/web` → FAIL.
- [ ] **Step 3:** implementare `RemoteSweep` e collegarlo in `Sweep.tsx`.
- [ ] **Step 4:** `npm test -w apps/web` → PASS; `npm run test:e2e -w apps/web` → PASS.
- [ ] **Step 5:** commit `feat(web): avvio del giro dal telefono`.

---

### Task 8: informativa, documenti e verifica finale

**Files:**
- Modify: `apps/web/src/pages/Privacy.tsx`, `packages/shared/src/api/types.ts` (`PRIVACY_VERSION = 3`), `CLAUDE.md`, `docs/roadmap.md`, `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md` (§2, §11), `docs/web-store.md`
- Test: test esistenti che controllano `PRIVACY_VERSION` o il testo dell'informativa

- [ ] **Step 1:** informativa: nel paragrafo sul giro aggiungere che si può avviare anche dal telefono, su un computer dove l'agente ha attivato «Avvia dal telefono», in una finestra ridotta a icona, e fermarlo dal telefono; in «Cos'altro registra il portale» aggiungere il nome scelto per il computer e, con «Avvia dal telefono» attivo, un contatto al minuto per sapere se è acceso. `PRIVACY_VERSION = 3`.
- [ ] **Step 2:** `CLAUDE.md`: vincolo «il connettore legge solo durante il giro (lanciato dall'agente dal computer o dal telefono, o automatico…)»; in `apps/connector` aggiungere `src/remote.ts` (controllo al minuto con l'interruttore attivo, ogni 15 minuti se spento, stop dalla risposta ai lotti); in `apps/server` aggiungere `src/remote.ts`; in `apps/web` aggiungere `components/RemoteSweep.tsx` e il nuovo comportamento sul telefono.
- [ ] **Step 3:** roadmap: riga **6e «Avvia dal telefono»** con spec e piano, stato «fatto» a fine lavoro; spec del portale §2/§11: l'avvio dal telefono non è più rinviato (rimando alla spec nuova). `docs/web-store.md`: scopo unico (giro chiesto dal portale, anche dal telefono), `alarms` anche per il controllo al minuto, `notifications` con l'avviso «Giro avviato dal telefono».
- [ ] **Step 4:** `npm run typecheck` e `npm test` → tutto verde; `npm run build` → ok.
- [ ] **Step 5:** commit `docs: avvio dal telefono in informativa, CLAUDE.md e roadmap`.
