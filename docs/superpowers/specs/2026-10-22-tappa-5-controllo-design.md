# Tappa 5 — Controllo: design

Data: 2026-10-22. Completa la §6.6–6.7 dell'architettura (`2026-10-21-homeradar-portale-design.md`) per quello che serve adesso. Dove questo documento e l'architettura divergono, vale questo documento.

## Perché

Michele deve poter capire **da solo, aprendo il pannello**, se i piloti stanno usando il sistema e se funziona sui loro PC, senza chiedere niente a loro. Le domande a cui il pannello deve rispondere, nelle sue parole:

1. Il portale ha generato errori?
2. Il pilota ha installato il connettore? Se ne ha installati più di uno, quali?
3. I connettori sono installati correttamente? Cioè: **quando hanno contattato il server l'ultima volta** e **la prova che abbiano completato almeno un giro senza errori**.
4. I connettori generano errori? Quali?
5. Data e ora delle ricerche fatte dai piloti (basta l'ultima, se i dati sono troppi).
6. Le ricerche hanno generato errori?

Successo: aprendo il pannello, in pochi secondi si vede quale agente ha un problema e, con un clic, quale.

## Obiettivi

- Pagina admin **«Controllo»** (scelta A delle bozze): una riga per agente, con verde/arancio/rosso, clic per la scheda dell'agente.
- Pagina admin **«Errori»**: tutti gli errori raggruppati.
- Errori di **portale, connettore e server** salvati sul server.
- Il connettore si fa sentire anche fuori dai giri, così «ultimo contatto» e versione sono veri.
- Revoca dei connettori dall'admin.

## Non obiettivi (rinviati)

- **Avvisi** (mail, notifiche): per ora basta trovare i problemi aprendo il pannello.
- **«Vedi come l'agente»** e **parametri regolabili** dall'interfaccia: non servono ora. `admin_audit` quindi non si crea.
- **Eventi d'uso** (`usage_events`): non si crea la tabella. L'uso si vede da ultimo accesso (`users.last_seen_at`, c'è già) e numero di giri (da `sweeps`).
- «Segna come risolto» sugli errori, ricerca testuale, grafici.

## Anti-obiettivi

- Nessun dato degli annunci, nessun nome o telefono negli errori: ogni messaggio passa da `sanitizeError` **sul server** (il client può anche ripulire, ma non ci si fida).
- Il pannello non deve mostrare un connettore come sano se non lo è: nel dubbio, arancio.
- Le note degli agenti non compaiono mai nel pannello.

## Pagina «Controllo» (`/admin/controllo`)

Menu admin: Lead · Utenti · Controllo · Errori. «Utenti» resta com'è (creare, modificare, sospendere, eliminare).

Tabella, una riga per agente (solo ruolo `agent`; sospesi in fondo o attenuati):

| Colonna | Contenuto |
|---|---|
| Agente | email |
| Ultimo accesso | `users.last_seen_at` |
| Connettori | quanti, più il caso peggiore (es. «2 · uno muto da 9 gg», «nessuno») |
| Ultimo giro | data e ora, esito, e se ci sono ricerche con problemi (es. «2 ricerche bloccate») |
| Errori 7 gg | quanti errori (connettore e portale) di quell'agente negli ultimi 7 giorni |

Colori **[scelta di Claude]**, tutti in un'unica funzione pura testata così si cambiano in un punto:
- **Rosso**: nessun connettore; oppure nessun connettore con un giro riuscito; oppure mai fatto un giro.
- **Arancio**: un connettore senza contatto da più di 7 giorni; l'ultimo giro non `completed` o con ricerche `blocked`/`error`; errori negli ultimi 7 giorni; ultimo accesso oltre 7 giorni.
- **Verde**: il resto.

### Scheda dell'agente (`/admin/controllo/<userId>`)

- **Connettori**: nome (browser e sistema), versione, collegato il, **ultimo contatto**, **ultimo giro riuscito** (o «nessun giro riuscito» in rosso), pulsante **Revoca** (con conferma; stessa logica di quando l'agente lo scollega: chiude i suoi giri aperti e cancella il dispositivo).
- **Ultimo giro**: data e ora di inizio e fine, esito, connettore che l'ha fatto, e la lista delle ricerche con portale, comune, categoria, esito, pagine, privati e, se c'è, il motivo dell'errore.
- **Giri precedenti**: elenco compatto (data, esito, ricerche con problemi), ultimi 20 **[scelta di Claude]**; clic per aprirne le ricerche.
- **Errori dell'agente**: gli stessi gruppi della pagina «Errori», filtrati su di lui.

**Giro riuscito** = giro con `outcome = 'completed'` e nessuna ricerca `blocked` o `error`. «Ultimo giro riuscito» del connettore = il più recente di questi con quel `device_id` (`sweeps.device_id` esiste già; diventa `NULL` alla revoca).

Un agente appena creato, senza connettore, è rosso: deve ancora fare qualcosa. Un connettore il cui browser resta chiuso per più di 7 giorni diventa arancio, perché vuol dire che non viene usato **[scelta di Claude]**.

## Pagina «Errori» (`/admin/errori`)

Tabella ordinata per ultima occorrenza: provenienza (portale, connettore, server), messaggio ripulito, versione, volte, prima, ultima, agenti coinvolti. Filtro per provenienza. Clic su una riga: dettaglio con pagina/contesto e agenti. Si vedono gli ultimi 90 giorni.

## Raccolta degli errori

Tabella nuova `errors` (migrazione nuova): una riga per gruppo (provenienza, versione, messaggio ripulito, utente, dispositivo), con `count`, `first_at`, `last_at` e il contesto più recente (pagina del portale o portale/ricerca del connettore). Arrivo di un errore uguale = `count + 1` e `last_at` aggiornato. Pulizia dei gruppi con `last_at` oltre 90 giorni, accanto alle pulizie esistenti **[scelta di Claude]**. Alla cancellazione dell'agente i suoi gruppi restano con utente e dispositivo azzerati (come `search_runs`).

`user_id` e `device_id` di `errors` sono id semplici, senza chiave esterna verso `devices`, e la riga tiene anche il nome del dispositivo al momento dell'errore. Così un connettore revocato non fa perdere i suoi errori: la pagina lo mostra come «connettore revocato» **[scelta di Claude]**. Gli errori del portale senza sessione non hanno agente: compaiono nella pagina «Errori» ma non nella colonna «Errori 7 gg» di nessun agente. La pagina «Errori» mostra una riga per (provenienza, versione, messaggio), sommando i gruppi in SQL, con gli agenti coinvolti elencati **[scelta di Claude]**.

Limiti contro le valanghe **[scelta di Claude]**: messaggio al più 200 caratteri (già in `sanitizeError`); al più 20 errori per richiesta; al più 100 errori l'ora per sessione o dispositivo e 30 l'ora per IP senza sessione (riusa `rate-limit.ts`); oltre il limite si scarta in silenzio. Se l'invio di un errore fallisce non si ritenta e non si segnala come errore, così non si va in ciclo.

**Portale** → `POST /api/errors`: errori non gestiti (`window.onerror`, `unhandledrejection`), un error boundary di React con una schermata «Qualcosa non va, ricarica», e le risposte 5xx o di rete delle API. Non i 4xx (sono errori dell'utente, già mostrati in italiano). Funziona anche senza sessione (pagina di accesso), con limite per IP; con sessione si lega all'agente. Versione = hash del commit iniettato al build.

**Connettore** → `POST /connector/errors` (token del dispositivo): errori del runner, dei content script (oggi in `console.warn`), invii scartati dalla coda, ricerche finite con `error`. Si tengono in un piccolo buffer persistente (al più 50, i più vecchi si scartano), mandati insieme alla coda ma **senza bloccarla** e senza ritentare oltre 24 ore. Versione = versione del manifest.

**Server**: il `catch` di `src/index.ts` scrive anche nella tabella (provenienza `server`, rotta senza parametri come contesto). Se scrivere fallisce, resta solo la console.

**Errori delle ricerche (domanda 6)**: l'esito di ricerca del connettore accetta un `reason` facoltativo, breve e ripulito sul server; si salva in una colonna nuova di `search_runs` e si mostra nella scheda dell'agente.

## Connettore: contatto e versione

- All'avvio del browser e una volta al giorno (alarm) il connettore chiama `POST /connector/hello` con versione e nome. Il server aggiorna `last_seen_at` (come oggi, al più ogni tanto) e **versione e nome** del dispositivo, che oggi si scrivono solo al collegamento.
- 401 = scollegato, come per la coda.

## Punti minori rinviati che rientrano qui

- **Ricollegare un browser già collegato** crea un dispositivo nuovo e lascia il vecchio, che comparirebbe come connettore muto: al collegamento il connettore manda anche il token vecchio, se ce l'ha, e il server sposta i giri di quel dispositivo sul nuovo (è lo stesso browser, quindi la storia dei giri riusciti resta) e cancella il vecchio, se è dello stesso utente **[scelta di Claude]**.
- **`openWindow` fallisce dopo il piano**: il giro resta aperto 15 minuti; il runner mette in coda la fine `interrupted` e un errore.
- **Limite per utente ai codici di collegamento** (riusa `rate-limit.ts`).

Gli altri minori delle tappe 2–4 restano dove sono.

## Informativa

Si salvano dati nuovi (errori legati all'agente e al computer). L'informativa oggi è un segnaposto («Testo in preparazione») e non c'è un passaggio per riaccettarla: `PRIVACY_VERSION` resta 1 e gli errori raccolti si aggiungono all'elenco di cosa l'informativa della tappa 6 deve dire (roadmap).

## Vincoli

Quelli di CLAUDE.md: rotte admin solo per il ruolo `admin`; liste SQL con `json_each`; migrazione nuova, non modificare le vecchie; timestamp in ms epoch UTC; errori delle API in italiano; nessun segreto nel codice; test del server con il runtime Workers e D1 locale; test unitari del connettore con le API del browser come dipendenze.

## Lasciato a chi costruisce

Forma delle API admin e dei tipi in `packages/shared/src/api/types.ts`; query (una per la tabella «Controllo» è preferibile a N per agente); componenti React e stile, coerenti con `AdminUsers.tsx`; dove esattamente agganciare gli errori nel connettore; come iniettare l'hash del commit nella build web e nel Worker. La build e il deploy si fanno in locale (`docs/deploy.md`), quindi un comando git al build va bene.
