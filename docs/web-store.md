# Connettore sul Chrome Web Store

Testi da incollare nella dashboard sviluppatore (https://chrome.google.com/webstore/devconsole). Il pacchetto si costruisce come in `docs/deploy.md` («Pacchetto per lo Store»): `apps/connector/.output-store/homeradarconnector-<versione>-chrome.zip`.

## Scheda dello Store

**Nome:** HomeRadar connettore

**Descrizione breve** (dal manifest): Cerca gli annunci di privati della tua zona quando lo chiedi dal portale HomeRadar

**Descrizione lunga:**

> HomeRadar connettore è il complemento del portale HomeRadar per agenti immobiliari. Non ha un'interfaccia propria: funziona solo con un account del portale.
>
> Quando l'agente preme «Cerca» nel portale, il connettore apre una finestra e percorre le ricerche della sua zona su Immobiliare.it, Idealista, Subito e CasaDaPrivato. Legge solo i risultati di quelle ricerche, solo durante il giro e solo nella scheda aperta per il giro; fuori dal giro non legge né manda niente.
>
> Su Immobiliare.it e Subito un piccolo script del connettore lavora dentro le pagine del sito, in ogni scheda, e passa al connettore i dati che il sito ha già caricato: il connettore li usa solo durante il giro, nella scheda del giro.
>
> Al portale manda solo annunci di privati, e di ognuno solo i dati dell'annuncio (link, titolo, indirizzo, comune, tipologia, superficie, locali, prezzo, data, foto di copertina). Mai numeri di telefono né nomi dei venditori.

**Categoria:** Produttività (o «Strumenti per l'attività», se disponibile).
**Lingua:** italiano.

**Immagini:** l'icona 128×128 è già nel pacchetto (`apps/connector/public/icon/128.png`). Serve almeno uno **screenshot 1280×800** del portale (lista dei lead con il riquadro «Ricerche»): da fare a mano.

## Pratiche sulla privacy

**Scopo unico:** cercare, quando l'agente lo chiede dal portale HomeRadar, gli annunci di privati della sua zona su Immobiliare.it, Idealista, Subito e CasaDaPrivato e mandarli al suo archivio nel portale.

**Motivo dei permessi:**

- `storage`: conserva il collegamento all'account del portale, la coda delle pagine lette in attesa d'invio e gli errori da segnalare.
- `alarms`: riprova gli invii non riusciti e manda al portale un contatto al giorno (versione e ultimo uso) per sapere che il connettore funziona.
- `notifications`: un solo avviso, quando i dati di un giro non riescono a partire da molto tempo (problema di connessione).
- Host `www.immobiliare.it`, `www.idealista.it`, `www.subito.it`, `www.casadaprivato.it`: leggere i risultati delle ricerche, solo nella scheda del giro lanciato dall'agente. Su Immobiliare.it e Subito uno script nella pagina (in ogni scheda) inoltra i dati che il sito ha già caricato; si usano solo nella scheda del giro.
- Host del portale (`homeradar-portale.homeradar-pilot-worker.workers.dev`): mandare gli annunci letti all'account dell'agente e ricevere dalla pagina del portale i comandi «Cerca» e «Ferma».

**Codice remoto:** no, tutto il codice è nel pacchetto.

**Dati raccolti** (da spuntare):

- *Contenuti del sito web*: gli annunci letti durante il giro (solo di privati, solo i campi elencati sopra).
- *Informazioni identificative personali*: no. *Comunicazioni personali, dati sanitari, finanziari, di posizione, cronologia web, attività dell'utente*: no.

Il connettore manda anche il nome del browser e del sistema, la versione e gli errori (ripuliti dai dati degli annunci): sono dati tecnici del funzionamento, non dell'utente.

**Dichiarazioni** (da confermare tutte): i dati non si vendono a terzi; non si usano né si trasferiscono per scopi estranei allo scopo unico; non si usano per stabilire l'affidabilità creditizia o per prestiti.

**Informativa sulla privacy:** https://homeradar-portale.homeradar-pilot-worker.workers.dev/informativa

## Distribuzione

- **Visibilità:** «Non in elenco» (si installa solo col link).
- **Paesi:** Italia.

## Istruzioni per i revisori

Il connettore non fa niente senza un account del portale. Prima dell'invio:

1. Dal portale, come admin, crea un agente di prova (es. `revisione@…`) con un comune (es. Salerno) e attivalo dal link d'invito.
2. Scrivi email e password **solo** nel campo «Istruzioni per il test» della dashboard, mai nel repository.
3. Passi da indicare: installa l'estensione, apri https://homeradar-portale.homeradar-pilot-worker.workers.dev, accedi, premi «Cerca»: il connettore si collega all'account, apre la finestra del giro e i lead compaiono nella lista.

Dopo l'approvazione l'agente di prova si può eliminare.

## Aggiornamenti

Ogni nuovo caricamento vuole una `version` più alta in `apps/connector/package.json`. Lo Store aggiorna da solo le installazioni.

## Dopo la prima approvazione

Dalla dashboard: l'**ID** dell'elemento e la **chiave pubblica** (Pacchetto → «Visualizza chiave pubblica», senza le righe `-----BEGIN/END-----`). Vanno in `apps/connector/src/key.ts` e in `CONNECTOR_ID`, con il link d'installazione nel portale: Task 8 del piano `docs/superpowers/plans/2026-10-22-portale-06-pilota.md`.
