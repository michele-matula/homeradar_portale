# HomeRadar Portale — documento di architettura

Data: 2026-10-21. Repository: `homeradar_portale` (nuovo, pubblico). L'estensione attuale (`homeradar`) resta com'è e non viene più sviluppata per i clienti.

Le voci segnate **[scelta di Claude]** non sono state decise da Michele: si possono contestare.

## 1. Perché

Oggi HomeRadar è un'estensione Chrome: ogni agente raccoglie da solo gli annunci dei privati e li tiene sul suo PC. Il portale sposta tutto online, per tre motivi:

1. **Base di conoscenza condivisa.** Ogni giro di ogni cliente arricchisce un archivio comune di annunci e storici prezzi. Più clienti lavorano una zona, più i dati sono puntuali per tutti: i clienti sono gli "insegnanti" del sistema. L'obiettivo del prodotto è **la miglior puntualità possibile dei dati, offerta in fretta**.
2. **Gestione dei clienti.** Account creati da Michele, zona assegnata da lui, sospensione, assistenza vedendo quello che vede il cliente.
3. **Controllo senza chiedere niente al cliente.** Statistiche d'uso ed errori arrivano da soli, senza feedback manuale.

Obiettivo economico: circa 500 €/mese fra un anno (per esempio 20 agenti a 25 €).

## 2. Obiettivi, non obiettivi, anti-obiettivi

**Obiettivi**
- Portale web con login: tutto quello che oggi fa il pannello laterale (lead, priorità, storico prezzi, stesso immobile, mercato €/m², stati, note, richiami, filtri, esportazione), usabile anche da telefono e tablet.
- Archivio condiviso di annunci, prezzi, età stimata e "stesso immobile"; dati privati per agente per stato, note, richiami e coppie separate.
- Connettore locale che fa il giro delle ricerche, lanciato dal portale, e manda i dati al server.
- Le ricerche fatte di recente da qualsiasi agente non si rifanno.
- Pannello admin: clienti, zone, stato delle ricerche, uso, errori, accesso in sola lettura all'account del cliente.

**Non obiettivi (prima versione)**
- Migrazione dei dati del pilota: si riparte da zero.
- Pagamenti online: Michele fattura a mano.
- Registrazione libera: solo su invito.
- Lancio della ricerca dal telefono e ricerche programmate (seconda versione, §11).
- Badge sulle card dei portali e pannello laterale: spariscono.
- Agenzie con più agenti e ruoli: un solo ruolo, l'agente singolo (più l'admin).
- Notifiche fuori dal portale (mail, push): i richiami si vedono solo nel portale.
- Esclusiva per zona: due agenti della stessa zona vedono gli stessi lead senza sapere l'uno dell'altro.

**Anti-obiettivi (fallimento anche se funziona)**
- Il server o un'infrastruttura nostra che naviga i portali (scraping lato server, browser remoti, proxy).
- Nomi o telefoni dei venditori che arrivano al server.
- Un agente che vede note, stati o attività di un altro agente, o che capisce chi altro lavora la sua zona.
- Ricerche più lente o più a rischio di verifica DataDome di quelle dell'estensione attuale.
- Costi fissi oltre qualche decina di euro al mese prima di avere clienti.

## 3. Vincoli

- **Nessuna richiesta dai nostri server verso i portali.** Si naviga solo dal browser dell'agente, con il suo clic, una scheda alla volta con le pause attuali, fermandosi alla prima verifica. Restano valide le regole del repository attuale (CLAUDE.md, "Vincoli da rispettare").
- **Solo annunci di privati; mai nomi o telefoni del venditore.** La lettura avviene nel connettore con gli schemi zod come lista dei campi ammessi; il server rivalida con gli stessi schemi.
- **Dati in UE**: database D1 creato con giurisdizione `eu`.
- **Repository pubblico**: nessun segreto nel codice (variabili d'ambiente e segreti di Wrangler); le fixture passano dal sanitizer e il test sulla privacy delle fixture resta.
- **Parere legale** sull'archivio condiviso (diritto sui generis sulle banche dati, termini dei portali, GDPR sugli annunci dei privati) **prima del primo cliente pagante**. Lo sviluppo parte subito.
- **Budget**: gratis o poche decine di euro al mese.
- Timestamp sempre in ms epoch UTC; testi dell'interfaccia in italiano.

## 4. Componenti

```
 PC dell'agente (Chrome/Edge/Brave/Opera)                     Cloudflare (UE per i dati)
┌───────────────────────────────────────┐                ┌──────────────────────────────────┐
│ Portale (scheda)  ──messaggio esterno─┼─► Connettore    │ Worker "homeradar-portale"        │
│        │                              │   (estensione   │  ├ /api/*   API JSON               │
│        │ HTTPS (cookie di sessione)   │    MV3, senza   │  ├ /connector/*  API connettore    │
│        ▼                              │    interfaccia) │  ├ asset statici: SPA React        │
│                                       │      │ HTTPS    │  └ cron: manutenzione              │
│                                       │      │ (token)  │ D1 (giurisdizione eu)              │
└───────────────────────────────────────┘      ▼          └──────────────────────────────────┘
 Telefono/tablet: solo portale (nessun giro)
```

1. **Portale web**: SPA React servita come asset statici dallo stesso Worker dell'API (stessa origine, cookie semplici) **[scelta di Claude]**. Layout responsive: lista lead su telefono, lista più dettaglio su desktop.
2. **API** (Cloudflare Worker, TypeScript): autenticazione, lead, impostazioni, giri, admin, errori. Calcola raggruppamenti, priorità e mercato lato server **[scelta di Claude]**: il telefono resta leggero.
3. **Database** D1 (SQLite), giurisdizione `eu`.
4. **Connettore**: estensione MV3 (WXT) senza pannello né badge. Contiene il bridge, i content script e gli adattatori di oggi, il `sweep-runner` e una coda d'invio. Pubblicato sul Chrome Web Store come **non in elenco**: si installa solo dal link nel portale. Funziona su Chrome, Edge, Brave e Opera desktop.
5. **Admin**: sezione dello stesso portale, visibile solo al ruolo `admin`.

**Piano Cloudflare [scelta di Claude]**: Workers Paid (5 $/mese). Il piano gratuito concede 10 ms di CPU per richiesta: non bastano per validare i lotti di annunci e calcolare i gruppi. D1, asset statici e cron sono inclusi. Costo totale stimato: 5 $/mese più 5 $ una tantum per l'account sviluppatore del Web Store; dominio (~10-15 €/anno) quando Michele sceglie il nome.

## 5. Modello dei dati

### In comune (archivio)
- `listings`: come `ListingRecord` di oggi (chiave `portale:id`, dati dell'annuncio, `portalCreatedAt`, `estimatedCreatedAt`, `firstSeenAt`, `lastSeenAt`, `seenCount`, `lastDrop`, `coverUrl`, `missedSweeps`, `missingSince`, categoria, **ISTAT del comune** della ricerca che l'ha visto). Nessun riferimento all'agente che l'ha visto.
- `price_snapshots`: come `PriceSnapshot`.
- `calibration_points`: punti ID→data appresi (Idealista, Subito), condivisi; i default di `core/age.ts` restano nel codice.
- `search_runs`: un record per ogni ricerca (`SearchSpec.key`) eseguita: chi (agente, dispositivo), quando, esito (`complete`, `capped`, `blocked`, `error`, `notFound`), pagine, privati. Serve per freschezza, "non più visto", stato delle ricerche nell'admin e statistiche.

### Privati per agente
- `lead_states`: (utente, chiave annuncio) → stato, note, richiamo, `statusChangedAt`, `updatedAt`. Come oggi, si scrivono su tutto il gruppo dello stesso immobile.
- `splits`: (utente, a, b): coppie separate dall'agente; influiscono solo sui suoi gruppi.
- `user_settings`: `minAgeDays`, `minDropPercent`, categorie, portali attivi. I comuni li assegna l'admin.

### Account e servizio
- `users`: email, hash della password, ruolo (`agent` | `admin`), stato (`invited` | `active` | `suspended`), comuni assegnati (ISTAT), limite comuni (default **4**, modificabile dall'admin), versione dell'informativa accettata.
- `invites` / `password_resets`: token monouso con scadenza.
- `sessions`: sessioni del portale.
- `devices`: connettori collegati (utente, nome, token hash, ultimo contatto, versione), revocabili.
- `usage_events`: eventi d'uso generati dal server stesso (accesso, giro avviato/finito, cambio stato, richiamo, nota, esportazione), con giorno locale.
- `errors`: errori di portale, connettore e server (sorgente, versione, messaggio ripulito con la logica di `sanitizeError`, pagina, conteggio, prima e ultima occorrenza).
- `admin_audit`: accessi dell'admin agli account dei clienti.
- `config`: parametri regolabili dall'admin (minuti di freschezza, default **60**; limite comuni di default).

### Cosa vede un agente
Tutti gli annunci dell'archivio il cui comune è fra quelli assegnati a lui e la cui categoria è fra quelle che ha scelto, chiunque li abbia trovati. Il comune si determina come oggi in `lead-filters.ts` (nome normalizzato della città, ripiego sull'ISTAT della ricerca). Raggruppamento, priorità, mercato ed esclusione dei separati si calcolano per agente a ogni lettura, come oggi in `listLeads()`. La mediana €/m² usa l'archivio intero della città o della zona.

L'archivio salva ogni annuncio di privato letto da un giro, anche se il comune non è nella zona di chi l'ha letto (succede con le ricerche che sconfinano): sarà utile a chi ha quel comune **[scelta di Claude]**.

Nella lista dell'agente non compaiono gli annunci "non più visti" da più di 90 giorni, a meno che l'agente non li abbia lavorati (stato diverso da "nuovo", note o richiamo) **[scelta di Claude]**: sostituisce la pulizia automatica di oggi senza cancellare l'archivio.

Un agente può avere un solo giro in corso: un secondo «Cerca» da un altro dispositivo viene rifiutato con "giro già in corso su un altro computer" **[scelta di Claude]**. Il giorno "locale" di statistiche e richiami è quello di Europe/Rome.

### Pulizia
Nella prima versione l'archivio non si cancella **[scelta di Claude]**: è il valore del prodotto e D1 ne contiene molti anni. Quando un agente viene eliminato si cancellano i suoi dati privati (stati, note, richiami, coppie separate, impostazioni, dispositivi, sessioni); restano i suoi `search_runs` resi anonimi (utente azzerato) e gli eventi d'uso aggregati.

## 6. Flussi

### 6.1 Invito e accesso
1. L'admin crea l'utente (email, comuni). Il server genera un token d'invito (monouso, 7 giorni) e manda la mail. **Finché non c'è un dominio**, l'admin vede il link nel pannello e lo manda lui (mail, WhatsApp) **[scelta di Claude]**: l'invio automatico richiede un dominio verificato.
2. L'agente apre il link, sceglie la password, accetta l'informativa (versionata come `ONBOARDING_VERSION` oggi).
3. Accesso con email e password; sessione in cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 30 giorni rinnovabili. Hash con PBKDF2-SHA256 di WebCrypto (unico disponibile nativamente nei Workers) **[scelta di Claude]**. Limite ai tentativi falliti per email e IP.
4. Password dimenticata: link via mail con token monouso (1 ora); senza dominio, lo genera l'admin.
5. Utente sospeso: sessioni e dispositivi rifiutati, messaggio "account sospeso".

### 6.2 Collegare il connettore
1. Nel portale, su desktop, il pulsante «Cerca» manda un `ping` all'estensione (`chrome.runtime.sendMessage(EXTENSION_ID, …)`, permesso dal campo `externally_connectable` del manifest limitato al dominio del portale). L'ID dell'estensione è fisso: la chiave del manifest è nel repository.
2. Nessuna risposta: il portale mostra «Installa il connettore» con il link al Web Store e le istruzioni (anche per Edge). Dopo l'installazione il portale riprova da solo.
3. Prima volta su quel browser: il portale chiede al server un codice di collegamento (monouso, 5 minuti) e lo passa all'estensione, che lo scambia con un token di dispositivo a lunga durata. Il token sta in `chrome.storage.local`; l'agente vede i suoi dispositivi nel portale e può scollegarli.
4. Un agente può avere più dispositivi (PC dell'ufficio e di casa).
5. Su telefono e tablet il pulsante «Cerca» non c'è: al suo posto c'è un avviso "le ricerche partono dal computer" e l'esito dell'ultimo giro.

### 6.3 Il giro delle ricerche
1. L'agente clicca «Cerca» nel portale (desktop). Il portale manda `startSweep` all'estensione.
2. Il connettore chiede al server il **piano**: il server costruisce le `SearchSpec` per i comuni, le categorie e i portali dell'agente (logica di `core/searches.ts` e `adapters/*/search-urls.ts`) e segna come **da saltare** quelle con un `search_run` `complete` di chiunque negli ultimi N minuti (default 60) o già **in corso** da meno di 15 minuti per un altro agente. Se tutte sono fresche, il portale dice "dati già aggiornati da meno di un'ora" e mostra subito i lead.
3. **Il connettore legge solo durante il giro e solo nella scheda del giro** (decisione di Michele). Quando l'agente naviga a mano sui portali non legge e non manda nulla. I content script, prima di leggere, chiedono al background se la loro scheda è quella del giro in corso; se non lo è, non fanno niente. Il bridge resta installato su tutte le pagine dei portali (deve partire a `document_start`) ma inoltra solo dentro la pagina, e il content script scarta i messaggi. L'informativa lo dice.
4. Il connettore esegue il giro come oggi (`sweep-runner.ts` + `sweep.ts`: finestra ridotta a icona, una scheda, pause, timeout, fine alla prima pagina con un'agenzia su Immobiliare e Idealista, tetti, stop alla verifica DataDome).
5. Dopo ogni pagina il connettore manda al server un lotto: osservazioni già filtrate dagli adattatori, `PageReport`, chiave della ricerca, id del giro, eventuale punto di calibrazione. Il server rivalida con zod, applica la logica di `LeadService.ingest` (unione, prezzi, ribassi, età, calibrazione) e aggiorna l'avanzamento.
6. Alla fine di ogni ricerca il connettore manda l'esito; il server registra il `search_run` e, se è `complete`, aggiorna "non più visto" per quella ricerca.
7. **Avanzamento**: il portale lo legge dal server (interrogazione ogni 3 secondi durante il giro) **[scelta di Claude]**. Così lo vede anche da telefono o da un'altra scheda, e l'admin vede lo stato delle ricerche.
8. «Ferma» nel portale manda `stopSweep` all'estensione.

**"Non più visto" con più agenti [scelta di Claude]**: un annuncio è "non più visto" dopo `MISSING_SWEEPS` (3) giri completi della sua ricerca, di qualsiasi agente, in cui non c'era, **e** se non è stato visto da almeno 24 ore. La seconda condizione evita che tre giri ravvicinati di agenti diversi lo diano per sparito in poche ore.

### 6.4 Rete assente o server giù
- Se il server non risponde alla richiesta del piano, il giro non parte e il portale lo dice.
- Durante il giro i lotti vanno in una coda persistente del connettore (IndexedDB). Il giro continua; i lotti si ritentano con attesa crescente (30 s, 2 min, 10 min, 30 min, 1 h, poi ogni ora fino a 24 ore). Ogni lotto ha un id: il server ignora i duplicati.
- Se un lotto resta in coda oltre 24 ore o dopo tutti i tentativi: notifica di Chrome ("HomeRadar non riesce a inviare i dati: controlla la connessione") e punto esclamativo sull'icona. Il portale, quando torna raggiungibile, mostra "N pagine in attesa d'invio" leggendo lo stato dal connettore.

### 6.5 Lavorare i lead
Come oggi nel pannello: lista con ricerca a testo, filtri (stato, priorità, fascia di prezzo, comune, solo trattativa riservata…), ordinamenti, scheda del lead con storico, altri portali, annunci precedenti, mercato, copertina; cambio stato, note e richiamo su tutto il gruppo; separazione di una coppia; esportazione CSV/xlsx. I **richiami** si vedono solo nel portale: numero accanto al titolo ("3 da richiamare") e filtro «Da richiamare oggi».

Le copertine continuano a essere caricate dal browser dell'agente dai server immagini dei portali (`core/cover.ts`), senza referrer.

### 6.6 Statistiche d'uso ed errori
- **Uso**: il server registra gli eventi mentre risponde alle richieste. Il client non manda report e non c'è nessun interruttore: l'informativa lo dice.
- **Errori**: portale (errori non gestiti di React e di rete) e connettore (adattatori che non leggono, pagine non riconosciute, errori del runner) mandano a `/api/errors` messaggi ripuliti con `sanitizeError`: niente dati degli annunci. Gli errori del server si registrano nella stessa tabella. L'admin vede gli errori raggruppati per messaggio e versione, con conteggio e date.

### 6.7 Admin
- Utenti: crea e invita (con link copiabile), modifica comuni e limite, sospendi/riattiva, elimina (§5 Pulizia), revoca dispositivi.
- Stato delle ricerche: ultimi giri per agente ed esiti per portale, ricerche bloccate o `notFound`, freschezza per comune.
- Uso: giorni attivi, giri, cambi di stato, richiami, note, esportazioni, per agente e per settimana.
- Errori (§6.6).
- **Vedi come l'agente**: apre il portale con i dati di quell'agente, in **sola lettura** con un banner fisso; ogni accesso va in `admin_audit` **[scelta di Claude]**.
- Parametri: minuti di freschezza, limite comuni di default.
- L'account admin di Michele si crea con un comando una tantum (script Wrangler), non dall'interfaccia.

## 7. Cosa si riprende dal repository attuale

Il nuovo repository copia il codice (non lo importa: i due progetti poi divergono) **[scelta di Claude]**.

| Da `homeradar` | Dove va | Note |
|---|---|---|
| `src/adapters/*`, `src/bridge/`, `src/content/payload-script.ts`, `page-problem.ts`, `route-watcher.ts` | connettore | invariati salvo i messaggi |
| `src/core/sweep.ts`, `src/background/sweep-runner.ts` | connettore | il piano arriva dal server; `finish` e `countNew` via API |
| `src/core/searches.ts`, `comuni.ts`, `src/shared/comuni.json`, `adapters/*/search-urls.ts` | server (piano) e admin (scelta comuni) | |
| `core/service.ts` (ingest), `age.ts`, `rules.ts`, `same-property.ts`, `lead-groups.ts`, `market.ts`, `missing.ts`, `lead-filters.ts`, `category.ts`, `recall.ts`, `export.ts`, `cover.ts` | server (pacchetto condiviso) | `LeadService` passa da Dexie a D1: la logica pura resta, cambia lo strato di accesso ai dati |
| schemi zod degli adattatori | connettore e server | validazione in entrambi |
| `src/ui/sidepanel/*` | portale | adattati a pagina intera e telefono; `api.ts` diventa client HTTP |
| `core/report.ts` (`sanitizeError`), `worker/` (admin con D1, test con runtime Workers) | server | il Worker del pilota è il modello di partenza |
| `scripts/sanitize-fixture.mjs`, fixture, test privacy, e2e Playwright | connettore | |

Non si riprendono: backup e backup automatico, offscreen, `pilot-store`, `reporter` (sostituito da eventi lato server), `onboarding` locale (diventa l'informativa all'attivazione), badge e `action-badge`, `diagnostics` se non serve.

**Struttura del repository [scelta di Claude]**: un solo repository con workspace npm:
- `packages/shared`: tipi, schemi zod, logica pura (adattatori, core);
- `apps/connector`: estensione WXT;
- `apps/server`: Worker, migrazioni D1, API;
- `apps/web`: SPA React (Vite), compilata negli asset del Worker.

## 8. Sicurezza e privacy
- Ogni query sui dati privati filtra per l'utente della sessione; i test lo verificano per ogni endpoint.
- Il connettore può solo chiedere il piano, mandare lotti ed esiti, mandare errori: il suo token non legge i lead.
- I lotti sono limitati in dimensione e frequenza per dispositivo; il server scarta i campi non dichiarati (zod `strict`).
- Messaggi esterni all'estensione accettati solo dall'origine del portale.
- Note: testo libero dell'agente, possono contenere dati personali; restano private e si cancellano con l'account. L'informativa per gli agenti lo dice.
- Informativa e termini d'uso: pagina pubblica del portale (servono anche al Web Store). Il testo legale definitivo arriva dopo il parere dell'avvocato.

## 9. Test
- Logica pura: Vitest, riprendendo i test di oggi.
- Server: Vitest con il runtime Workers e D1 locale (come `worker/` oggi): autenticazione, isolamento fra agenti, ingest, freschezza, "non più visto" con più agenti, admin.
- Connettore: Playwright sulle pagine fixture, con un server finto.
- Portale: Testing Library sui componenti principali, più un e2e del flusso invito → accesso → lead.

## 10. Ordine di costruzione
Si costruisce a tappe; il portale va al primo cliente solo quando tutte sono finite.
1. Repository, workspace, pacchetto condiviso con logica e test copiati.
2. Server: schema D1, autenticazione, inviti (link copiabile), admin utenti.
3. Server: ingest, piano, `search_runs`, freschezza, lettura dei lead per agente.
4. Connettore: collegamento, giro dal portale, coda d'invio.
5. Portale: lista e scheda lead, stati, note, richiami, filtri, esportazione, impostazioni, layout telefono.
6. Uso, errori, pannello admin completo, "vedi come l'agente".
7. Informativa, pubblicazione del connettore (non in elenco), dominio e mail automatiche quando c'è il nome.
8. Parere legale → primo cliente.

## 11. Dopo la prima versione
- Lancio della ricerca dal telefono (il connettore interroga il server ogni minuto con `chrome.alarms`; poi ricerche programmate, che vanno rivalutate anche dal lato legale).
- Coordinamento dei giri fra agenti della stessa zona (dividersi le ricerche invece di saltare quelle fresche).
- Notifiche fuori dal portale, se servono.

## 12. Lasciato a chi costruisce
Nomi di tabelle e colonne, forma esatta delle API, librerie della SPA (router, gestione dello stato), stile grafico (partendo da quello del pannello), dettagli del layout per il telefono, attese esatte dei tentativi, struttura delle migrazioni.
