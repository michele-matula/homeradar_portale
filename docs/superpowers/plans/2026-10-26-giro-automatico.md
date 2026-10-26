# Giro automatico: piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il connettore fa il giro da solo quando Chrome è aperto, l'agente usa il PC e il server dice che è dovuto (una volta al giorno o ogni N ore); i lead sono «nuovi» dall'ultima volta che l'agente ha guardato la lista.

**Architecture:** La regola «dovuto» è una funzione pura condivisa (`core/auto-sweep.ts`) usata da `startSweep` quando il connettore chiede `{ auto: true }`. Il connettore ha un modulo nuovo (`auto.ts`) che decide quando chiedere, a dipendenze iniettate come `runner.ts`. `background.ts` lo collega ad allarmi, `idle` e notifiche. Il portale aggiunge il riquadro nelle impostazioni, l'etichetta «automatico» sui giri e la soglia del «nuovo» per visita (`POST /api/leads/visit`).

**Tech Stack:** TypeScript, zod, Cloudflare Worker + D1 (vitest-pool-workers), WXT MV3, React 19 + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-26-giro-automatico-design.md`

## Global Constraints

- Testi in italiano. Errori delle API come `{ "error": "<messaggio>" }`.
- Timestamp in ms epoch UTC; giorni e fasce sull'ora di Roma (`core/recall`).
- Migrazione nuova `apps/server/migrations/0006_auto_sweep.sql`; le esistenti non si toccano.
- Fascia del giro automatico: dalle **7:00** alle **21:00** di Roma. Frequenze: `null` (una volta al giorno, default) oppure **3, 4, 6, 8** ore. Giro automatico **spento** di default.
- Freno: nessun giro automatico se uno automatico è iniziato **meno di 60 minuti** fa. Giro automatico spento: `nextCheckAt` = adesso + **60 minuti**.
- Contano i giri `completed`, `partial`, `stopped` e quelli aperti; `interrupted` no.
- Portali con una ricerca `blocked` dell'agente nelle ultime **24 ore**: fuori dal piano dei giri automatici, mai da quello manuale.
- Connettore: allarme `auto` ogni **15 minuti**, primo controllo **2 minuti** dopo l'avvio del browser, `idle.queryState(300) === 'active'`. Tempi di prova solo con `WXT_SWEEP_FAST=1` in `timing.ts`.
- Visita della lista: inizia se `leads_seen_at` è più vecchio di **30 minuti**.
- `PRIVACY_VERSION` = 2, senza nuova accettazione per chi ha già un account.

## Review Focus

- Giorno del cambio d'ora (2026-10-25, 2026-03-29): «le 7:00 di Roma» deve restare 7:00 locali, non 6 o 8. Test in Task 1.
- Scheda del portale lasciata aperta dalla sera alla mattina: tornando visibile deve iniziare una visita nuova, quindi i lead della notte risultano nuovi. Test in Task 4.
- Agente che spegne il giro automatico mentre un giro automatico sta girando: il giro in corso finisce normalmente, il successivo non parte. Test in Task 1 (`enabled: false`) e Task 6 (nessun avvio con risposta `notDue`).
- Giri salvati prima di questa tappa (`SweepResult` senza `auto`): la riga dell'ultimo giro non deve dire «automatico» né rompersi. Test in Task 5.
- Due computer dello stesso agente: il secondo riceve 409 e il connettore non mostra errori né notifiche, e riprova al prossimo allarme. Test in Task 3 (409 con `auto`) e Task 6 (errore → `nextCheckAt` = adesso + 15 min, nessuna segnalazione).

---

### Task 1: Regola condivisa del giro automatico

**Files:**
- Modify: `packages/shared/src/core/recall.ts` (accanto a `startOfLocalDay`)
- Create: `packages/shared/src/core/auto-sweep.ts`
- Test: `packages/shared/tests/unit/core/recall.test.ts`, `packages/shared/tests/unit/core/auto-sweep.test.ts`

**Interfaces:**
- Produces:
  - `atRomeHour(ms: number, hour: number): number`: ms dell'ora `hour`:00 di Roma, nello stesso giorno di Roma di `ms`.
  - `AUTO_SWEEP_HOURS = [3, 4, 6, 8] as const`, `type AutoSweepHours = (typeof AUTO_SWEEP_HOURS)[number]`
  - `AUTO_FROM_HOUR = 7`, `AUTO_TO_HOUR = 21`, `AUTO_RETRY_MS = 3_600_000`, `AUTO_OFF_RECHECK_MS = 3_600_000`
  - `interface AutoSweepRow { startedAt: number; outcome: SweepOutcome | null; auto: boolean }` (`outcome` null = aperto)
  - `type AutoDecision = { due: true } | { due: false; nextCheckAt: number }`
  - `autoSweepDecision(s: { enabled: boolean; hours: AutoSweepHours | null }, sweeps: AutoSweepRow[], now: number): AutoDecision`
  - `nextAfterSweep(hours: AutoSweepHours | null, startedAt: number): number`: primo istante dovuto dopo un giro che conta iniziato a `startedAt`, già riportato dentro la fascia.

- [ ] **Step 1: Test che falliscono.** `recall.test.ts`: `atRomeHour` restituisce 7:00 locali anche il 2026-10-25 e il 2026-03-29 (controllalo con `new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric' })`). `auto-sweep.test.ts`, con `T(h, m = 0, day = 26)` = ottobre 2026 all'ora di Roma:

```ts
it('spento: non dovuto, si ricontrolla fra un\'ora', () =>
  expect(autoSweepDecision({ enabled: false, hours: null }, [], T(9))).toEqual({ due: false, nextCheckAt: T(10) }));
it('prima delle 7: alle 7; dopo le 21: domani alle 7', () => {
  expect(autoSweepDecision(ON, [], T(6, 30))).toEqual({ due: false, nextCheckAt: T(7) });
  expect(autoSweepDecision(ON, [], T(21, 5))).toEqual({ due: false, nextCheckAt: T(7, 0, 27) });
});
it('una volta al giorno: dovuto se oggi nessun giro conta', () => {
  expect(autoSweepDecision(ON, [row(T(20, 0, 25), 'completed')], T(8))).toEqual({ due: true });
  expect(autoSweepDecision(ON, [row(T(7, 30), 'partial')], T(8))).toEqual({ due: false, nextCheckAt: T(7, 0, 27) });
});
it('un giro interrotto non conta, ma il freno di un\'ora vale per gli automatici', () => {
  expect(autoSweepDecision(ON, [row(T(7, 30), 'interrupted', false)], T(8))).toEqual({ due: true });
  expect(autoSweepDecision(ON, [row(T(7, 30), 'interrupted', true)], T(8))).toEqual({ due: false, nextCheckAt: T(8, 30) });
});
it('ogni 4 ore: dovuto 4 ore dopo l\'ultimo giro che conta; aperto conta', () => {
  expect(autoSweepDecision(EVERY4, [row(T(8), 'stopped')], T(11))).toEqual({ due: false, nextCheckAt: T(12) });
  expect(autoSweepDecision(EVERY4, [row(T(8), 'completed')], T(12))).toEqual({ due: true });
  expect(autoSweepDecision(EVERY4, [row(T(10), null)], T(11))).toEqual({ due: false, nextCheckAt: T(14) });
});
it('soglia oltre le 21: domani alle 7', () =>
  expect(autoSweepDecision(EVERY4, [row(T(18), 'completed')], T(19))).toEqual({ due: false, nextCheckAt: T(7, 0, 27) }));
it('nextAfterSweep', () => {
  expect(nextAfterSweep(null, T(9))).toBe(T(7, 0, 27));
  expect(nextAfterSweep(6, T(9))).toBe(T(15));
});
```

- [ ] **Step 2:** `npm test -w packages/shared`: i nuovi test falliscono (funzioni mancanti).
- [ ] **Step 3: Implementa.** `atRomeHour` in `recall.ts`, con lo stesso metodo a due passi di `romeMidnight`. `auto-sweep.ts`: `nextCheckAt` è il massimo dei vincoli attivi (soglia dell'ultimo giro che conta, fine del freno, inizio della fascia), riportato dentro la fascia. Con «una volta al giorno» la soglia è le 7:00 di domani.
- [ ] **Step 4:** `npm test -w packages/shared` e `npm run typecheck`: verdi.
- [ ] **Step 5: Commit** `feat(shared): regola del giro automatico`.

### Task 2: Impostazioni del giro automatico e migrazione

**Files:**
- Create: `apps/server/migrations/0006_auto_sweep.sql`
- Modify: `packages/shared/src/api/types.ts` (`AgentSettings`, `DEFAULT_AGENT_SETTINGS`, `AgentSettingsBody`), `apps/server/src/settings.ts`
- Test: `apps/server/test/settings.test.ts`

**Interfaces:**
- Consumes: `AUTO_SWEEP_HOURS`, `AutoSweepHours` (Task 1).
- Produces: `AgentSettings.autoSweep: boolean`, `AgentSettings.autoSweepHours: AutoSweepHours | null` (default `false`, `null`). Colonne `user_settings.auto_sweep INTEGER NOT NULL DEFAULT 0`, `user_settings.auto_sweep_hours INTEGER`, `sweeps.trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','auto'))`, `users.leads_seen_at INTEGER`, `users.new_since INTEGER`.

- [ ] **Step 1: Test che falliscono** in `settings.test.ts`: GET senza salvataggi → `autoSweep: false, autoSweepHours: null`. PUT `{ autoSweep: true, autoSweepHours: 4 }` → si rilegge uguale e le altre impostazioni non cambiano. PUT `{ autoSweepHours: 2 }` → 400 `{ error: 'Frequenza del giro automatico non valida' }`. PUT `{ autoSweepHours: null }` → torna «una volta al giorno».
- [ ] **Step 2:** `npm test -w apps/server -- settings`: falliscono.
- [ ] **Step 3: Implementa:** la migrazione con le cinque colonne, i campi nello schema zod (`z.union` dei letterali di `AUTO_SWEEP_HOURS`, `.nullable().optional()`), e `getSettings`/`saveSettings` che leggono e scrivono le due colonne.
- [ ] **Step 4:** `npm test -w apps/server` e `npm run typecheck`: verdi (correggi le fixture web che costruiscono `AgentSettings` a mano).
- [ ] **Step 5: Commit** `feat(server): impostazioni del giro automatico`.

### Task 3: `startSweep` con `auto`, portali bloccati e giro segnato

**Files:**
- Modify: `packages/shared/src/api/connector.ts` (`StartSweepBody`, `SweepPlan`), `packages/shared/src/shared/types.ts` (`SweepProgress`, `SweepResult`), `packages/shared/src/api/types.ts` (`ControlSweep`), `apps/server/src/sweeps.ts`, `apps/server/src/routes/connector.ts`, `apps/server/src/control.ts`
- Test: `apps/server/test/plan.test.ts`, `apps/server/test/runs.test.ts`, `apps/server/test/control.test.ts`

**Interfaces:**
- Consumes: `autoSweepDecision`, `nextAfterSweep` (Task 1); `getSettings` con `autoSweep` (Task 2).
- Produces:
  - `StartSweepBody = body({ auto: z.boolean(...).optional() })`
  - `SweepPlan` aggiunge `notDue?: true; nextCheckAt?: number`
  - `startSweep(db, user, deviceId, now, auto = false)`
  - `SweepProgress.auto: boolean`, `SweepResult.auto?: boolean` (opzionale: i risultati vecchi non l'hanno), `ControlSweep.auto: boolean`

- [ ] **Step 1: Test che falliscono** in `plan.test.ts`, con un helper che attiva il giro automatico via `PUT /api/settings`. Perché il test non dipenda dall'ora in cui gira, i casi con `auto` chiamano `startSweep(env.DB, user, deviceId, NOW, true)` da `../src/sweeps`, con `NOW` fisso alle 10:00 di Roma di un giorno qualsiasi, e inseriscono i giri passati relativi a `NOW`. Uno solo passa da HTTP (`POST /connector/sweeps` con `{ auto: true }` e giro spento → 200 `notDue`), per provare lo schema.
  - `{ auto: true }` con il giro automatico spento → 200, `{ sweepId: null, notDue: true }`, `nextCheckAt` > adesso, nessuna riga in `sweeps`.
  - `{ auto: true }` dovuto → 201, la riga ha `trigger = 'auto'`.
  - `{ auto: true }` subito dopo un giro `completed` di oggi (una volta al giorno) → `notDue`.
  - `{ auto: true }` con una ricerca `blocked` di Idealista dell'agente 2 ore fa → nessuna ricerca idealista nel piano. `{}` (manuale) nello stesso stato → idealista nel piano.
  - `{ auto: true }` con tutte le ricerche fresche → 200, `notDue: true`, `nextCheckAt === nextAfterSweep(hours, now)` (± tolleranza del test).
  - `{ auto: true }` con un giro aperto su un altro dispositivo → 409.
  - `{}` senza `auto` si comporta come oggi, con il giro automatico acceso o spento.
  - In `runs.test.ts`: `GET /api/sweep` di un giro automatico → `running.auto === true`, poi `last.auto === true`. In `control.test.ts`: `ControlSweep.auto`.
- [ ] **Step 2:** `npm test -w apps/server`: falliscono.
- [ ] **Step 3: Implementa.** Con `auto`, prima di tutto il resto, `startSweep` legge i giri dell'agente da `min(startOfLocalDay(now), now - 8 h)` in poi. `auto` si ricava da `trigger`. Poi chiama `autoSweepDecision`: se il giro non è dovuto risponde 200 con `notDue`. Se è dovuto, filtra i portali bloccati nelle 24 ore (`search_runs.user_id`, `status = 'blocked'`, `finished_at`). Se il piano resta vuoto, risponde `notDue` con `nextAfterSweep`. Altrimenti `INSERT` con `trigger`. `progress` e `finishSweep` passano `auto: s.trigger === 'auto'`, e la query di `control.ts` legge `s.trigger`.
- [ ] **Step 4:** `npm test -w apps/server`, `npm run typecheck`: verdi.
- [ ] **Step 5: Commit** `feat(server): giro automatico in startSweep`.

### Task 4: Lead nuovi dall'ultima visita

**Files:**
- Modify: `apps/server/src/leads.ts`, `apps/server/src/routes/leads.ts`, `packages/shared/src/api/types.ts`, `packages/shared/src/core/lead-groups.ts` (solo commento di `isNewLead`), `apps/web/src/pages/Leads.tsx`, `apps/web/src/leads/filters.ts` (commenti)
- Test: `apps/server/test/leads.test.ts`, `apps/web/test/leads.test.tsx`

**Interfaces:**
- Consumes: colonne `users.leads_seen_at`, `users.new_since` (Task 2).
- Produces: `POST /api/leads/visit` → `{ newSince: number | null }` (`LeadsVisit` in `api/types.ts`); `leadsVisit(db: D1Database, userId: string, now: number): Promise<number | null>` in `leads.ts`; `VISIT_GAP_MS = 30 * 60_000`.

- [ ] **Step 1: Test che falliscono.**
  - Server: prima visita → `newSince: null`. Visita a +10 min → ancora null, e `leads_seen_at` aggiornato. Visita a +45 min dall'ultima → `newSince` = la `leads_seen_at` precedente. Un'altra a +5 min → stessa `newSince`. Imposta `leads_seen_at` direttamente in D1 per simulare il tempo.
  - Web (`leads.test.tsx`, `mockApi`): con `/api/leads/visit` → `{ newSince: X }`, i lead con `firstSeenAt >= X` hanno il segno «nuovo», anche se `/api/sweep` dice che l'ultimo giro è iniziato dopo X. Con `newSince: null` vale l'inizio dell'ultimo giro, come oggi. Un `visibilitychange` verso `visible` richiama `/api/leads/visit`.
- [ ] **Step 2:** `npm test -w apps/server -- leads` e `npm test -w apps/web -- leads`: falliscono.
- [ ] **Step 3: Implementa.** `leadsVisit` legge e aggiorna con un solo `UPDATE … RETURNING`, oppure con una lettura e un `UPDATE`. La rotta è un `userRoute('POST', '/api/leads/visit', …)`. `Leads.tsx` chiama la visita al montaggio (con zona) e a ogni ritorno visibile della pagina (`document.visibilityState`). `newSince = visitSince ?? sweepSince`, dove `sweepSince` è quello di oggi da `onStatus`. Correggi i commenti che dicono «nuovo dell'ultimo giro».
- [ ] **Step 4:** test dei due workspace e `npm run typecheck`: verdi.
- [ ] **Step 5: Commit** `feat: lead nuovi dall'ultima visita della lista`.

### Task 5: Portale: riquadro «Giro automatico» ed etichette

**Files:**
- Modify: `packages/shared/src/api/connector-messages.ts` (`autoChanged`), `apps/web/src/connector.ts` (`TIMEOUT_MS.autoChanged = 2_000`), `apps/web/src/pages/Settings.tsx`, `apps/web/src/components/Sweep.tsx`, `apps/web/src/pages/ControlAgent.tsx`
- Test: `apps/web/test/settings.test.tsx`, `apps/web/test/sweep.test.tsx`, `apps/web/test/control.test.tsx`

**Interfaces:**
- Consumes: `AgentSettings.autoSweep/autoSweepHours` (Task 2), `SweepProgress.auto`, `SweepResult.auto?`, `ControlSweep.auto` (Task 3).
- Produces: `PortalMessage` aggiunge `{ type: 'autoChanged' }`. `Settings` riceve `connector?: ConnectorPort` (default `chromeConnector`).

- [ ] **Step 1: Test che falliscono.**
  - Impostazioni: il riquadro «Giro automatico» ha la casella «Fai il giro da solo quando uso il computer» (spenta) e la tendina «Frequenza», disattivata finché la casella è spenta, con «Una volta al giorno», «Ogni 8 ore», «Ogni 6 ore», «Ogni 4 ore», «Ogni 3 ore». Attivare e salvare manda `{ autoSweep: true }`, poi `connector.send({ type: 'autoChanged' })`. Se si salvano solo altre impostazioni, `autoChanged` non parte.
  - Giro: `running.auto` → «Giro automatico in corso». `last.auto` → la riga dell'ultimo giro finisce con «· automatico». Un `last` senza `auto` → riga di oggi.
  - Controllo: un giro con `auto: true` mostra «automatico» nella riga della scheda dell'agente.
- [ ] **Step 2:** `npm test -w apps/web`: falliscono.
- [ ] **Step 3: Implementa.** Nel riquadro, sotto i controlli, una riga `hint`: «Chrome deve essere aperto. Il giro parte fra le 7 e le 21, in una finestra ridotta a icona, e si ferma dalla notifica o da qui.» `changes()` include i due campi. Nel `PortalMessage` di `connector-messages.ts` aggiungi la variante allo schema zod.
- [ ] **Step 4:** `npm test -w apps/web`, `npm run typecheck`: verdi.
- [ ] **Step 5: Commit** `feat(web): impostazioni ed etichette del giro automatico`.

### Task 6: Connettore: quando chiedere, avvio, notifiche

**Files:**
- Create: `apps/connector/src/auto.ts`
- Modify: `apps/connector/src/runner.ts`, `apps/connector/src/external.ts`, `apps/connector/src/timing.ts`, `apps/connector/src/entrypoints/background.ts`, `apps/connector/wxt.config.ts` (permesso `idle`, descrizione), `apps/connector/package.json` (versione `0.2.0`), `packages/shared/src/api/connector-messages.ts` (`SweepStarted.nextCheckAt?: number`)
- Test: `apps/connector/tests/unit/auto.test.ts`, `apps/connector/tests/unit/runner.test.ts`, `apps/connector/tests/unit/external.test.ts`

**Interfaces:**
- Consumes: `SweepPlan.notDue/nextCheckAt` (Task 3), `{ type: 'autoChanged' }` (Task 5).
- Produces:
  - `runner.start(opts?: { auto?: boolean }): Promise<SweepStarted>`. `RunnerDeps.plan(auto: boolean)`. `RunnerState.auto: boolean`. `RunnerDeps.onEnd(e: { auto: boolean; blocked: Portal[] }): void`, chiamata da `end()` dopo l'invio della fine; `blocked` = portali con `halted[p] === 'blocked'`.
  - `ConnectorTiming` aggiunge `autoStartDelayMs` (120 000; fast 2 000) e `autoEveryMin` (15; fast 0.5).
  - `ExternalDeps.autoChanged(): void`.
  - `createAutoSweep(d: AutoDeps): { check(): Promise<'started' | 'skipped'>; reset(): Promise<void> }` con:

```ts
export interface AutoDeps {
  now(): number;
  linked(): Promise<boolean>;
  idleState(): Promise<'active' | 'idle' | 'locked'>;
  running(): Promise<boolean>;
  loadNext(): Promise<number>;            // 0 se assente
  saveNext(at: number): Promise<void>;
  start(): Promise<SweepStarted>;         // runner.start({ auto: true })
}
```

- [ ] **Step 1: Test che falliscono** (`auto.test.ts`, dipendenze finte):
  - non collegato / giro in corso / `idle` o `locked` / `now < loadNext()` → `'skipped'`, `start` mai chiamata;
  - tutto ok, `start` → `{ sweepId: 'x', … }` → `'started'`;
  - `start` → `{ sweepId: null, nextCheckAt: N }` → `saveNext(N)`, `'skipped'`; senza `nextCheckAt` → `saveNext(now + 60 min)`;
  - `start` lancia (409, rete) → `saveNext(now + 15 min)`, nessuna eccezione verso chi chiama;
  - due `check()` contemporanei → `start` una volta sola;
  - `reset()` → `saveNext(0)`.
  - `runner.test.ts`: `start({ auto: true })` chiama `plan(true)`. Una pagina `blocked` di immobiliare seguita dalla fine del giro → `onEnd({ auto: true, blocked: ['immobiliare'] })`. Il piano con `notDue` → `{ sweepId: null, total: 0, skipped, nextCheckAt }`.
  - `external.test.ts`: `{ type: 'autoChanged' }` dall'origine del portale → `autoChanged()` chiamata, risposta `{ ok: true, data: null }`.
- [ ] **Step 2:** `npm test -w apps/connector`: falliscono.
- [ ] **Step 3: Implementa `auto.ts`, `runner.ts`, `external.ts`.**
- [ ] **Step 4: Collega in `background.ts`.** `plan(auto)` manda `auto ? { auto: true } : {}`. `auto` lo creano `createAutoSweep` con `browser.idle.queryState(300)` e `nextAutoAt` in `storage.local`. Poi:
  - allarme `auto` (`periodInMinutes: TIMING.autoEveryMin`);
  - in `onStartup`, allarme singolo `auto` con `when: Date.now() + TIMING.autoStartDelayMs`: un allarme, non un `setTimeout`, perché il worker si spegne;
  - `idle.onStateChanged` → `active` → `check()`.

  Su `'started'`, notifica `auto` con il testo della spec e il pulsante «Ferma»; `notifications.onButtonClicked('auto')` → `runner.stop()`. In `onEnd` con `auto`, chiudi la notifica `auto`; se `blocked` non è vuoto, salva i portali in `storage.local` (`verify`) e mostra la notifica `verify`: «<Siti> ha/hanno chiesto una verifica: aprilo tu». Il clic apre `https://www.<sito>/` del primo portale. `link()` riuscito → `auto.reset()`. Permesso `idle` nel manifest. Descrizione breve: «Cerca gli annunci di privati della tua zona, quando lo chiedi dal portale HomeRadar o da solo se l'hai attivato».
- [ ] **Step 5:** `npm test -w apps/connector`, `npm run typecheck`, `npm run test:e2e -w apps/connector` (il giro manuale deve restare verde): verdi.
- [ ] **Step 6: Prova a mano.** Usa `WXT_PORTAL_URL=http://localhost:8787 WXT_SWEEP_FAST=1 npm run build -w apps/connector` con il server locale (`docs/deploy.md`). Attiva il giro automatico dal portale e controlla questi punti:
  - dopo il salvataggio il giro parte (con `autoChanged`), in una finestra ridotta a icona e con la notifica;
  - «Ferma» lo chiude come `stopped`;
  - un nuovo controllo risponde «non dovuto».
- [ ] **Step 7: Commit** `feat(connector): giro automatico`.

### Task 7: Informativa, documenti e Store

**Files:**
- Modify: `packages/shared/src/api/types.ts` (`PRIVACY_VERSION = 2`), `apps/web/src/pages/Privacy.tsx`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md` (§2, §11), `docs/roadmap.md`, `docs/web-store.md`
- Test: i test esistenti che citano `PRIVACY_VERSION` o il testo dell'informativa

- [ ] **Step 1: Informativa.** Il giro parte «con «Cerca» o da solo, se l'hai attivato nelle impostazioni (fra le 7 e le 21, con Chrome aperto)». Resta vero che fuori dal giro il connettore non legge niente. Porta `PRIVACY_VERSION` a 2.
- [ ] **Step 2: CLAUDE.md.**
  - Connettore: aggiungi `src/auto.ts`, poi le notifiche e il permesso `idle`.
  - Vincolo: «Il connettore legge solo durante il giro (lanciato dall'agente o automatico se l'ha attivato)».
  - Web: «Lead nuovo = gruppo comparso dopo la visita precedente della lista (`POST /api/leads/visit`; senza visite, dall'inizio dell'ultimo giro)».
- [ ] **Step 3: Spec e roadmap.** Nella spec del portale, sposta le ricerche programmate dai non obiettivi (§2) e dal §11, con un rimando al design nuovo. Nella roadmap aggiungi la riga 6c «Giro automatico» (design e questo piano, stato «fatto» a fine lavoro). Nella tappa 7, «`PRIVACY_VERSION` 2» diventa «versione successiva».
- [ ] **Step 4: `docs/web-store.md`.** Aggiorna descrizione breve e lunga, scopo unico, i permessi `idle` (sapere se l'agente sta usando il computer prima di partire da solo), `alarms` e `notifications` (avvio, verifica, invii fermi), più una nota: «versione 0.2.0: nuova revisione».
- [ ] **Step 5:** `npm test`, `npm run typecheck`, `npm run build`: verdi.
- [ ] **Step 6: Commit** `docs: giro automatico in informativa, CLAUDE.md, spec, roadmap e Store`.
