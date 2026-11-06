# Avvia dal telefono

Data: 2026-11-06.

## Perché

Il giro delle ricerche parte solo da un computer con il connettore: dal telefono il portale mostra lo stato e «Le ricerche partono dal computer». Il telefono non può fare il giro: Chrome sul telefono non ha estensioni, Safari le ha solo dentro un'app dell'App Store, Android sospende il browser a schermo spento, e il server non può andare sui portali (vincolo del progetto).

Caso d'uso dell'utente: **l'agente è da un cliente e vuole vedere i lead nuovi della zona**. Se ha il computer acceso (a casa o in ufficio), dal telefono deve poter far partire il giro su quel computer e vedere i lead nuovi sul telefono.

Tempi: un giro dura circa 5 minuti (misura dell'utente). Il computer si accorge della richiesta entro un minuto. I lead arrivano man mano (un lotto per pagina), quindi i primi nuovi compaiono dopo un paio di minuti.

Limite accettato dall'utente, da spiegare agli agenti: **funziona solo con il computer acceso, non in sospensione, con Chrome aperto e il connettore collegato**. Lo schermo bloccato va bene.

## Obiettivi

- Dal portale sul telefono l'agente preme «Avvia sul computer» e il giro parte su un suo computer acceso, senza scegliere quale.
- L'agente vede sul telefono a che punto è: in attesa del computer, giro in corso, finito. Se nessun computer risponde, lo sa entro 2 minuti con una frase chiara.
- L'agente sceglie su quali computer è permesso: un interruttore per computer, spento di default.
- I computer si riconoscono: nome scelto dall'agente al collegamento, modificabile dopo.
- Nelle impostazioni e sul telefono si vede quali computer (con l'interruttore attivo) sono online.

## Non obiettivi

- Niente giro fatto dal telefono stesso, né dal server, né da browser remoti.
- Niente risveglio del PC da internet (Wake-on-LAN) e niente modifiche alle impostazioni di sospensione di Windows: al più una riga di spiegazione.
- **[scelta di Claude]** Niente permesso `background` (Chrome che resta attivo a finestre chiuse). Il giro automatico l'aveva escluso, e qui l'utente ha accettato «Chrome aperto» come limite. Si può riconsiderare dopo il pilota.
- Niente scelta del computer da parte dell'agente: decide il portale.
- Niente avvio da remoto di un computer verso un altro senza telefono, oltre a quanto viene gratis (vedi «Dove compare il bottone»).
- Il giro automatico non cambia.

## Da evitare (sarebbe un fallimento anche se funziona)

- L'agente preme e non succede niente senza capire perché: un'attesa senza fine o un errore vago.
- Un giro che parte molto dopo il tocco (l'agente ha già lasciato il cliente): una richiesta non presa entro 2 minuti scade e non parte più.
- Una scheda di Chrome che si apre su un PC dove l'agente non l'ha permesso (es. PC d'ufficio condiviso).
- Due giri insieme su due computer per la stessa richiesta.
- Un connettore che martella il server: il controllo ogni minuto c'è solo con l'interruttore attivo.

## Vincoli

- Tutti quelli di CLAUDE.md. Il vincolo «il connettore legge solo durante il giro (lanciato dall'agente, o automatico se l'ha attivato)» diventa: **lanciato dall'agente, dal computer o dal telefono, o automatico se l'ha attivato**. La lettura resta solo durante il giro, nella scheda del giro.
- Nessuna richiesta del server ai portali: il server tiene la richiesta, a navigare è il browser dell'agente.
- Migrazione D1 nuova (`0008_…`), senza modificare le esistenti. Liste SQL con un solo parametro (`json_each`).
- Timestamp in ms epoch UTC.
- `/connector/*` con il token del dispositivo, `/api/*` con la sessione e il controllo dell'Origin.

## Cosa è stato deciso

### 1. Nome dei computer (portale, server, connettore)

Chrome non dà alle estensioni il nome del computer (deciso con l'utente: niente programma nativo per leggerlo).

- **Al collegamento** il portale chiede «Come lo chiami?», con il campo già compilato col nome automatico di oggi (`deviceName`, es. «Chrome su Windows») e un suggerimento «es. PC di casa, PC ufficio». Chi ha fretta preme solo «Collega».
- Il nome scelto si salva in una colonna nuova di `devices` (es. `label`), che `touchDevice` (chiamata da `/connector/hello`) **non** sovrascrive. Il nome automatico (`name`) resta e continua ad aggiornarsi.
- Il nome mostrato ovunque è `label ?? name`: impostazioni, messaggio «giro aperto su un altro computer», stato del giro sul telefono, pagina «Controllo» dell'admin.
- In «I tuoi computer» ogni riga ha **«Rinomina»**. Il nome automatico resta visibile in piccolo sotto quello scelto.
- **«(questo computer)»**: aprendo le impostazioni dal PC, il portale chiede al connettore il suo id di dispositivo (nel `ping`) e segna quella riga. Oggi `/connector/link` restituisce solo `{ token, userId }`: deve restituire anche l'id del dispositivo, che il connettore salva. I connettori già collegati lo ricevono in risposta a `/connector/hello` (o dove preferisce chi costruisce).
- I computer già collegati restano col nome automatico finché l'agente non li rinomina.

### 2. Interruttore «Avvia dal telefono» (portale, server)

- Uno **per computer**, nella riga del computer in «I tuoi computer», **spento** di default. Deciso dall'utente: così si attiva sul PC di casa e non su quello d'ufficio condiviso. È diverso dal giro automatico, che ha un interruttore unico per l'agente.
- Si salva su `devices` (colonna nuova). Si cambia dal portale, da qualsiasi dispositivo, telefono compreso.
- **Connettore vecchio** **[scelta di Claude]**: il portale va in produzione prima che lo Store approvi il connettore nuovo, e Chrome aggiorna le estensioni da solo con qualche ora di ritardo. Per un computer con versione del connettore (`devices.version`, da `/connector/hello`) precedente a quella che sa controllare le richieste, l'interruttore non c'è e al suo posto compare «Aggiorna il connettore per usare l'avvio dal telefono (Chrome lo fa da solo, di solito entro un giorno)». Questi computer non contano per lo stato 4b né per l'online.
- Sotto la sezione una riga di spiegazione: serve il computer acceso, non in sospensione, con Chrome aperto; consiglio di impostare Windows su «Sospensione: mai» quando è collegato alla corrente.

### 3. Il connettore controlla le richieste (connettore, server)

- Con l'interruttore attivo, il connettore chiede al server **una volta al minuto** (`chrome.alarms`, `periodInMinutes: 1`) se c'è una richiesta per lui, con una rotta nuova sotto `/connector/*`. La risposta è minima.
- Ogni controllo aggiorna l'ultimo contatto del computer: è quello che rende il computer «online» (§6).
- Con l'interruttore spento il connettore non controlla ogni minuto. Deve però accorgersi che è stato acceso (anche dal telefono): **[scelta di Claude]** lo scopre al più entro 15 minuti, appoggiandosi all'allarme `auto` già esistente o a un controllo leggero equivalente, e subito se l'interruttore è stato cambiato dal portale aperto su quello stesso computer (messaggio esterno, come `autoChanged`). La risposta del controllo dice anche se l'interruttore è ancora attivo, così il connettore smette quando viene spento.
- Al controllo non servono `idle` né la fascia 7–21 del giro automatico: l'agente non è al computer per definizione, e il giro l'ha chiesto lui.
- Durante un giro il controllo continua (serve per «Ferma», §5).

### 4. La richiesta: la prende il primo computer che risponde (server)

Deciso con l'utente: l'agente non sceglie il computer. Invece di provare i computer uno dopo l'altro, **la richiesta è aperta a tutti i suoi computer con l'interruttore attivo e la prende il primo che controlla**.

- `POST /api/...` (rotta del portale, a scelta di chi costruisce) crea la richiesta dell'agente. Una sola richiesta aperta per agente: premere di nuovo mentre una è in attesa non ne crea un'altra.
- **Prima di creare la richiesta** il server fa i controlli che non dipendono dal computer e risponde subito, senza aspettare nessun PC **[scelta di Claude]**:
  - giro già in corso → lo stato del giro (il telefono lo mostra);
  - nessun computer con l'interruttore attivo → errore con il testo dello stato 4b delle bozze;
  - piano vuoto perché tutto è fresco → «Dati già aggiornati da meno di un'ora», come fa oggi «Cerca».
- Il computer che controlla e trova la richiesta la **prende in un solo passaggio SQL** (es. `UPDATE … SET device_id = ? WHERE id = ? AND device_id IS NULL AND expires_at > ?`, e conta le righe cambiate). Gli altri la trovano già presa. Poi il connettore avvia il giro con il flusso normale (`POST /connector/sweeps`), che resta protetto da `sweeps_one_open`.
- La richiesta **scade dopo 2 minuti** se nessuno la prende. Scaduta, non parte più.
- **Presa ma giro non partito** **[scelta di Claude]**: la richiesta non torna aperta per gli altri computer. Si chiude con un esito che il connettore riporta al server, e il telefono lo mostra al posto di 4a:
  - piano vuoto (un collega ha appena reso tutto fresco): «Dati già aggiornati da meno di un'ora»;
  - 409, giro già aperto su un altro computer: il telefono mostra quel giro (stato 3);
  - errore di rete o del server: «"PC di casa" ha risposto ma il giro non è partito: riprova».
  Se il connettore non riesce nemmeno a riportare l'esito (401, rete), la richiesta presa resta senza giro: dopo 2 minuti dalla presa il telefono mostra il terzo testo.
- L'agente può **annullare** una richiesta in attesa.
- Il giro avviato così è un giro manuale per tutto il resto: stesso piano, stesse pause, stesse ricerche fresche saltate. Si apre **in una finestra ridotta a icona e senza focus**, come il giro automatico (nessuno è davanti al PC). **I portali che hanno chiesto una verifica nelle 24 ore non si tolgono dal piano** **[scelta di Claude]**: l'agente l'ha chiesto ora e vuole tutto; se un portale chiede la verifica, il telefono lo dice alla fine (§5).
- Il giro si segna come partito dal telefono (colonna su `sweeps`, accanto a `auto`; `trigger` è una parola chiave di SQLite). La riga dell'ultimo giro aggiunge «· dal telefono», e la pagina «Controllo» lo mostra come mostra «automatico».
- Sul PC compare la notifica d'avvio con «Ferma», come per il giro automatico («Giro avviato dal telefono…»). **[scelta di Claude]** Chi è eventualmente vicino al PC sa cosa sta succedendo e può fermarlo.

### 5. Il telefono (portale)

Approvato dall'utente sulle bozze. La scheda «Ricerche» sul telefono (oggi solo stato e «Le ricerche partono dal computer», `components/Sweep.tsx`) ha questi stati:

1. **Pronto**: ultimo giro, pallino online (§6), bottone **«Avvia sul computer»**.
2. **In attesa del computer**: «Aspetto un computer acceso… (fino a 2 minuti)», con **«Annulla»**.
3. **Giro in corso**: «Giro in corso su "PC di casa"», avanzamento, nuovi finora, **«Ferma»**. I lead nuovi compaiono nella lista man mano (la lista si rilegge mentre il giro va avanti, come oggi sul computer).
4. **Non si parte**:
   - 4a **nessun computer ha risposto** entro 2 minuti: «Serve un computer acceso, non in sospensione, con Chrome aperto e "Avvia dal telefono" attivo», con «Riprova»;
   - 4b **nessun computer abilitato**: rimando alle impostazioni, senza bottone.
5. **Finito**: come oggi sul computer, «Vedi i nuovi» e «Chiudi». Se un portale ha chiesto una verifica: «Idealista ha chiesto una verifica: aprilo quando sei al computer».

- **«Ferma» dal telefono** vale per **qualunque giro in corso** dell'agente, anche partito dal PC o automatico, e anche su un computer con l'interruttore spento **[scelta di Claude]**. Passa dal server: il server segna lo stop sul giro e il connettore lo riceve **nella risposta ai lotti** (`/connector/batches`, uno per pagina, quindi ogni pochi secondi), e anche al controllo del minuto se l'interruttore è attivo. Il connettore chiama `runner.stop()` e il giro finisce `stopped`. Il testo dice «si ferma entro un minuto». Un giro che non manda più lotti si chiude già da solo come `interrupted` (regole di oggi).
- Lo stato della richiesta si legge da `GET /api/sweep` (o da una rotta accanto), che il telefono rilegge ogni pochi secondi mentre c'è una richiesta o un giro.

### 6. Online (portale, server)

Approvato dall'utente.

- Un computer con l'interruttore attivo è **online** se il server l'ha sentito negli **ultimi 2 minuti**. Con l'interruttore spento non si sa: si mostra solo «ultimo uso…».
- **Impostazioni, «I tuoi computer»**: pallino verde «Online ora» o grigio «Non raggiungibile · visto l'ultima volta oggi alle 9:12». Si aggiorna da solo ogni 30 secondi mentre la pagina è aperta, senza bottoni.
- **Telefono, scheda «Ricerche»**: «PC di casa è online», oppure «Nessun tuo computer è online ora». Il bottone resta premibile anche così: se l'agente accende il PC entro 2 minuti, il giro parte.

### 7. Dove compare il bottone

- **[scelta di Claude]** «Avvia sul computer» compare dove la pagina non può avviare il giro da sé: sul telefono (`isPhone()`) e su un computer dove il connettore non risponde. Dove il connettore risponde resta «Cerca» come oggi.

### 8. Testi da aggiornare

- `CLAUDE.md`: vincolo del giro (sopra), descrizione del connettore (controllo al minuto con l'interruttore attivo) e della pagina dei lead sul telefono.
- Spec del portale (§2 non obiettivi, §11, dove parla dell'avvio dal telefono rinviato) e roadmap: tappa nuova **6e «Avvia dal telefono»** prima della 7.
- Informativa (`pages/Privacy.tsx`): il giro si può avviare anche dal telefono, su un computer dove l'agente l'ha permesso, in una finestra ridotta a icona; il portale registra anche il nome scelto per il computer e, con «Avvia dal telefono» attivo, un contatto al minuto. **`PRIVACY_VERSION` sale a 3**; la riga della tappa 7 resta «versione successiva». Come per il giro automatico, chi ha già un account non deve accettare di nuovo: la funzione è spenta finché l'agente non la attiva.
- `docs/web-store.md`: scopo unico (giro chiesto dal portale, anche dal telefono), `alarms` anche per il controllo al minuto, `notifications` con l'avviso nuovo. La versione nuova va caricata sullo Store e passa in revisione.

## Lasciato a chi costruisce

- Schema della richiesta (tabella nuova o colonne su una esistente), nomi delle rotte e dei campi.
- Come il connettore scopre che l'interruttore è stato acceso, purché entro 15 minuti (subito se cambiato da quel computer).
- Se lo stop arriva anche con la risposta ai lotti o solo col controllo al minuto.
- Come ridurre le scritture su D1 del controllo al minuto (es. aggiornare l'ultimo contatto solo se è più vecchio di 30 secondi).
- Tempi di prova per gli e2e (`WXT_SWEEP_FAST=1`) in `timing.ts`: controllo e scadenza ridotti.
- Testi esatti, nel tono di quelli esistenti; le bozze approvate sono in `.superpowers/brainstorm/` (non nel repository).
