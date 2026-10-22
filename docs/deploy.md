# Deploy del portale

Il portale è un solo Worker Cloudflare (`apps/server`) che serve le API sotto `/api/*` e la SPA compilata (`apps/web/dist`), con un database D1 in UE.

## Requisiti

- Account Cloudflare con il piano **Workers Paid** (5 $/mese): l'hash delle password (PBKDF2 a 100 000 iterazioni) supera i 10 ms di CPU per richiesta del piano gratuito.
- Node 24 e `npm install` eseguito nella radice del repository. Se npm segnala che gli script di installazione di `workerd` ed `esbuild` non sono approvati, approvali con `npm install-scripts approve workerd esbuild` e ripeti `npm install`.

## Primo deploy

Da `apps/server`:

1. `npx wrangler login`
2. `npx wrangler d1 create homeradar-portale --jurisdiction eu` e copia il `database_id` stampato in `wrangler.toml` (al posto di quello provvisorio, tutto zeri).
3. `npx wrangler d1 migrations apply homeradar-portale --remote`
4. Dalla radice: `npm run build` (compila `apps/web` in `apps/web/dist`).
5. `npx wrangler deploy`: annota l'indirizzo `https://homeradar-portale.<account>.workers.dev`.
6. Account amministratore: `node scripts/create-admin.mjs <tua-email>`. Chiede la password senza mostrarla, scrive l'SQL in un file temporaneo e stampa il comando `npx wrangler d1 execute … --remote --file …` da eseguire. Poi cancella il file.
7. Apri l'indirizzo, accedi e crea il primo agente da **Utenti**: copia il link d'invito e mandalo all'agente (vale 7 giorni, si usa una volta sola).

## Aggiornamenti

Dalla radice `npm run build`, poi da `apps/server`:

1. `npx wrangler d1 migrations apply homeradar-portale --remote` (solo se ci sono migrazioni nuove);
2. `npx wrangler deploy`.

Applica sempre le migrazioni **prima** del deploy: il codice nuovo può leggere colonne che il database vecchio non ha.

## Sviluppo locale

1. Dalla radice `npm run build` (oppure `npm run dev -w apps/web` per la SPA con ricarica automatica su :5173, che passa `/api` al Worker).
2. Da `apps/server`: `npx wrangler d1 migrations apply homeradar-portale --local`, poi `npx wrangler dev` (porta 8787).
3. Admin locale: come al punto 6 del primo deploy, con `--local` al posto di `--remote` nel comando stampato.

I cookie di sessione sono `Secure`: Chrome li accetta su `http://localhost`, quindi in locale apri `http://localhost:8787` (o :5173).

## Migrazioni in sospeso in produzione

Al 2026-10-22 in produzione è applicata solo `0001_accounts.sql`. Prima del prossimo deploy del Worker vanno applicate `0002_archive.sql`, `0003_archive_fixes.sql` e `0004_link_codes.sql`: basta il comando del punto 1 degli aggiornamenti, che le applica in ordine. Per controllare: `npx wrangler d1 migrations list homeradar-portale --remote`.

## Connettore

Il connettore (`apps/connector`) è un'estensione che si costruisce per un portale preciso: l'indirizzo del portale entra nella build (API e unica pagina che può parlargli).

1. Dalla radice: `WXT_PORTAL_URL=https://homeradar-portale.<account>.workers.dev npm run build -w apps/connector`. Senza `WXT_PORTAL_URL` la build si ferma.
2. In Chrome (o Edge): `chrome://extensions` → modalità sviluppatore → «Carica estensione non pacchettizzata» → `apps/connector/.output/chrome-mv3`.
3. Apri il portale e premi «Cerca»: il portale collega da solo il connettore all'account e lo mostra in «I tuoi computer».

L'ID dell'estensione è fisso (chiave pubblica in `apps/connector/src/key.ts`, ID in `CONNECTOR_ID`): il portale lo usa per parlarle. Alla pubblicazione sul Web Store (non in elenco) si sostituiscono chiave e ID con quelli che dà il Web Store.

In locale: SPA compilata e `npx wrangler dev`, poi `WXT_PORTAL_URL=http://localhost:8787 npm run build -w apps/connector`. Apri il portale da `http://localhost:8787`: i messaggi arrivano al connettore solo da quell'origine (non da :5173).

Test end-to-end del connettore: `npm run test:e2e -w apps/connector` (costruisce la versione di prova in `.output-e2e`, con tempi brevissimi e portale finto su `localhost:8799`: non va mai caricata in Chrome per lavorare).
