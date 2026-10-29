# «Online al massimo» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nuova impostazione «Online al massimo (giorni)». Oltre il massimo un immobile esce dalla lista. Rientra con priorità Media, e come lead nuovo, se ha cambiato prezzo negli ultimi 30 giorni.

**Architecture:** la regola sta tutta in `packages/shared/src/core/rules.ts`:
- `priceChanges` ricava i cambi di prezzo dagli snapshot;
- `evaluate` ed `evaluateGroup` applicano il massimo e scrivono `returnedAt` nell'`Evaluation`;
- `isNewLead` (`core/lead-groups.ts`) considera nuovo anche un lead con `returnedAt` successivo alla visita.

Il server salva `maxAgeDays` in `user_settings` e lo passa a `buildLeadViews`. Il portale aggiunge un campo nelle impostazioni.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers + D1, React.

**Spec:** `docs/superpowers/specs/2026-10-28-online-al-massimo-design.md`

## Global Constraints

- `maxAgeDays: number | null`, `null` = nessun limite. Intero tra 1 e 3650, maggiore di `minAgeDays`.
- Errore se non è maggiore del minimo: `Online al massimo deve essere più del minimo`. Valore fuori intervallo: `Soglia massima non valida`.
- Finestra del cambio recente: `RECENT_CHANGE_DAYS = 30`.
- «Oltre il massimo» vuol dire `ageDays > maxAgeDays`.
- Senza `maxAgeDays` (null o assente) ogni valutazione resta identica a oggi: i test esistenti di `rules.test.ts` e `lead-groups.test.ts` passano senza modifiche.
- Migrazione nuova `apps/server/migrations/0007_max_age.sql`; non si toccano quelle esistenti.
- Niente cambi al connettore né a `PRIVACY_VERSION`.
- Timestamp in ms epoch UTC; testi in italiano.

## Review Focus

- Ribasso dichiarato dal portale dopo un prezzo già osservato (100 osservato, poi dichiarato 130→100): non deve diventare un rialzo. Test in Task 1.
- Stesso ribasso prima osservato e poi dichiarato: un solo cambio, con la data dichiarata. Test in Task 1.
- Ribasso dichiarato vecchio (oltre 30 giorni) visto alla prima osservazione di un annuncio oltre il massimo: resta nascosto. Test in Task 1.
- Ripubblicazione di un immobile oltre il massimo: il gruppo resta oltre il massimo, e il ribasso storico della catena non lo tiene in lista. Test in Task 1.
- Lead già lavorato (stato o richiamo) oltre il massimo che cambia prezzo: resta in lista e non è «nuovo». Test in Task 2.

---

### Task 1: regole con il massimo e i cambi di prezzo recenti

**Files:**
- Modify: `packages/shared/src/core/rules.ts`
- Modify: `packages/shared/src/shared/types.ts` (`Evaluation`)
- Test: `packages/shared/tests/unit/core/rules.test.ts`

**Interfaces:**
- Produces:
  - `export const RECENT_CHANGE_DAYS = 30`
  - `export interface PriceChange { from: number; to: number; /** data vera: dichiarata se c'è */ date: number; /** quando HomeRadar l'ha saputo */ knownAt: number }`
  - `export function priceChanges(snapshots: PriceSnapshot[]): PriceChange[]`, in ordine di `knownAt`
  - `RuleSettings = Pick<Settings, 'minAgeDays' | 'minDropPercent'> & { maxAgeDays?: number | null }`
  - in `Evaluation`: `returnedAt: number | null`, cioè il `knownAt` del cambio che fa rientrare un immobile oltre il massimo. È `null` se l'immobile non è oltre il massimo o non rientra.

- [ ] **Step 1: test che falliscono** (nel `describe('priceChanges')` e in un `describe('online al massimo')`; `MAX = { ...DEFAULT_SETTINGS, maxAgeDays: 365 }`; `snap` come nel file)
  - `priceChanges`, solo osservati: 100@t1, 100@t2, 110@t3 → `[{ from: 100, to: 110, date: t3, knownAt: t3 }]`. Il primo snapshot non è un cambio.
  - `priceChanges`, falso rialzo: `observed 100@t0`, `declared 130@d-1`, `declared 100@d`, con d > t0 → `[]`.
  - `priceChanges`, osservato poi dichiarato: `observed 120@t0`, `observed 100@t1`, `declared 120@d-1`, `declared 100@d` (t0 < d ≤ t1) → `[{ from: 120, to: 100, date: d, knownAt: t1 }]`.
  - `priceChanges`, ribasso dichiarato alla prima osservazione: `declared 120@d-1`, `declared 100@d`, `observed 100@t1` (d ≤ t1) → `[{ from: 120, to: 100, date: d, knownAt: t1 }]`.
  - Senza `maxAgeDays` non cambia niente: `portalCreatedAt: daysAgo(5000)` → `priority 'medium'`, `returnedAt null`.
  - Oltre il massimo senza cambi: `portalCreatedAt: daysAgo(400)`, impostazioni `MAX` → `priority 'none'`.
  - Dentro l'intervallo: `daysAgo(200)`, `MAX` → `'medium'`, come oggi.
  - Oltre il massimo, rialzo di qualsiasi importo da 10 giorni (`observed 235000@daysAgo(20)`, `236000@daysAgo(10)`) → `priority 'medium'`, `returnedAt === daysAgo(10)`. Tra i `reasons` c'è una voce che inizia con `Prezzo alzato del`, e il badge contiene `+0,4%`.
  - Oltre il massimo, rialzo da 31 giorni → `'none'`, `returnedAt null`.
  - Oltre il massimo, ribasso recente sotto la soglia (`minDropPercent: 10`, ribasso del 5%) → `'none'`. Con ribasso recente sopra la soglia → `'medium'`, mai `'high'`.
  - Oltre il massimo, ribasso storico di 2 anni con `lastDrop` impostato → `'none'`: il segnale B storico non conta.
  - Oltre il massimo, ribasso dichiarato con data di 40 giorni fa, visto alla prima osservazione 1 giorno fa → `'none'`.
  - `evaluateGroup`: testa giovane (20 giorni, `previous` assente) + annuncio precedente di 400 giorni (`previous: true`) con prezzo storico più alto → `'none'`. Con un rialzo osservato 5 giorni fa sulla testa → `'medium'`, e `returnedAt` = data di quello snapshot.
  - `evaluateGroup`: due membri vivi oltre il massimo con cambi recenti in momenti diversi → `returnedAt` = il `knownAt` più recente.

- [ ] **Step 2: verifica che falliscano**

Run: `npm test -w packages/shared -- rules`
Expected: FAIL (`priceChanges` non esiste, `returnedAt` assente)

- [ ] **Step 3: implementa**
  - `priceChanges`:
    - si ordinano gli snapshot per `at`;
    - si scorrono gli `observed`: ogni `observed` con prezzo diverso dal precedente `observed` è un cambio, con `knownAt` = la sua data;
    - `date` = la data del `declared` con `price === to` più recente tra `at` del precedente `observed` (escluso) e `knownAt` (incluso); se non c'è, `knownAt`;
    - per il **primo** `observed`: se esiste un `declared` con `price === observed.price` e `at ≤ observed.at`, e subito prima un `declared` (`at - 1`) con prezzo diverso, è un cambio `{ from: quel prezzo, to, date: at del declared, knownAt: observed.at }`.
  - In `evaluate` ed `evaluateGroup`:
    - `pastMax = maxAgeDays != null && age.ageDays != null && age.ageDays > maxAgeDays`. Nel gruppo, l'età è quella del membro più vecchio, compresi gli annunci precedenti, prima della scelta del `pool`.
    - Se è `pastMax`: segnali A e B falsi.
    - Il cambio che fa rientrare è l'ultimo cambio (dei membri non `previous`, sui loro `prices`, che per una testa di catena contengono tutta la catena) con `date ≥ now - RECENT_CHANGE_DAYS * DAY_MS` e con `to > from`, oppure con ribasso `(from - to) / from * 100 ≥ minDropPercent` e `> 0`.
    - Se c'è: priorità `'medium'` e `returnedAt = knownAt`; altrimenti `'none'`.
  - In `compose` aggiungi `returnedAt` e il motivo del cambio:
    - rialzo: `Prezzo alzato del X% (a → b €) il dd/mm`;
    - ribasso: `Ribassato del X% (a → b €) il dd/mm`, con `formatPercent`/`formatEuro`/`formatDayMonth`;
    - parte del badge: `+X%` o `−X%`.

  Aggiorna tutti i letterali `Evaluation` che `npm run typecheck` segnala nei test e nelle fixture, aggiungendo `returnedAt: null`.

- [ ] **Step 4: verifica che passino**

Run: `npm test -w packages/shared && npm run typecheck`
Expected: PASS, compresi i test esistenti senza modifiche

- [ ] **Step 5: commit** `feat(shared): online al massimo e rientro per cambio di prezzo recente`

### Task 2: il rientro è un lead nuovo

**Files:**
- Modify: `packages/shared/src/core/lead-groups.ts` (`isNewLead`)
- Test: `packages/shared/tests/unit/core/lead-groups.test.ts`

**Interfaces:**
- Consumes: `Evaluation.returnedAt` (Task 1)
- Produces: `isNewLead(v: LeadView, since: number | null): boolean`, con la stessa firma

- [ ] **Step 1: test che falliscono** (in `describe('isNewLead')`; la `view` del file si estende con `evaluation` e `state`)
  - Gruppo visto prima di `since`, con `returnedAt: T + 5` e stato `new` senza richiamo → `true`.
  - Stesso caso con `returnedAt: T - 1` → `false`.
  - Stesso caso con `returnedAt: T + 5` ma stato `contacted` (o `recallAt` impostato) → `false`.
  - `since: null` → `false`.
  - Con `buildLeadViews`: un annuncio con `portalCreatedAt` di 400 giorni fa, `maxAgeDays: 365`, stato `contacted` e senza cambi → `isListed` è `true`. Lo stesso annuncio con stato di default → `isListed` è `false`.

- [ ] **Step 2: verifica che falliscano**

Run: `npm test -w packages/shared -- lead-groups`
Expected: FAIL sul primo caso

- [ ] **Step 3: implementa**

`isNewLead` è vero se `since != null` e vale una di queste:
- la regola di oggi;
- `returnedAt != null && returnedAt >= since && state.status === 'new' && state.recallAt == null`.

Aggiorna il commento della funzione.

- [ ] **Step 4: verifica che passino**

Run: `npm test -w packages/shared`
Expected: PASS

- [ ] **Step 5: commit** `feat(shared): un lead rientrato per cambio di prezzo è nuovo`

### Task 3: impostazione salvata dal server

**Files:**
- Create: `apps/server/migrations/0007_max_age.sql` (`ALTER TABLE user_settings ADD COLUMN max_age_days INTEGER;`, con commento `-- NULL = nessun limite`)
- Modify: `packages/shared/src/api/types.ts` (`AgentSettings`, `DEFAULT_AGENT_SETTINGS`, `AgentSettingsBody`)
- Modify: `apps/server/src/settings.ts`
- Test: `apps/server/test/settings.test.ts`, `packages/shared/tests/unit/api/types.test.ts`, più un caso in un test dei lead del server (`apps/server/test/leads.test.ts` o quello che contiene `agentLeads`)

**Interfaces:**
- Consumes: `RuleSettings.maxAgeDays` (Task 1)
- Produces: `AgentSettings.maxAgeDays: number | null`, default `null`; `PUT /api/settings` accetta `maxAgeDays: number | null`

- [ ] **Step 1: test che falliscono**
  - Server: GET di default → `maxAgeDays: null`.
  - Server: PUT `{ maxAgeDays: 730 }` → 200, la lettura successiva dà `730`, il resto non cambia.
  - Server: PUT `{ maxAgeDays: null }` → torna a `null`.
  - Server: PUT `{ maxAgeDays: 100 }` con minimo 120 → 400 `{ error: 'Online al massimo deve essere più del minimo' }`.
  - Server: PUT `{ minAgeDays: 800 }` con massimo 730 → stesso errore.
  - Schema (`types.test.ts`): `0`, `3651` e `1.5` → `Soglia massima non valida`.
  - Lead: un annuncio di 400 giorni senza cambi c'è in `GET /api/leads` senza massimo e sparisce con `maxAgeDays: 365`.

- [ ] **Step 2: verifica che falliscano**

Run: `npm test -w apps/server -- settings` e `npm test -w packages/shared -- types`
Expected: FAIL

- [ ] **Step 3: implementa**
  - Schema: `maxAgeDays: z.number(MAX_AGE_ERROR).int(MAX_AGE_ERROR).min(1, MAX_AGE_ERROR).max(3650, MAX_AGE_ERROR).nullable().optional()`.
  - `getSettings` legge `max_age_days`.
  - `saveSettings`:
    - prima di scrivere: se `s.maxAgeDays != null && s.maxAgeDays <= s.minAgeDays`, restituisce il messaggio;
    - aggiunge la colonna a INSERT e UPDATE.
  - `agentLeads` passa già `settings` a `buildLeadViews`, quindi non serve altro.

- [ ] **Step 4: verifica che passino**

Run: `npm test -w apps/server && npm test -w packages/shared && npm run typecheck`
Expected: PASS

- [ ] **Step 5: commit** `feat(server): impostazione online al massimo`

### Task 4: campo nelle impostazioni del portale, roadmap e documenti

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`
- Test: `apps/web/test/settings.test.tsx`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: `AgentSettings.maxAgeDays` (Task 3), `RECENT_CHANGE_DAYS` (Task 1)

- [ ] **Step 1: test che falliscono**
  - Il campo `Online al massimo (giorni)` è vuoto quando il server dà `null`.
  - Scrivere `730` e salvare → PUT con body `{ maxAgeDays: 730 }`.
  - Svuotare un valore salvato (`730`) e salvare → PUT `{ maxAgeDays: null }`: vuoto non è un errore, a differenza di «Online da almeno».
  - Errore del server mostrato com'è (`Online al massimo deve essere più del minimo`).

- [ ] **Step 2: verifica che falliscano**

Run: `npm test -w apps/web -- settings`
Expected: FAIL

- [ ] **Step 3: implementa**
  - Riga sotto «Online da almeno», con `<input type="number" min={1} max={3650} step={1}>`. Il valore è `''` se `null`. `onChange`: `valueAsNumber` NaN → `null`.
  - `changes()` confronta `maxAgeDays`.
  - `InfoTip` con `MAX_AGE_HELP`: «Gli annunci online da più di questi giorni non sono lead: chi vende da anni senza risultati difficilmente risponde. Tornano in lista, come nuovi, se cambiano prezzo: per {RECENT_CHANGE_DAYS} giorni dopo un rialzo o un ribasso di almeno la percentuale qui sotto. Vuoto = nessun limite.»

  Roadmap: riga `6d | Online al massimo (riscontro del tester): …`, con spec e piano, stato `fatto` a fine lavoro.

- [ ] **Step 4: verifica tutto**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 5: commit** `feat(web): campo online al massimo nelle impostazioni`
