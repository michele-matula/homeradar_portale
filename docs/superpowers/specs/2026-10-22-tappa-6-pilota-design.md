# Tappa 6 — Pronti per il pilota

Data: 2026-10-22. Sostituisce, per ora, la tappa 6 «Lancio» della roadmap: il lancio vero si sposta dopo i riscontri del pilota.

## Perché

Il primo pilota è una persona di fiducia che fa da tester dell'applicativo. Gli serve un portale che regga l'uso quotidiano e un connettore che si installi senza modalità sviluppatore e si aggiorni da solo. Le questioni legali (informativa completa, parere sull'archivio condiviso), il dominio e le mail automatiche si affrontano dopo i suoi riscontri.

## Obiettivi

1. Il pilota riceve da Michele, in privato, il link d'invito al portale (dominio attuale `homeradar-portale.homeradar-pilot-worker.workers.dev`) e il link al connettore sul Chrome Web Store («Non in elenco»), e lavora senza aiuto.
2. Le piccole cose che nell'uso di ogni giorno darebbero fastidio o confusione sono corrette (elenco sotto).
3. Un test end-to-end copre invito → accesso → lead.

## Non obiettivi (dopo il pilota)

Dominio proprio, mail automatiche, informativa legale con `PRIVACY_VERSION` 2, parere legale, gli altri minori rinviati.

## Anti-obiettivi

- La pagina minima dell'informativa non deve promettere niente che il codice non faccia, né presentarsi come il testo legale definitivo.
- Nessun cambio a cosa si salva o a come lo si usa (resta valido l'obbligo di alzare `PRIVACY_VERSION` se succede).
- Nessun segreto nel repository: la chiave pubblica dello Store non è un segreto, la chiave privata non esiste per noi (la tiene lo Store).

## Parti

### A. Pagina `/informativa` minima

Sostituisce «Testo in preparazione» in `apps/web/src/pages/Privacy.tsx`. Breve, in italiano, dichiaratamente provvisoria («versione per la fase di prova; il testo completo arriverà prima dell'apertura del servizio»). Deve dire, in linea con il codice:

- il connettore legge Immobiliare, Idealista, Subito e CasaDaPrivato solo durante un giro lanciato dall'agente dal portale e solo nella scheda di quel giro;
- manda al portale solo annunci di privati e solo i campi di `ObservationSchema` (link, titolo, indirizzo, comune e zona, tipologia, superficie, locali, prezzo e ribassi, data dell'annuncio, foto di copertina); mai telefoni né nomi dei venditori;
- l'archivio degli annunci è condiviso fra gli agenti della stessa zona; stati, note, richiami e impostazioni sono privati dell'agente;
- il portale registra i computer collegati (browser, sistema, versione, ultimo uso) e gli errori di portale e connettore, ripuliti dai dati degli annunci, tenuti 90 giorni;
- durante il giro, su Immobiliare e Subito, i dati letti passano dalla pagina al connettore e sono quindi visibili agli script di quei siti;
- chi contattare: Michele, con l'indirizzo email che lui indica in fase di piano (unico dato da chiedere).

Deve restare pubblica (lo è già: `PUBLIC` in `App.tsx`) perché lo Store la apre senza accesso. `PRIVACY_VERSION` non cambia.

### B. Pacchetto per lo Store

- Build «store»: come la build di produzione (`WXT_PORTAL_URL` del portale attuale) ma **senza** il campo `key` nel manifest, perché lo Store non lo accetta. Si sceglie con una variabile (es. `WXT_STORE=1`) letta in `wxt.config.ts`; lo zip con `wxt zip` (o equivalente). Comando documentato in `docs/deploy.md`.
- Versione del manifest: quella di `package.json`; ogni caricamento sullo Store vuole una versione più alta della precedente, va scritto nel deploy.
- Documento `docs/web-store.md` con i testi da incollare nella dashboard: nome, descrizione breve e lunga, scopo unico, motivo di ogni permesso (`storage`, `alarms`, `notifications`, i quattro siti, il portale), dichiarazioni sui dati (cosa si raccoglie, che non si vende né si usa per altro), indirizzo dell'informativa, visibilità «Non in elenco», e cosa serve ancora a mano (almeno uno screenshot 1280×800 del portale, le icone ci sono già in `public/icon`).
- Caricamento e invio in revisione li fa Michele dal suo account sviluppatore.

### C. Dopo l'approvazione (passo separato, si fa quando Michele porta l'ID)

- In `apps/connector/src/key.ts` la chiave pubblica della dashboard dello Store al posto di quella di prova; in `CONNECTOR_ID` (`packages/shared/src/api/connector-messages.ts`) l'ID dello Store. Il test `key.test.ts` deve restare verde. Così le build locali (con `key`) e quella dello Store hanno lo stesso ID.
- Link d'installazione: una costante accanto a `CONNECTOR_ID` (indirizzo della scheda dello Store). In `Sweep.tsx` il messaggio «Connettore non trovato…» rende «installalo» un link alla scheda (nuova scheda). Spec §6.1 punto 2 cita anche Edge: per il pilota basta Chrome, Edge resta fuori.
- Deploy del portale; il pilota installa dallo Store; il primo «Cerca» collega il computer.
- `docs/deploy.md`: la sezione «Connettore» passa da «Carica estensione non pacchettizzata» allo Store (la non pacchettizzata resta per lo sviluppo locale).

Il piano tiene A, B, D, E, F in un branch e C in un secondo blocco, eseguito solo quando c'è l'ID.

### D. Test end-to-end del portale

Playwright in `apps/web` (scelta del costruttore: Playwright c'è già nel connettore). Contro il Worker vero in locale (`wrangler dev` sulla SPA compilata) con uno stato D1 temporaneo, migrazioni applicate, admin creato e alcuni annunci di privati nella zona dell'agente inseriti da SQL di seed (non serve il connettore). Percorso: l'admin accede e invita un agente con un comune → si apre il link d'invito → informativa accettata e password scelta → accesso → la lista mostra i lead seminati → si apre una scheda e si cambia lo stato. Comando `npm run test:e2e -w apps/web`, non dentro `npm test`.

### E. Minori del portale (dalle revisioni delle tappe 3–4)

1. `LeadDetail.tsx`: due salvataggi in volo (nota poi stato) possono lasciare a video lo stato vecchio. Vince l'ultima richiesta partita (contatore o fila).
2. «Separa»: bloccare il doppio clic mentre la richiesta è in corso.
3. `Leads.tsx`: il ripristino dello scorrimento solo con `narrow()`, non su desktop.
4. Dopo la mezzanotte con il PC sospeso: «oggi», il badge «da richiamare» e «Giro di oggi da fare» si ricalcolano al ritorno (`visibilitychange`/`focus`).
5. Impostazioni: un campo numerico svuotato non manda NaN (il campo vuoto non si salva e lo dice, oppure torna al valore precedente: scelta del costruttore, coerente con gli altri errori della pagina).
6. `Sweep.tsx`: «N pagine in attesa d'invio» si aggiorna anche a giro chiuso finché la coda del connettore ha elementi (interrogare anche con `pending > 0`).

### F. Minori di connettore e server (dalle revisioni delle tappe 3 e 5)

1. Ricollegando un browser che ha già un token, `replaceDevice` (`apps/server/src/device.ts`) sposta già i giri sul dispositivo nuovo: deve spostare anche gli errori, così non compaiono come «connettore revocato». Verificare con un test che non resti un secondo computer in «I tuoi computer» (minore della tappa 3, forse già risolto in tappa 5).
2. `runner.ts`: se l'apertura della finestra del giro fallisce dopo il piano, si mette in coda la fine `interrupted` invece di lasciare il giro aperto 15 minuti.
3. `recordErrors`: `context = COALESCE(excluded.context, context)`.
4. `POST /api/errors` con sessione non aggiorna `users.last_seen_at`.

Ogni punto con il suo test, nello stile dei test esistenti.

## Vincoli

Quelli di `CLAUDE.md` restano tutti validi. Nessuna migrazione prevista; se una correzione la richiede, file nuovo in `migrations/`.

## Lasciato al costruttore

Forma del contatore in `LeadDetail`, comportamento del campo numerico vuoto, come si costruisce lo stato D1 dell'e2e (`--persist-to` in una cartella temporanea, seed via `wrangler d1 execute --local`, admin con `scripts/create-admin.mjs` o SQL), nome della variabile della build per lo Store.

## Da chiedere a Michele nel piano

L'indirizzo email da mettere nell'informativa come contatto.
