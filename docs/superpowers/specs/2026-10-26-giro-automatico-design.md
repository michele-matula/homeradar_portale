# Giro automatico

Data: 2026-10-26.

## Perché

Oggi il giro delle ricerche parte solo quando l'agente preme «Cerca» nel portale. Il pilota apre Chrome ogni mattina (per la posta o per lavorare), ma se non va sul portale a premere «Cerca» i lead nuovi non arrivano. L'idea dell'utente: **quando l'agente usa il browser, il connettore controlla se il giro è già stato fatto e, se no, lo fa da solo**. Quando l'agente apre il portale trova i dati già aggiornati. Il «Cerca» manuale resta com'è.

Si parte da «una volta al giorno», ma la regola è una soglia di **N ore**. Per un agente il vantaggio è chiamare il privato prima degli altri: un annuncio uscito alle 11 non deve aspettare il giorno dopo.

## Obiettivi

- Il connettore avvia il giro da solo quando Chrome è aperto, l'agente sta usando il PC e il giro è «dovuto».
- «Dovuto» lo decide il server, che sa quali giri ha fatto l'agente da qualsiasi computer e anche quelli lanciati a mano.
- L'agente sceglie nelle impostazioni del portale se attivarlo e ogni quanto: una volta al giorno oppure ogni N ore.
- Una verifica DataDome non provoca tentativi ripetuti. L'agente ne viene avvisato.
- Nel portale si vede che un giro è partito da solo.
- Un lead è **nuovo se è comparso dopo l'ultima volta che l'agente ha guardato la lista**, non più solo dall'inizio dell'ultimo giro. Con più giri al giorno nessun lead perde il segno prima che l'agente l'abbia visto.

## Non obiettivi

- Niente giri a browser chiuso. Niente permesso `background` né avvio di Chrome dal sistema operativo: se Chrome non è aperto, il giro aspetta la prossima apertura.
- Niente avvio dal telefono, rinviato come prima (spec del portale §11).
- Niente coordinamento dei giri fra agenti della stessa zona, oltre alla freschezza che c'è già.
- Non cambia cosa si legge né cosa si salva: il giro automatico è lo stesso giro di «Cerca», con lo stesso piano, le stesse pause e la stessa finestra.

## Da evitare (sarebbe un fallimento anche se funziona)

- Una finestra che compare in primo piano mentre l'agente lavora.
- Giri che ripartono a raffica: dopo una verifica, dopo un errore, oppure su due computer insieme.
- Un giro automatico che parte senza che l'agente l'abbia mai attivato.
- Più verifiche DataDome di quante ne dia oggi il giro manuale.

## Vincoli

- Restano tutti quelli del repository (CLAUDE.md), tranne «il connettore fa il giro solo quando lo lancia l'agente». Questo diventa: **solo quando lo lancia l'agente, o in automatico se l'agente l'ha attivato nelle impostazioni**. Il giro resta l'unico momento in cui il connettore legge, e solo nella scheda del giro.
- Nessuna richiesta del server ai portali: il server dice solo «tocca a te», a navigare è sempre il browser dell'agente.
- Timestamp in ms epoch UTC. «Oggi» e le fasce orarie si calcolano sull'ora di Roma (`romeParts`/`startOfLocalDay` in `core/recall`).
- Migrazione D1 nuova (`0006_…`): non si modificano quelle esistenti.
- Il giro automatico va valutato nel parere legale della tappa 8, come diceva la spec del portale al §11.

## Cosa è stato deciso

### Quando il connettore ci prova (connettore)

Il connettore **chiede** se il giro è dovuto. Lo fa quando succede una di queste cose:
- avvio del browser (`runtime.onStartup`), dopo un'attesa di **2 minuti** per non sovrapporsi al ripristino delle schede e all'apertura della posta;
- allarme `auto` ogni **15 minuti** (`chrome.alarms`). Copre Chrome che resta aperto per giorni e il PC che si risveglia dalla sospensione;
- ritorno dell'agente al PC (`idle.onStateChanged` → `active`).

Prima di chiedere deve valere tutto questo:
- connettore collegato;
- nessun giro in corso su questo computer;
- PC in uso: `idle.queryState(300)` uguale a `active`. Serve il permesso nuovo `idle`, che non mostra avvisi all'installazione;
- l'ora del prossimo controllo indicata dal server (vedi sotto) è passata.

Se il server risponde che il giro è dovuto, il connettore lo avvia come fa con «Cerca»: stesso `runner.start()`, stessa finestra ridotta a icona e senza focus, prima un `queue.flush({ force: true })`. Se l'agente si allontana a giro iniziato, il giro continua. Se il PC va in sospensione, il giro si interrompe come oggi.

### Se è dovuto (server)

`POST /connector/sweeps` accetta `{ auto: true }`. Senza `auto` non cambia niente: il «Cerca» manuale parte sempre. Con `auto` il server apre il giro solo se valgono tutte queste condizioni, altrimenti risponde `200 { sweepId: null, notDue: true, nextCheckAt }`:

1. l'agente ha attivato il giro automatico;
2. l'ora di Roma è nella fascia **7:00–21:00**;
3. nessun giro che **conta** è iniziato:
   - con «una volta al giorno»: dall'inizio della giornata di oggi (ora di Roma);
   - con «ogni N ore»: nelle ultime N ore;
4. nessun giro automatico è iniziato nell'ultima ora, qualunque sia il suo esito. Questo freno vale contro i tentativi ripetuti: un giro interrotto riparte al più dopo un'ora.

**Conta** ogni giro dell'agente, manuale o automatico, da qualsiasi computer, finito come `completed`, `partial` o `stopped`, oppure ancora in corso. Un giro `interrupted` (finestra chiusa, browser chiuso, PC spento) non conta, quindi si rifà, ma con il freno del punto 4. Un giro fermato da una verifica DataDome finisce `partial`, quindi conta e non si ritenta prima della soglia successiva.

`nextCheckAt` è il primo istante in cui la risposta potrebbe cambiare: la fine della soglia, l'inizio della fascia, la fine del freno. Con il giro automatico spento vale **+1 ora** **[scelta di Claude]**: un'attivazione fatta dal telefono o da un altro computer vale qui entro un'ora, senza messaggi in più (una richiesta l'ora per connettore costa poco). Il connettore lo salva in `storage.local` e prima di quell'ora non richiama il server. Lo azzera quando l'agente cambia le impostazioni (vedi sotto) e al ricollegamento.

Il calcolo di «dovuto» e di `nextCheckAt` è una funzione pura in `packages/shared/src/core/auto-sweep.ts`. Riceve impostazioni, giri recenti e `now`, e si testa da sola.

**Piano vuoto perché tutto è fresco** (un collega della zona ha appena fatto le stesse ricerche) **[scelta di Claude]**: non si apre nessun giro e non si scrive nessuna riga in `sweeps`. Il server risponde comunque «non dovuto», con `nextCheckAt` calcolato come se in quel momento fosse iniziato un giro che conta: domani dopo le 7:00 con «una volta al giorno», adesso + N ore con «ogni N ore». I dati sono già aggiornati, quindi questo computer non rifà il giro un'ora dopo, a freschezza scaduta. Il dato vive solo nel connettore: un altro computer dello stesso agente potrebbe rifarlo, ed è accettato.

Il resto di `startSweep` resta com'è: ricerche fresche saltate, 409 se c'è un giro aperto su un altro computer. Il controllo «dovuto» e l'apertura del giro avvengono nella stessa richiesta. Se due computer chiedono insieme, l'indice `sweeps_one_open` ne lascia passare uno solo, e l'altro riceve 409, che il connettore ignora in silenzio.

### Portali che hanno chiesto una verifica

In un giro automatico il server **toglie dal piano i portali che hanno chiesto una verifica all'agente nelle ultime 24 ore** (`search_runs.status = 'blocked'` delle ricerche dei suoi giri). Il «Cerca» manuale li include sempre: è l'agente, davanti al PC, che può risolvere la verifica. Se il piano resta vuoto per questo motivo, il server risponde come «non dovuto» e il giro non si apre.

### Impostazioni (portale)

Nelle impostazioni dell'agente c'è un riquadro nuovo, **«Giro automatico»**:
- interruttore «Fai il giro da solo quando uso il computer», **spento** di default;
- frequenza: «una volta al giorno» (default), «ogni 8 ore», «ogni 6 ore», «ogni 4 ore», «ogni 3 ore». **Sotto le 3 ore non si scende**, per il rischio di verifiche;
- una riga di spiegazione: Chrome deve essere aperto, il giro va dalle 7 alle 21, gira in una finestra ridotta a icona e si può fermare dalla notifica o dal portale.

Si salva in `user_settings` con due colonne nuove: `auto_sweep` (0/1) e `auto_sweep_hours` (NULL = una volta al giorno, altrimenti 3, 4, 6 o 8). Si aggiungono anche ad `AgentSettings`/`AgentSettingsBody`, con la validazione dei valori ammessi.

Dopo il salvataggio, se il connettore risponde, il portale gli manda il messaggio nuovo `autoChanged` (in `connector-messages.ts`, sempre dall'origine del portale). Il connettore azzera `nextCheckAt`, così l'attivazione vale subito e non entro un'ora.

### Lead nuovi: dall'ultima volta che l'agente ha guardato (portale e server)

Deciso dall'utente: un lead è nuovo se il suo gruppo è comparso dopo l'ultima volta che l'agente ha guardato la lista. `isNewLead(v, since)` resta com'è, cambia solo da dove viene `since`.

- **Visita**: l'agente apre la lista dei lead (`/` o `/lead/<chiave>`) dopo almeno **30 minuti** senza averla aperta **[scelta di Claude]**.
- Sull'utente due colonne nuove (migrazione 0006): `leads_seen_at`, l'ultima apertura della lista, e `new_since`, la soglia della visita in corso.
- All'apertura della lista il portale lo comunica al server con una chiamata apposita (la rotta la sceglie chi costruisce; non un effetto collaterale di `GET /api/leads`). Il server fa così:
  - se `leads_seen_at` è più vecchio di 30 minuti, inizia una visita nuova: `new_since` diventa il vecchio `leads_seen_at`;
  - in ogni caso `leads_seen_at` diventa adesso;
  - restituisce `new_since`.
- Così la soglia **non si sposta durante la visita**. Anche i lead portati da un giro (automatico o no) che finisce mentre la lista è aperta risultano nuovi, perché il loro `firstSeenAt` è dopo `new_since`.
- Senza ancora nessuna visita registrata (`new_since` nullo), vale la regola di oggi: l'inizio dell'ultimo giro.
- L'admin che guarda i dati di un agente non sposta mai la sua soglia.
- In `pages/Leads.tsx`, `newSince` non viene più da `onStatus` (inizio del giro) ma da questa chiamata. Filtro «nuovi», «Vedi i nuovi» e nuovi in cima alle schede di stato seguono la soglia nuova senza altri cambi.
- Il conteggio del riepilogo di un giro («N nuovi lead», `SweepResult.newCount`) resta **per giro**: dice cosa ha trovato quel giro. Il testo di `isNewLead` e dei commenti che parlano di «ultimo giro» va corretto. Va aggiornata anche la descrizione in CLAUDE.md.

### Notifiche (connettore)

- **All'avvio** di un giro automatico: «HomeRadar sta cercando i nuovi annunci in una finestra ridotta a icona», con il pulsante **«Ferma»**. «Ferma» chiama `runner.stop()` e il giro finisce `stopped`, quindi conta: niente nuovo tentativo prima della soglia successiva.
- **Alla fine** di un giro automatico, una sola notifica:
  - se un portale ha chiesto una verifica: «Idealista ha chiesto una verifica: aprilo tu» (più portali nella stessa frase). Il clic apre il sito del portale in una scheda normale;
  - altrimenti la notifica d'avvio si chiude e basta. Il conteggio dei lead nuovi si vede nel portale, la notifica non lo ripete.
- I giri manuali non mostrano notifiche: l'agente sta già guardando il portale.

### Il giro nel portale

- `sweeps` ha una colonna nuova, `auto` (0 o 1, default 0; `trigger` sarebbe una parola chiave di SQLite), scritta da `startSweep`.
- `SweepProgress` e `SweepResult` hanno `auto: boolean`. Nel riquadro del giro (`components/Sweep.tsx`) un giro automatico in corso si legge «Giro automatico in corso» e si ferma con «Ferma» come gli altri. La riga dell'ultimo giro aggiunge «· automatico».
- Nella pagina «Controllo» dell'admin, i giri della scheda dell'agente mostrano se erano automatici. Le regole verde/arancio/rosso di `controlHealth` non cambiano.

### Testi da aggiornare

- `CLAUDE.md` (descrizione del connettore e vincolo «solo quando lo lancia l'agente»), la spec del portale (§2 non obiettivi, §11) e la roadmap: tappa nuova **6c «Giro automatico»** prima della 7.
- Informativa (`pages/Privacy.tsx`): il giro parte con «Cerca» oppure da solo, se l'agente l'ha attivato. **`PRIVACY_VERSION` sale a 2**, come chiede CLAUDE.md. La riga della tappa 7 nella roadmap diventa «versione successiva». **[scelta di Claude]** Chi ha già un account non deve accettare di nuovo: oggi la versione si controlla solo all'invito, e il giro automatico è comunque spento finché l'agente non lo attiva lui, leggendo la spiegazione nel riquadro. Il flusso di nuova accettazione resta per l'informativa legale della tappa 7.
- `docs/web-store.md`: descrizione breve e lunga, scopo unico («quando l'agente lo chiede dal portale, o da solo se l'ha attivato»), motivo del permesso `idle`, `alarms` che controlla anche il giro automatico, `notifications` che ora ha tre avvisi. Sullo Store va caricata la versione nuova, che passa di nuovo in revisione.

## Lasciato a chi costruisce

- Come la funzione pura riceve i giri recenti (una query che restituisce solo quello che serve).
- Il nome esatto del campo di risposta e se `notDue` è un campo o si deduce da `sweepId: null` più `nextCheckAt`.
- Dove mettere nel connettore la logica del «quando chiedere»: un modulo nuovo (`auto.ts`), con le API del browser passate come dipendenze come in `runner.ts` e `queue.ts`, testato a unità.
- I tempi di prova per gli e2e (`WXT_SWEEP_FAST=1`): attesa dopo l'avvio e intervallo dell'allarme ridotti in `timing.ts`.
- Testi esatti delle notifiche e del riquadro nelle impostazioni, nel tono di quelli esistenti.
