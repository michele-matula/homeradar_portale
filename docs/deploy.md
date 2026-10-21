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
