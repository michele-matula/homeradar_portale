# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeRadar Portale è il successore web dell'estensione HomeRadar (repository `homeradar`): gli agenti immobiliari accedono a un portale, vedono i lead dei privati della loro zona da un archivio condiviso e lavorano stati, note e richiami. Sul PC dell'agente un connettore (estensione senza interfaccia, tappa 3) fa il giro delle ricerche, solo quando lo lancia l'agente e solo nella scheda del giro. Conversazione e testi dell'interfaccia in italiano.

## Comandi

```bash
npm test                          # tutti i workspace
npm run typecheck                 # tutti i workspace
npm run build                     # SPA in apps/web/dist (servita dal Worker)
npm test -w packages/shared       # un solo workspace (i test delle fixture vanno lanciati così: leggono percorsi relativi al pacchetto)
npm test -w apps/server           # Worker con D1 locale (runtime Workers)
npm test -w apps/web
npx vitest run test/auth.test.ts  # un file, dentro il workspace
npm run dev -w apps/web           # SPA su :5173, /api passa a :8787
```

Server locale, deploy e account admin: `docs/deploy.md`.

## Struttura

- `packages/shared` (`@homeradar/shared`): logica pura **copiata** da `homeradar` (adattatori, `core/`, tipi) e da qui in poi evolve in questo repository; più `src/api/types.ts` (tipi e schemi zod delle API, usati da server e web) e `src/api/connector.ts` (schemi di `/connector/*`: è la lista dei campi che si possono salvare). Nei sorgenti gli import sono **relativi** (niente alias `@/`), così server e web importano `@homeradar/shared/core/comuni` senza configurare alias; i test usano l'alias `@/`.
- `apps/server`: Worker Cloudflare. `src/index.ts` (dispatch: `/api/*` alle rotte del portale, `/connector/*` a quelle del connettore, il resto agli asset), `src/http.ts` (`json`, `fail`, `readBody`, `route`, controllo dell'origine), `src/crypto.ts` (PBKDF2, token), `src/users.ts` (utenti e link monouso), `src/session.ts` (sessioni, cookie, `userRoute`), `src/device.ts` (token del connettore, `deviceRoute`), `src/rate-limit.ts`, `src/archive.ts` (righe D1 ↔ tipi condivisi, zona dell'agente), `src/settings.ts`, `src/leads.ts` (lead, stato, separazioni), `src/sweeps.ts` (piano, freschezza, giri, esiti, "non più visto", avanzamento), `src/ingest.ts` (lotti), `src/routes/*` (rotte per area). `/connector/*` si autentica con `Authorization: Bearer <token del dispositivo>` e non controlla l'`Origin`. Liste in SQL con un solo parametro: `IN (SELECT value FROM json_each(?))` (D1 ammette al più 100 parametri). Migrazioni D1 in `migrations/`: per cambiare lo schema aggiungi un file nuovo, non modificare quelli esistenti. `scripts/create-admin.mjs` crea l'account admin.
- `apps/web`: SPA React (Vite), nessuna libreria di routing (`src/router.ts`); parla col server solo tramite `src/api.ts`. Pagine in `src/pages/`, componenti in `src/components/`.

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
