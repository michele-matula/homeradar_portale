# Portale, tappa 2: archivio — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il server diventa l'archivio condiviso: riceve dal connettore piano, lotti ed esiti delle ricerche, unisce gli annunci come faceva `LeadService.ingest`, tiene `search_runs`, freschezza e "non più visto" con più agenti, e dà a ogni agente i suoi lead (zona e categorie sue) con stati, note, richiami, separazioni e impostazioni private.

**Architecture:** La logica pura che stava in `../homeradar/src/core/service.ts` (unione di un'osservazione, ribassi, stato del lead, separazione) passa in moduli puri di `packages/shared/src/core/`; il Worker legge e scrive D1 con query semplici e `db.batch` (atomico) e chiama quella logica. Il connettore parla con `/connector/*` con un token di dispositivo (`Authorization: Bearer`), il portale con `/api/*` con la sessione. Il collegamento del connettore dal portale (codice monouso) è della tappa 3: qui esiste la tabella `devices`, l'autenticazione del dispositivo e la funzione che crea un token, usata dai test.

**Tech Stack:** TypeScript 7, zod 4, Cloudflare Workers + D1, `@cloudflare/vitest-plugin`, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md` (§5 Modello dei dati, "Cosa vede un agente", "Pulizia"; §6.3 Il giro delle ricerche e "Non più visto" con più agenti; §6.4 id dei lotti; §6.5; §8). Riferimento per la logica e i test da portare: `../homeradar/src/core/service.ts` e `../homeradar/tests/unit/core/service.*.test.ts`.

## Global Constraints

- Messaggi d'errore delle API in italiano, corpo `{ "error": "…" }`; schemi zod `strict` (campi non dichiarati rifiutati), costruiti con l'helper `body()` di `api/types.ts`.
- Timestamp in ms epoch UTC; giorno locale dei richiami Europe/Rome (`core/recall.ts`).
- Il server non fa mai richieste verso i portali. Dal connettore arrivano solo annunci di privati (`sellerType: 'private'`) e solo i campi di `ListingObservation`: niente nomi né telefoni.
- Nessun riferimento all'agente in `listings`, `price_snapshots`, `calibration_points`. Nessuna risposta di `/api/*` rivela chi altro lavora una zona (niente id, email o conteggi di agenti).
- Ogni query su `lead_states`, `splits`, `user_settings`, `sweeps` letta da `/api/*` filtra per l'utente della sessione.
- Liste passate a SQL con un solo parametro: `IN (SELECT value FROM json_each(?))` (D1 ammette al più 100 parametri per query).
- Freschezza: `config.freshness_minutes` (default 60). Ricerca "in corso" di un altro agente: avviata da meno di 15 minuti (`RUNNING_SKIP_MS = 15 * 60_000`).
- "Non più visto": `MISSING_SWEEPS` (3) ricerche complete senza l'annuncio, di qualsiasi agente, **e** non visto da almeno 24 ore (`MISSING_MIN_AGE_MS = 86_400_000`).
- Lista dell'agente: fuori gli annunci non visti da più di 90 giorni (`HIDE_AFTER_DAYS = 90`, su `lastSeenAt` di tutte le fonti del lead) se non lavorati (stato ≠ nuovo, note o richiamo).
- Un solo giro in corso per agente; giro senza attività da 15 minuti (`SWEEP_STALE_MS = 15 * 60_000`) = interrotto.
- Lotti: al più 100 osservazioni, corpo al più 512 KB, al più 30 lotti al minuto per dispositivo; id del lotto UUID, duplicati ignorati per 48 ore.
- Migrazioni: si aggiunge `0002_archive.sql`, `0001_accounts.sql` non si tocca.
- `PRIVACY_VERSION` resta 1: l'informativa è ancora un segnaposto (`apps/web/src/pages/Privacy.tsx`), il testo vero arriva in tappa 6. Il Task 10 aggiunge alla roadmap cosa dovrà dire.

## Review Focus

1. Lotto arrivato in ritardo dalla coda del connettore (ore dopo) per un annuncio che un altro agente ha visto più di recente → prezzo, `lastSeenAt` e dati non tornano indietro; l'annuncio conta comunque come visto per la ricerca del lotto. Test nel Task 8.
2. Stesso lotto mandato due volte (il server l'aveva salvato ma la risposta si è persa), anche in parallelo → il secondo è ignorato: niente prezzi doppi, `seenCount` e ribassi invariati, risposta 200. Test nel Task 8.
3. Esito `complete` di una ricerca che arriva prima di tutti i suoi lotti → "non più visto" si applica solo quando sono arrivate tante pagine quante dichiarate; gli annunci delle pagine mancanti non risultano mancati. Test nel Task 9.
4. Due agenti con zone sovrapposte → B vede gli annunci trovati da A, mai stati, note, richiami, separazioni o impostazioni di A; piano e avanzamento di B non dicono chi ha fatto le ricerche fresche. Test nei Task 5, 6 e 7.
5. Connettore chiuso a metà giro (il giro resta "in corso") → dopo 15 minuti senza attività un nuovo «Cerca», anche da un altro computer, parte e il vecchio giro risulta interrotto; prima dei 15 minuti, da un altro computer, 409. Test nel Task 7.

---

## Struttura dei file

```
packages/shared/src/
  core/ingest.ts            NUOVO  unione di un'osservazione con l'annuncio salvato, prezzi, punto di calibrazione
  core/lead-state.ts        NUOVO  stato/note/richiamo di un gruppo, separazione (da service.ts)
  core/missing.ts           24 ore oltre ai 3 giri: isMissing(l, now)
  core/lead-groups.ts       isMissing con now; isWorked, isHidden, HIDE_AFTER_DAYS
  core/rules.ts             RuleSettings = Pick<Settings, 'minAgeDays' | 'minDropPercent'>
  core/lead-filters.ts      scopeIstat()
  api/types.ts              AgentSettings, LeadsResponse, corpi di settings/stato/separazione
  api/connector.ts          NUOVO  schemi e tipi di /connector/* (osservazione, lotto, esito, piano)
apps/server/
  migrations/0002_archive.sql
  src/archive.ts            righe D1 ↔ ListingRecord/PriceSnapshot/LeadState/SplitPair; zona dell'agente
  src/device.ts             token di dispositivo, authenticateDevice, deviceRoute
  src/session.ts            + userRoute (rotta con utente della sessione)
  src/settings.ts           impostazioni dell'agente
  src/leads.ts              lead dell'agente, richiami, stato, separazione
  src/sweeps.ts             piano, freschezza, giri, esiti, "non più visto", risultato, avanzamento
  src/ingest.ts             lotti
  src/routes/connector.ts   /connector/*
  src/routes/leads.ts       /api/leads*, /api/settings, /api/sweep
  src/index.ts, wrangler.toml   dispatch e asset per /connector/*
  test/helpers.ts           resetDb esteso, linkDevice, putListing, sendBatch
  test/*.test.ts
```

---

### Task 1: Logica pura dell'archivio nel pacchetto condiviso

**Files:**
- Create: `packages/shared/src/core/ingest.ts`, `packages/shared/src/core/lead-state.ts`
- Modify: `packages/shared/src/core/missing.ts`, `core/lead-groups.ts`, `core/rules.ts`, `core/lead-filters.ts`
- Test: `packages/shared/tests/unit/core/ingest.test.ts`, `lead-state.test.ts` (nuovi), `missing.test.ts`, `lead-groups.test.ts`, `lead-filters.test.ts`

**Interfaces:**
- Produces:
  - `core/rules.ts`: `type RuleSettings = Pick<Settings, 'minAgeDays' | 'minDropPercent'>`; `evaluate`, `evaluateGroup` e `buildLeadViews` accettano `RuleSettings` (chi passa `Settings` continua a compilare).
  - `core/missing.ts`: `MISSING_MIN_AGE_MS = 86_400_000`; `isMissing(l: ListingRecord, now: number): boolean` = `l.missedSweeps >= MISSING_SWEEPS && now - l.lastSeenAt >= MISSING_MIN_AGE_MS`.
  - `core/lead-groups.ts`: `isWorked(s: LeadState): boolean` (l'attuale `worked`, esportato); `HIDE_AFTER_DAYS = 90`; `isHidden(v: LeadView, now: number): boolean`.
  - `core/lead-filters.ts`: `scopeIstat(sweepScope: string | null): string | null` (la regex `SCOPE_ISTAT` già usata da `leadComuni`, che la riusa).
  - `core/ingest.ts`:
    ```ts
    export interface IngestContext { at: number; sweepScope: string; searchCategory: PropertyCategory | null; points: IdDate[] }
    export interface Merged { record: ListingRecord; snapshots: Omit<PriceSnapshot, 'id'>[]; dropped: boolean }
    export function mergeObservation(prev: ListingRecord | null, o: ListingObservation, ctx: IngestContext, lastPrice: number | null): Merged | null
    export function learnedPoint(hint: CalibrationHint, points: IdDate[], at: number): CalibrationPoint | null
    ```
  - `core/lead-state.ts`:
    ```ts
    export const RECALL_ON_DISCARDED = 'Impossibile impostare un richiamo su un lead scartato';
    export type LeadPatch = { status?: LeadStatus; notes?: string; recallAt?: number | null };
    export function nextLeadState(prev: LeadState, patch: LeadPatch, now: number): LeadState
    export function groupStateWrite(members: MemberState[], patch: LeadPatch, now: number): { prev: LeadState; next: LeadState }
    export function splitWrites(archive: Pick<Archive, 'listings' | 'splits'>, members: MemberState[], key: string, fromKeys: string[], now: number): { states: LeadState[]; pairs: SplitPair[] }
    ```

- [ ] **Step 1: Test di `isMissing` e `isHidden`**

In `missing.test.ts`: `isMissing({ ...rec, missedSweeps: 3, lastSeenAt: NOW - 23 * 3_600_000 }, NOW)` → `false`; con `NOW - 25 * 3_600_000` → `true`; con `missedSweeps: 2` e `lastSeenAt: 0` → `false`.
In `lead-groups.test.ts`: tre annunci mancati con `lastSeenAt` di un'ora fa → `missing: null`; `isHidden` vero per un lead "Nuovo" senza note né richiamo con tutte le fonti a `lastSeenAt = NOW - 91 * DAY_MS`, falso se una fonte è a `NOW - 89 * DAY_MS`, falso con `status: 'contacted'`, con note `'x'` o con `recallAt` impostato. I test esistenti (con `lastSeenAt: 0`) devono restare verdi.
In `lead-filters.test.ts`: `scopeIstat('subito|comune:016219|immobili')` → `'016219'`, `scopeIstat(null)` → `null`, `scopeIstat('x')` → `null`.

- [ ] **Step 2: Test di `mergeObservation` e `learnedPoint`**

Porta in `ingest.test.ts` i casi di unione di `../homeradar/tests/unit/core/service.ingest.test.ts` riscritti sulla funzione pura (stessi valori): primo avvistamento (`firstSeenAt = lastSeenAt = at`, `seenCount: 1`, snapshot `observed`); campi null che non cancellano quelli salvati; `priceReserved` azzera `currentPrice`; categoria da osservazione → `searchCategory` → precedente → `'residential'`; `seenCount` e `lastSeenAt` che non avanzano entro `VISIT_GAP_MS`; copertina mai cancellata da una lettura senza foto; ribasso dichiarato con due snapshot `declared` (`date - 1` e `date`); ribasso senza data che prende `utcDay(at)` con `dateEstimated: true` e resta lo stesso alla lettura successiva; `dropped` vero solo per un annuncio già salvato con prezzo sceso o ribasso nuovo; `missedSweeps: 0, missingSince: null` dopo l'avvistamento; snapshot `observed` solo se `price !== lastPrice`. Nuovo caso: `prev.lastSeenAt > ctx.at` → `null`.
`learnedPoint`: restituisce `{ portal, portalId, createdAt: utcDay(at) }` se `acceptLearnedPoint` lo accetta con `LEARN_RATE_PER_DAY[portal]`, `null` per Immobiliare (nessun ritmo) o per un punto incoerente.

- [ ] **Step 3: Test di `lead-state.ts`**

Porta da `service.leads.test.ts` e `service.groups.test.ts` i casi di `setLeadState` e `splitListing` sulle funzioni pure: `updatedAt` che avanza solo se qualcosa cambia; richiamo su "Nuovo" → "Da contattare"; `recallAt` riportato a `startOfLocalDay`; richiamo su scartato → eccezione `RECALL_ON_DISCARDED`; scartare cancella il richiamo; gruppo con stati diversi che parte da `mergeGroupState` e scrive lo stesso stato su tutti; `splitWrites` che scrive su tutte le chiavi lo stato unito e stacca l'intera catena di ripubblicazione (coppie `splitPair(c, k, now)` per ogni `c` della catena e `k` delle altre fonti).

- [ ] **Step 4: Verifica che falliscano**

Run: `npm test -w packages/shared`
Expected: FAIL sui test nuovi (moduli ed export mancanti).

- [ ] **Step 5: Implementa**

`mergeObservation` è il corpo del ciclo di `LeadService.ingest` (con `resolveDrop` e `recordSnapshots`) con `ctx.at` al posto di `now`; `estimatedCreatedAt` da `estimateCreatedAt(o.portalId, ctx.points)`. Il server passa solo osservazioni di privati: la funzione non filtra `sellerType`. `groupStateWrite` è il corpo di `setLeadState` (prev unito se più membri, `nextLeadState`, `updatedAt` portato a `now` se un membro cambia). `splitWrites` è il corpo di `splitListing` con `chainEndingAt` calcolato da `groupListings(archive.listings, archive.splits)`. In `lead-groups.ts` `byPrimary` diventa una funzione costruita con `now`.

- [ ] **Step 6: Verifica**

Run: `npm test -w packages/shared` e `npm run typecheck`
Expected: PASS, nessun errore di tipo nei tre workspace.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): unione degli annunci, stato dei lead e \"non più visto\" a 24 ore in logica pura"
```

---

### Task 2: Schemi delle API dell'archivio e del connettore

**Files:**
- Modify: `packages/shared/src/api/types.ts`
- Create: `packages/shared/src/api/connector.ts`
- Test: `packages/shared/tests/unit/api/types.test.ts`, `packages/shared/tests/unit/api/connector.test.ts`

**Interfaces:**
- Produces in `api/types.ts` (esporta anche `body` per riusarlo in `connector.ts`):
  ```ts
  export interface AgentSettings { minAgeDays: number; minDropPercent: number; categories: PropertyCategory[]; enabledPortals: Record<Portal, boolean> }
  export const DEFAULT_AGENT_SETTINGS: AgentSettings // 120, 0, ['residential'], tutti i portali accesi
  export const AgentSettingsBody // tutti i campi facoltativi; enabledPortals parziale
  export interface LeadsResponse { leads: LeadView[]; dueRecalls: number }
  export const LeadStateBody // { keys: ListingKey[] 1..50, status?: LeadStatus, notes?: string ≤ 2000, recallAt?: number | null }
  export const SplitBody     // { key: ListingKey, fromKeys: ListingKey[] 1..20 }
  ```
  `ListingKey` = stringa `^(immobiliare|idealista|subito|casadaprivato):\d+$`, errore "Annuncio non valido".
- Produces in `api/connector.ts`:
  ```ts
  export const MAX_BATCH_OBSERVATIONS = 100;
  export const ObservationSchema   // ListingObservation strict, sellerType: z.literal('private')
  export const PageReportSchema    // PageReport strict
  export const BatchBody           // { id: uuid, sweepId: uuid, searchKey: string ≤ 200, readAt: int, report, observations ≤ 100, newestId?: int > 0 }
  export const RunBody             // { sweepId, searchKey, outcome: 'complete'|'capped'|'blocked'|'error'|'notFound'|'skipped', pages: int 0..MAX_PAGES_PER_SEARCH, privates: int ≥ 0 }
  export const FinishBody          // { outcome: SweepOutcome }
  export const StartSweepBody      // {} strict
  export interface SweepPlan { sweepId: string | null; searches: SearchSpec[]; skipped: number }
  export type Batch = z.infer<typeof BatchBody>; export type RunReport = z.infer<typeof RunBody>
  ```

- [ ] **Step 1: Test degli schemi**

`connector.test.ts`: un'osservazione valida passa; `sellerType: 'agency'` → errore; un campo in più (`phone: '333…'`, `sellerName: 'Mario'`) → errore "Campo non ammesso: phone"; `url` non `https://` sul dominio del portale dell'osservazione (`PORTAL_SITES` in minuscolo, con o senza `www.`) → errore; `coverUrl` non ammesso da `coverOrNull` → trasformato in `null` (non errore); `title` oltre 300 caratteri, `address`/`city`/`zone`/`typology` oltre 200 → errore; 101 osservazioni → "Al massimo 100 annunci per lotto"; `id` non UUID → errore.
`types.test.ts`: `AgentSettingsBody` rifiuta `minAgeDays: 0`, `3651`, `1.5` ("Soglia giorni non valida"), `minDropPercent: -1`/`101` ("Ribasso minimo non valido"), `categories: []` ("Scegli almeno una categoria"), una categoria sconosciuta; `LeadStateBody` rifiuta `keys: []`, 51 chiavi, `'foo:1'`, note di 2001 caratteri.

- [ ] **Step 2: Verifica che falliscano**

Run: `npm test -w packages/shared`
Expected: FAIL (export mancanti).

- [ ] **Step 3: Implementa** gli schemi con i messaggi in italiano come quelli esistenti (`missingOr`, `body`). Nessuna regola "almeno un portale acceso" nello schema: la mette il server (Task 4) perché dipende dai valori già salvati.

- [ ] **Step 4: Verifica**

Run: `npm test -w packages/shared` e `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): schemi delle API dell'archivio e del connettore"
```

---

### Task 3: Schema D1, accesso ai dati e dispositivi

**Files:**
- Create: `apps/server/migrations/0002_archive.sql`, `apps/server/src/archive.ts`, `apps/server/src/device.ts`
- Modify: `apps/server/src/session.ts`, `apps/server/src/index.ts`, `apps/server/wrangler.toml`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/archive.test.ts`, `apps/server/test/device.test.ts`

**Interfaces:**
- Produces:
  - Tabelle (colonne in snake_case, timestamp `INTEGER`):
    - `listings`: tutti i campi di `ListingRecord` (`last_drop` JSON, `cover_url` nullabile) più `city_norm` (`normalize(city)`) e `scope_istat` (`scopeIstat(sweep_scope)`); indici `(scope_istat, category)`, `(city_norm, category)`, `(sweep_scope)`.
    - `price_snapshots(id AUTOINCREMENT, listing_key → listings ON DELETE CASCADE, price, at, source CHECK IN ('observed','declared'), UNIQUE(listing_key, at))`.
    - `calibration_points(portal, portal_id, created_at, PRIMARY KEY(portal, portal_id))`.
    - `devices(id, user_id → users ON DELETE CASCADE, name, token_hash UNIQUE, version, created_at, last_seen_at)`.
    - `sweeps(id, user_id → users ON DELETE SET NULL, device_id → devices ON DELETE SET NULL, started_at, last_activity_at, finished_at, outcome CHECK IN ('completed','partial','stopped','interrupted') nullabile, drops DEFAULT 0, missing DEFAULT 0, result JSON nullabile)`; indice `(user_id, started_at)`.
    - `search_runs(id AUTOINCREMENT, sweep_id → sweeps ON DELETE CASCADE, search_key, portal, spec JSON, user_id → users ON DELETE SET NULL, status CHECK IN ('pending','running','complete','capped','blocked','error','notFound','skipped'), started_at, finished_at, pages DEFAULT 0, pages_received DEFAULT 0, privates DEFAULT 0, missing_applied DEFAULT 0, UNIQUE(sweep_id, search_key))`; indice `(search_key, status)`.
    - `run_seen(run_id → search_runs ON DELETE CASCADE, listing_key, PRIMARY KEY(run_id, listing_key))`.
    - `batches(id PRIMARY KEY, device_id, received_at)`; indice `(device_id, received_at)`.
    - `lead_states(user_id → users ON DELETE CASCADE, listing_key, status, notes, status_changed_at, updated_at, recall_at, PRIMARY KEY(user_id, listing_key))`.
    - `splits(user_id → users ON DELETE CASCADE, a, b, at, PRIMARY KEY(user_id, a, b))`.
    - `user_settings(user_id PRIMARY KEY → users ON DELETE CASCADE, min_age_days, min_drop_percent, categories JSON, enabled_portals JSON, updated_at)`.
  - `archive.ts`: `rowToListing(r): ListingRecord`, `upsertListing(db, l: ListingRecord): D1PreparedStatement` (`INSERT … ON CONFLICT(key) DO UPDATE`, calcola `city_norm` e `scope_istat`), `insertSnapshot(db, key, s): D1PreparedStatement` (`INSERT OR IGNORE`), `rowToState`, `putState(db, userId, s: LeadState): D1PreparedStatement`, `putSplit(db, userId, p: SplitPair): D1PreparedStatement`, `listingsByKeys(db, keys: string[]): Promise<ListingRecord[]>`, `loadAgentArchive(db, userId: string, comuni: ComuneRef[], categories: PropertyCategory[]): Promise<Archive>`.
  - `device.ts`: `insertDevice(db, userId: string, name: string, now: number): Promise<{ id: string; token: string }>` (token con `newToken`, salvato con `hashToken`); `authenticateDevice(req, env, now): Promise<{ user: UserRow; deviceId: string } | Response>`; `deviceRoute(method, pattern, h: (req, env, params, ctx: { user: UserRow; deviceId: string; now: number }) => Promise<Response>): Route`.
  - `session.ts`: `userRoute(method, pattern, h: (req, env, params, ctx: { user: UserRow; now: number }) => Promise<Response>): Route` (come il wrapper `admin` di `admin-users.ts`, con `Set-Cookie` del rinnovo).
  - `index.ts`: i percorsi `/connector/*` vanno alle rotte del connettore **senza** il controllo dell'`Origin` (il connettore non è una pagina e non ha cookie); 404 `{ error: 'Non trovato' }`, 500 `{ error: 'Errore interno' }` come per `/api`. `wrangler.toml`: `run_worker_first = ["/api/*", "/connector/*"]`.
  - `test/helpers.ts`: `resetDb()` svuota anche le tabelle nuove (figlie prima); `linkDevice(userId): Promise<{ id: string; auth: Record<string, string> }>`; `putListing(o: Partial<ListingRecord> & { portal: Portal; portalId: number }): Promise<ListingRecord>` con valori di default; `fetchConnector(method, path, body, auth)` senza `Origin`.

`loadAgentArchive` prende gli annunci con `category IN categories AND (scope_istat IN istat della zona OR city_norm IN nomi normalizzati della zona)`, i loro snapshot con una `JOIN` sulla stessa condizione, e **solo** gli stati e le coppie separate di `userId`.

- [ ] **Step 1: Test**

`device.test.ts`: senza `Authorization` → 401 "Connettore non collegato"; token sconosciuto → 401 stesso messaggio; utente sospeso → 403 "Account sospeso" e il dispositivo resta in tabella; `last_seen_at` aggiornato al più ogni 10 minuti; una richiesta `POST /connector/qualcosa` senza `Origin` → 404 (non 403); un cookie di sessione valido non basta per `/connector/*`.
`archive.test.ts`: `upsertListing` + `rowToListing` restituiscono lo stesso `ListingRecord` (con e senza `coverUrl`, `lastDrop`); `loadAgentArchive` per Treviglio (`016219`) prende un annuncio con `city: 'Treviglio'` trovato da una ricerca di un altro comune e uno con `city: null` della ricerca `immobiliare|comune:016219|case`, non quello di Caravaggio né quello di Treviglio con categoria non scelta; restituisce gli stati di quell'utente e non quelli di un altro; cancellare l'utente cancella `lead_states`, `splits`, `user_settings`, `devices` e lascia `sweeps` e `search_runs` con `user_id` NULL.

- [ ] **Step 2: Verifica che falliscano**

Run: `npm test -w apps/server`
Expected: FAIL.

- [ ] **Step 3: Implementa** migrazione, `archive.ts`, `device.ts`, `userRoute`, dispatch e helper. D1 applica le chiavi esterne: verificalo con il test di cancellazione, non con un `PRAGMA`.

- [ ] **Step 4: Verifica**

Run: `npm test -w apps/server` e `npm run typecheck`
Expected: PASS, anche i test della tappa 1.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): schema dell'archivio, accesso ai dati e token dei dispositivi"
```

---

### Task 4: Impostazioni dell'agente

**Files:**
- Create: `apps/server/src/settings.ts`, `apps/server/src/routes/leads.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/settings.test.ts`

**Interfaces:**
- Consumes: `AgentSettings`, `DEFAULT_AGENT_SETTINGS`, `AgentSettingsBody` (Task 2); `userRoute` (Task 3).
- Produces: `getSettings(db, userId): Promise<AgentSettings>` (default se non c'è riga), `saveSettings(db, userId, patch, now): Promise<AgentSettings | string>` (stringa = messaggio d'errore); rotte `GET /api/settings` → `AgentSettings`, `PUT /api/settings` → `AgentSettings`. `leadRoutes: Route[]` esportato da `routes/leads.ts` e aggiunto in `index.ts` (i Task 5, 6 e 9 ci aggiungono le loro rotte).

- [ ] **Step 1: Test**: senza sessione 401; prima lettura = default; `PUT { minAgeDays: 90 }` cambia solo quel campo; `PUT { enabledPortals: { subito: false } }` lascia accesi gli altri; spegnere tutti i portali → 400 "Attiva almeno un portale"; valori non validi → 400 col messaggio dello schema; le impostazioni di A non cambiano quelle di B; un `PUT` senza `Origin` → 403.
- [ ] **Step 2: Verifica che falliscano** — `npm test -w apps/server`, FAIL.
- [ ] **Step 3: Implementa** (`INSERT … ON CONFLICT(user_id) DO UPDATE`).
- [ ] **Step 4: Verifica** — `npm test -w apps/server`, PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): impostazioni dell'agente"`

---

### Task 5: Lead dell'agente

**Files:**
- Create: `apps/server/src/leads.ts`
- Modify: `apps/server/src/routes/leads.ts`
- Test: `apps/server/test/leads.test.ts`

**Interfaces:**
- Consumes: `loadAgentArchive` (Task 3), `getSettings` (Task 4), `buildLeadViews`, `isListed`, `isHidden`, `leadComuni`, `sortLeads`, `isDue`.
- Produces: `agentLeads(db, user: UserRow, now: number): Promise<LeadView[]>` (zona, categorie, `isListed`, non `isHidden`, `sortLeads`); `dueRecallCount(views: LeadView[], now): number` (lead con `isDue(state.recallAt, now)` e stato ≠ scartato); rotta `GET /api/leads` → `LeadsResponse`.

Un lead resta se `leadComuni(view, toComuneRefs(user.comuni))` non è vuoto. Il mercato si calcola su tutto l'archivio caricato (prima del filtro per comune), come in `buildLeadViews`.

- [ ] **Step 1: Test** (annunci creati con `putListing`, età sopra i 120 giorni perché abbiano priorità):
  - agente di Treviglio con categoria residenziale: vede l'annuncio di Treviglio trovato dalla ricerca di Caravaggio (sconfinamento), non quello di Caravaggio, non un box di Treviglio; con `categories: ['residential', 'garage']` vede anche il box;
  - lo stesso immobile su Immobiliare e Idealista è un solo lead con `others` di lunghezza 1;
  - un annuncio "Nuovo" visto 91 giorni fa non c'è; con una nota dell'agente c'è;
  - isolamento: A e B hanno lo stesso comune; uno stato e una nota di A (scritti con `putState`) non compaiono nella risposta di B, dove il lead è "Nuovo" con note vuote; una coppia separata da A non separa il lead per B;
  - `dueRecalls`: un richiamo di ieri e uno di oggi sullo stesso gruppo contano 1; uno di domani 0; uno su un lead scartato 0;
  - senza sessione 401; admin senza comuni → `{ leads: [], dueRecalls: 0 }`.
- [ ] **Step 2: Verifica che falliscano** — FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Verifica** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): lettura dei lead per agente"`

---

### Task 6: Stato, note, richiami e separazioni

**Files:**
- Modify: `apps/server/src/leads.ts`, `apps/server/src/routes/leads.ts`
- Test: `apps/server/test/lead-state.test.ts`

**Interfaces:**
- Consumes: `groupStateWrite`, `splitWrites`, `RECALL_ON_DISCARDED` (Task 1); `listingsByKeys`, `putState`, `putSplit`, `loadAgentArchive` (Task 3); `LeadStateBody`, `SplitBody` (Task 2).
- Produces: `setLeadState(db, userId, keys, patch, now): Promise<LeadState | string>`, `splitLead(db, user, key, fromKeys, now): Promise<void | string>`; rotte `PATCH /api/leads/state` → `{ state: LeadState }` e `POST /api/leads/split` → 204.

Gli stati letti e scritti sono solo quelli dell'utente; le scritture di un gruppo vanno in un solo `db.batch`. Chiave inesistente in `listings` → 404 "Annuncio non trovato". `RECALL_ON_DISCARDED` → 400 con quel messaggio.

- [ ] **Step 1: Test**: cambio di stato su un gruppo di due chiavi scrive lo stesso stato su entrambe e `GET /api/leads` lo mostra; richiamo su un lead nuovo → "Da contattare"; richiamo su scartato → 400; chiave inesistente → 404 e nulla scritto anche per le altre chiavi; lo stato di A non tocca le righe di B per la stessa chiave; separazione: dopo `POST /api/leads/split` A vede due lead, B ne vede ancora uno; richiesta senza `Origin` → 403.
- [ ] **Step 2: Verifica che falliscano** — FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Verifica** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): stato, note, richiami e separazioni dei lead"`

---

### Task 7: Piano delle ricerche, freschezza e giri

**Files:**
- Create: `apps/server/src/sweeps.ts`, `apps/server/src/routes/connector.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/plan.test.ts`

**Interfaces:**
- Consumes: `deviceRoute` (Task 3), `getSettings` (Task 4), `searchesFor`, `toComuneRefs`, `SweepPlan`, `StartSweepBody` (Task 2).
- Produces:
  - `RUNNING_SKIP_MS`, `SWEEP_STALE_MS`;
  - `closeStaleSweeps(db, userId, now): Promise<void>` (giri senza `finished_at` con `last_activity_at < now - SWEEP_STALE_MS` → `finishSweep(…, 'interrupted')`);
  - `startSweep(db, user, deviceId, now): Promise<SweepPlan | Response>`;
  - `connectorRoutes: Route[]` con `POST /connector/sweeps` → 201 `SweepPlan` (200 con `sweepId: null` se tutte saltate).

`startSweep`: chiude i giri scaduti; se l'utente ha un giro aperto da un altro dispositivo → 409 "Giro già in corso su un altro computer"; da questo dispositivo → lo chiude come `interrupted`. Senza comuni → 400 "Nessun comune assegnato: chiedi all'amministratore". Le ricerche sono `searchesFor({ comuni: toComuneRefs(user.comuni), categories }, enabledPortals)`; si salta una ricerca con un `search_run` `complete` e `finished_at > now - freshness_minutes * 60_000` (di chiunque, anche dello stesso agente) o `running` con `started_at > now - RUNNING_SKIP_MS` e `user_id IS NOT` l'agente. Se ne resta almeno una: un `db.batch` crea il giro (`last_activity_at = now`) e una riga `pending` per ricerca (con `spec` JSON). `finishSweep` è del Task 9: in questo task scrivilo con la firma del Task 9 e un corpo che imposta solo `finished_at` e `outcome`; il Task 9 lo completa.

- [ ] **Step 1: Test**:
  - due comuni, residenziale, tutti i portali → tante ricerche quante `searchesFor` (ordine compreso), `skipped: 0`, righe `pending` in `search_runs`;
  - una ricerca `complete` di B 30 minuti fa → A la salta; 61 minuti fa → non la salta; `freshness_minutes = 120` in `config` → 61 minuti fa la salta;
  - una ricerca `running` di B avviata 10 minuti fa → A la salta; 16 minuti fa → no; `running` di A stesso → no;
  - tutte fresche → 200 `{ sweepId: null, searches: [], skipped: n }`, nessun giro creato;
  - la risposta contiene solo `sweepId`, `searches` (`SearchSpec`) e `skipped`: nessun id o email di altri utenti (controllo sul JSON serializzato);
  - giro aperto da un altro dispositivo da 5 minuti → 409; da 16 minuti → 201 e il vecchio ha `outcome: 'interrupted'`; giro aperto dallo stesso dispositivo → 201 e il vecchio è `interrupted`;
  - portale spento nelle impostazioni → nessuna sua ricerca; nessun comune → 400; corpo con campi in più → 400.
- [ ] **Step 2: Verifica che falliscano** — FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Verifica** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): piano delle ricerche con freschezza e un giro alla volta"`

---

### Task 8: Lotti di annunci

**Files:**
- Create: `apps/server/src/ingest.ts`
- Modify: `apps/server/src/routes/connector.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/ingest.test.ts`

**Interfaces:**
- Consumes: `mergeObservation`, `learnedPoint` (Task 1); `BatchBody`, `MAX_BATCH_OBSERVATIONS` (Task 2); `upsertListing`, `insertSnapshot`, `listingsByKeys` (Task 3); `acceptObservation`, `searchCategory`, `mergeCalibration`, `DEFAULT_CALIBRATION`.
- Produces: `ingestBatch(db, user, deviceId, batch: Batch, now): Promise<Response>`; `maybeApplyMissing(db, runId: number, now): Promise<void>` dichiarata qui come no-op e completata nel Task 9; rotta `POST /connector/batches` → 200 `{ ok: true }` (anche per un duplicato); helper di test `sendBatch(auth, partial)`.

Passi di `ingestBatch`, in quest'ordine:
1. `Content-Length` oltre 512 KB → 413 "Lotto troppo grande" (prima di leggere il corpo, nella rotta).
2. Almeno 30 lotti di questo dispositivo nell'ultimo minuto (`batches`) → 429 "Troppi invii: riprova fra poco".
3. `batches.id` già presente → 200 senza fare nulla.
4. Giro inesistente o di un altro utente → 404 "Giro non trovato"; `searchKey` senza riga in quel giro → 400 "Ricerca non nel piano"; un'osservazione di un portale diverso da quello della ricerca → 400 "Annuncio di un altro portale". Un giro già chiuso accetta ancora lotti: la coda del connettore può consegnarli fino a 24 ore dopo.
5. `at = min(max(batch.readAt, sweep.started_at), now)`.
6. Legge gli annunci già salvati delle chiavi del lotto, l'ultimo prezzo di ciascuno e i punti di calibrazione del portale; calcola `mergeObservation` per le osservazioni con `acceptObservation(spec, o)`; `null` (lettura più vecchia dell'archivio) non scrive nulla per quell'annuncio.
7. Un solo `db.batch`: upsert degli annunci, snapshot, punti di calibrazione da `portalCreatedAt` e da `learnedPoint({ portal, portalId: newestId }, points, at)` se `newestId` c'è, `run_seen` per **tutte** le osservazioni del lotto (anche quelle scartate dalla categoria: sono ancora online), sulla ricerca `pages_received + 1`, `privates + report.privates`, `status = 'running'` e `started_at = at` se era `pending`, sul giro `last_activity_at = now` e `drops + ` numero di `dropped`, e l'`INSERT` in `batches` con la pulizia delle righe oltre 48 ore. Se l'`INSERT` in `batches` fallisce per chiave duplicata (due copie in parallelo) l'intero batch si annulla e la risposta è 200.
8. `maybeApplyMissing(db, run.id, now)`.

- [ ] **Step 1: Test**:
  - un lotto nuovo salva gli annunci (privati, categoria della ricerca) con `sweepScope = searchKey` e i loro snapshot; la ricerca diventa `running` con `pages_received: 1`;
  - un'osservazione di categoria non scelta non si salva ma finisce in `run_seen`;
  - lo stesso lotto due volte, in sequenza e con `Promise.all` → un solo snapshot per annuncio, `seenCount` invariato, `drops` contato una volta, entrambe le risposte 200;
  - ribasso: un annuncio salvato a 200 000 € letto a 180 000 € → `sweeps.drops` = 1;
  - lotto in ritardo: annuncio salvato con `lastSeenAt` = T, lotto con `readAt` = T − 1 ora e prezzo diverso → prezzo e `lastSeenAt` invariati, nessuno snapshot nuovo, chiave in `run_seen`;
  - lotto per un giro chiuso → salvato;
  - lotto di un giro di un altro agente → 404; `searchKey` estranea → 400; osservazione con `sellerType: 'agency'` o con `phone` → 400 e niente salvato;
  - 101 osservazioni → 400; 31° lotto nello stesso minuto → 429;
  - `newestId` su Idealista coerente con la calibrazione → nuovo punto in `calibration_points`.
- [ ] **Step 2: Verifica che falliscano** — FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Verifica** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): ingest dei lotti del connettore"`

---

### Task 9: Esiti, "non più visto", fine del giro e avanzamento

**Files:**
- Modify: `apps/server/src/sweeps.ts`, `apps/server/src/ingest.ts`, `apps/server/src/routes/connector.ts`, `apps/server/src/routes/leads.ts`
- Test: `apps/server/test/runs.test.ts`

**Interfaces:**
- Consumes: `RunBody`, `FinishBody` (Task 2); `agentLeads` (Task 5); `seenSince`, `PORTAL_TAGS`, `MISSING_SWEEPS`; tipi `SweepResult`, `SweepProgress`, `SweepStatus` di `shared/types.ts`.
- Produces:
  - `reportRun(db, user, r: RunReport, now): Promise<Response>` → rotta `POST /connector/runs` → 200 `{ ok: true }`;
  - `maybeApplyMissing(db, runId, now)` completo;
  - `finishSweep(db, sweepId: string, outcome: SweepOutcome, now): Promise<SweepResult>` → rotta `POST /connector/sweeps/:id/finish` → 200 `{ result }` (un giro già chiuso restituisce il risultato salvato);
  - `sweepStatus(db, user, now): Promise<SweepStatus>` → rotta `GET /api/sweep`.

Regole:
- `reportRun` aggiorna `status`, `pages`, `privates`, `finished_at = now` solo se la ricerca è `pending`, `running` o `skipped` (un esito ripetuto non cambia nulla); aggiorna `last_activity_at` del giro; poi `maybeApplyMissing`.
- `maybeApplyMissing`: solo se `status = 'complete'`, `missing_applied = 0` e `pages_received >= pages`. Un'unica `UPDATE listings SET missed_sweeps = missed_sweeps + 1, missing_since = COALESCE(missing_since, run.started_at) WHERE sweep_scope = run.search_key AND key NOT IN (run_seen della ricerca) AND last_seen_at < run.started_at RETURNING missed_sweeps`; quelle arrivate a `MISSING_SWEEPS` si sommano a `sweeps.missing`; poi `missing_applied = 1` e si cancellano le sue righe di `run_seen`. La condizione su `last_seen_at` protegge gli annunci visti da un altro agente dopo l'inizio di questa ricerca. Il limite delle 24 ore non si applica qui: lo applica `isMissing(l, now)` alla lettura.
- `finishSweep`: ricerche ancora `pending` o `running` → `skipped`; `SweepResult` con `portals` (pagine ricevute, privati ed esito per portale: `blocked` se una è bloccata, poi `error`, `capped`, `skipped`, altrimenti `complete`), `notFound` come `"<label> (<PORTAL_TAGS>)"`, `drops` e `missing` dal giro, `newCount` = lead di `agentLeads` con stato nuovo e `seenSince(v, started_at)` (se l'utente è stato cancellato, 0); salvato in `sweeps.result`.
- `sweepStatus`: chiude i giri scaduti dell'utente; `running` = il suo giro aperto come `SweepProgress` (`total` righe, `done` quelle non `pending`/`running`, `current` = label della `running` più recente, pagine ricevute e privati per portale, `drops`, `newCount` = annunci della sua zona e categorie con `first_seen_at >= started_at`, conteggio SQL senza costruire i lead); `last` = `result` dell'ultimo giro chiuso. Mai dati di giri di altri.

- [ ] **Step 1: Test**:
  - tre giri completi (di A, B, A) senza l'annuncio X della ricerca, X visto l'ultima volta 30 ore prima → `missed_sweeps: 3` e X "non più visto" in `GET /api/leads` (`missing` non null); stessi tre giri con X visto 2 ore prima → `missed_sweeps: 3` ma `missing: null`;
  - una ricerca `capped` o `error` non tocca `missed_sweeps`;
  - esito `complete` con `pages: 2` dopo un solo lotto → nessun aggiornamento; arrivato il secondo lotto (che contiene X) → X non incrementato, gli altri sì;
  - X visto dalla ricerca di B iniziata dopo quella di A → non incrementato dal completamento di A;
  - esito ripetuto → `missed_sweeps` incrementato una volta sola;
  - `finish` con una ricerca ancora `pending` → diventa `skipped`, risultato con l'esito per portale, `notFound` con l'etichetta, `newCount` dei lead nuovi del giro; secondo `finish` → stesso risultato;
  - `GET /api/sweep` durante il giro → `running` con `done`/`total`; dopo → `running: null` e `last` col risultato; B non vede il giro di A; giro di A fermo da 16 minuti → `GET /api/sweep` di A lo dà interrotto in `last`.
- [ ] **Step 2: Verifica che falliscano** — FAIL.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Verifica** — `npm test` e `npm run typecheck` dalla radice, PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): esiti delle ricerche, \"non più visto\" con più agenti e avanzamento del giro"`

---

### Task 10: Documentazione

**Files:**
- Modify: `CLAUDE.md`, `docs/roadmap.md`

- [ ] **Step 1:** `CLAUDE.md`, sezione Struttura: i moduli nuovi di `apps/server/src` (`archive.ts`, `device.ts`, `settings.ts`, `leads.ts`, `sweeps.ts`, `ingest.ts`, `routes/connector.ts`, `routes/leads.ts`), il fatto che `/connector/*` usa il token di dispositivo e non controlla l'`Origin`, e la regola delle liste con `json_each`.
- [ ] **Step 2:** `docs/roadmap.md`: tappa 2 con stato "fatto"; nella tappa 6 aggiungi che l'informativa dovrà dire: archivio condiviso degli annunci di privati, note e stati privati dell'agente cancellati con l'account, `search_runs` anonimizzati alla cancellazione.
- [ ] **Step 3: Verifica finale**

Run: `npm test`, `npm run typecheck`, `npm run build`
Expected: tutto verde.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/roadmap.md
git commit -m "docs: tappa 2 completata"
```
