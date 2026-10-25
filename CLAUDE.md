# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeRadar Portale è il successore web dell'estensione HomeRadar (repository `homeradar`): gli agenti immobiliari accedono a un portale, vedono i lead dei privati della loro zona da un archivio condiviso e lavorano stati, note e richiami. Sul PC dell'agente un connettore (estensione senza interfaccia, `apps/connector`) fa il giro delle ricerche, solo quando lo lancia l'agente e solo nella scheda del giro. Conversazione e testi dell'interfaccia in italiano.

## Comandi

```bash
npm test                          # tutti i workspace
npm run typecheck                 # tutti i workspace
npm run build                     # SPA in apps/web/dist (servita dal Worker)
npm test -w packages/shared       # un solo workspace (i test delle fixture vanno lanciati così: leggono percorsi relativi al pacchetto)
npm test -w apps/server           # Worker con D1 locale (runtime Workers)
npm test -w apps/web
npm test -w apps/connector
npm run test:e2e -w apps/connector   # Playwright: build di prova (.output-e2e), portale finto su localhost:8799
npm run test:e2e -w apps/web         # Playwright: SPA + wrangler dev su :8788 con D1 nuovo in apps/web/.e2e-state (admin e annunci seminati), invito → accesso → lead
WXT_PORTAL_URL=http://localhost:8787 npm run build -w apps/connector   # estensione in apps/connector/.output/chrome-mv3
npx vitest run test/auth.test.ts  # un file, dentro il workspace
npm run dev -w apps/web           # SPA su :5173, /api passa a :8787
```

Server locale, deploy, account admin e connettore: `docs/deploy.md`.

## Struttura

- `packages/shared` (`@homeradar/shared`): logica pura **copiata** da `homeradar` (adattatori, `core/`, tipi) e da qui in poi evolve in questo repository; più `src/api/types.ts` (tipi e schemi zod delle API, usati da server e web) e `src/api/connector.ts` (schemi di `/connector/*`: è la lista dei campi che si possono salvare). Nei sorgenti gli import sono **relativi** (niente alias `@/`), così server e web importano `@homeradar/shared/core/comuni` senza configurare alias; i test usano l'alias `@/`.
- `apps/server`: Worker Cloudflare. `src/index.ts` (dispatch: `/api/*` alle rotte del portale, `/connector/*` a quelle del connettore, il resto agli asset), `src/http.ts` (`json`, `fail`, `readBody`, `route`, controllo dell'origine), `src/crypto.ts` (PBKDF2, token), `src/users.ts` (utenti e link monouso), `src/session.ts` (sessioni, cookie, `userRoute`), `src/device.ts` (token del connettore, `deviceRoute`), `src/rate-limit.ts`, `src/archive.ts` (righe D1 ↔ tipi condivisi, zona dell'agente), `src/settings.ts`, `src/leads.ts` (lead, stato, separazioni), `src/sweeps.ts` (piano, freschezza, giri, esiti, "non più visto", avanzamento), `src/ingest.ts` (lotti), `src/errors.ts` (errori raggruppati di portale, connettore e server, quota oraria, pulizia a 90 giorni), `src/control.ts` (pagina «Controllo»: `controlHealth` è l'unico posto delle regole verde/arancio/rosso), `src/routes/*` (rotte per area). `npm run deploy -w apps/server` passa al Worker la versione (`VERSION`, commit corrente). `/connector/*` si autentica con `Authorization: Bearer <token del dispositivo>` e non controlla l'`Origin`; fa eccezione `POST /connector/link`, che scambia il codice monouso (5 minuti, da `POST /api/devices/link-code`) con il token. Liste in SQL con un solo parametro: `IN (SELECT value FROM json_each(?))` (D1 ammette al più 100 parametri). Migrazioni D1 in `migrations/`: per cambiare lo schema aggiungi un file nuovo, non modificare quelli esistenti. `scripts/create-admin.mjs` crea l'account admin.
- `apps/connector`: estensione WXT (MV3) senza interfaccia. L'indirizzo del portale entra nella build (`WXT_PORTAL_URL`, obbligatorio): è l'unica origine dei messaggi esterni (`externally_connectable`) e la base delle API. `src/entrypoints/background.ts` (collega tutto), `src/external.ts` (messaggi del portale: `ping`, `link`, `startSweep`, `stopSweep`; schemi in `packages/shared/src/api/connector-messages.ts`), `src/runner.ts` (giro: una pagina = un lotto in coda, poi gli esiti delle ricerche e la fine), `src/queue.ts` + `src/queue-store.ts` (coda in IndexedDB: un invio alla volta in ordine, attese crescenti, oltre 24 ore solo su richiesta; 401 = scollegato, coda svuotata), `src/reader.ts` + `src/content.ts` (i content script leggono solo se il background dice che è la scheda del giro), `src/outgoing.ts` (solo privati e solo i campi di `ObservationSchema`), `src/bridge.ts` (da `homeradar`), `src/errors.ts` (buffer degli errori per `/connector/errors`, al più 50, mai bloccante; il background li manda subito e a ogni `/connector/hello`, che parte all'avvio e una volta al giorno), `src/timing.ts` (tempi; quelli di prova solo con `WXT_SWEEP_FAST=1`, mai in `packages/shared`). La chiave pubblica del manifest (`src/key.ts`) fissa l'ID, copiato in `CONNECTOR_ID`; un test controlla che coincidano. I test unitari ricevono le API del browser come dipendenze (niente plugin di WXT in Vitest). Gli e2e Playwright non possono importare moduli condivisi che caricano `comuni.json`.
- `apps/web`: SPA React (Vite), nessuna libreria di routing (`src/router.ts`: `/`, `/lead/<chiave>`, `/impostazioni`, `/admin/*`); parla col server solo tramite `src/api.ts`. `/` e `/lead/<chiave>` sono la stessa pagina (`pages/Leads.tsx`: giro e filtri a sinistra in `components/FilterPanel.tsx`, lista a schede grandi da 25 per pagina al centro, sotto i 900 px una colonna con i filtri dietro un bottone); il lead si apre in una finestra sopra la lista (`components/LeadModal.tsx`, chiusa da ✕, Esc, clic fuori o indietro), così filtri, pagina e posizione restano. Lead nuovo = tutto il gruppo visto dall'inizio dell'ultimo giro (`isNewLead` in `core/lead-groups`, usata anche dal conteggio del giro sul server): nelle schede di stato i nuovi stanno in cima. Filtri, schede, conteggi, nuovi e pagine sono logica pura in `src/leads/filters.ts` (dal pannello di `homeradar`); ordinamento per scheda e filtri aperti sul telefono in `localStorage` (`src/prefs.ts`). Le impostazioni (`pages/Settings.tsx`) hanno anche zona (sola lettura) e computer collegati. L’esportazione carica `core/export` (con `xlsx`) solo al clic. Pagine in `src/pages/`, componenti in `src/components/`. Admin: `/admin/utenti`, `/admin/controllo`, `/admin/controllo/<id>`, `/admin/errori`. `src/errors.ts` manda al server gli errori non gestiti, i 5xx e quelli di rete delle API (fetch diretto, mai `api()`, al più un invio al secondo); versione = commit del build (`__APP_VERSION__`).

## Vincoli da rispettare

- Mai richieste dal server verso i portali immobiliari; niente scraping né browser remoti. Il connettore legge solo durante il giro, nella scheda del giro.
- Salvare solo annunci di privati; mai telefoni o nomi del venditore. Le note degli agenti sono private e non si condividono.
- Repository pubblico: nessun segreto nel codice (segreti con `wrangler secret`, in locale `.dev.vars`, ignorato). Le fixture passano da `packages/shared/scripts/sanitize-fixture.mjs`; il test privacy delle fixture deve restare verde.
- Dati in UE (D1 con `--jurisdiction eu`). Timestamp sempre in ms epoch UTC.
- Account: password PBKDF2-SHA256 a 100 000 iterazioni; token e sessioni salvati solo come SHA-256; cookie `hr_session` `HttpOnly; Secure; SameSite=Lax`; le richieste non GET devono avere `Origin` uguale al portale. Email sempre normalizzate (`normalizeEmail`). Errori delle API come `{ "error": "<messaggio in italiano>" }`.
- Se cambia cosa viene salvato o come viene usato, aggiorna l'informativa e alza `PRIVACY_VERSION` (`packages/shared/src/api/types.ts`).

## Documenti

- Architettura: `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md`
- Roadmap (tappe e piani; si riparte dal primo punto "da fare"): `docs/roadmap.md`
- Deploy: `docs/deploy.md`
