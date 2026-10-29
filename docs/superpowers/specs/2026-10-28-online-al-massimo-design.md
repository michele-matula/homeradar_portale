# «Online al massimo» e rientro per cambio di prezzo

Data: 2026-10-28.

## Perché

Riscontro del tester del pilota. Oggi nelle impostazioni c'è solo «Online da almeno X giorni». Così entrano in lista anche annunci online da 10–14 anni, con priorità «Media» per la sola età. Per un agente sono annunci inutili: nessuno li chiama più. Diventano interessanti solo se il venditore si rimette a muoverli, per esempio cambiando il prezzo.

Il punto fermo, detto dall'utente: **l'agente deve vedere gli immobili più appetibili secondo i parametri che ha impostato, e quando un immobile entra nei parametri deve vederlo subito, perché è un potenziale contatto.**

## Come funziona oggi (per chi costruisce)

- I parametri non cambiano cosa cerca il connettore, ma solo come si valuta un annuncio (`packages/shared/src/core/rules.ts`).
- Ci sono due segnali:
  - **A, età**: l'annuncio è online da almeno `minAgeDays` giorni, con una fascia «da verificare» di ±15 giorni attorno alla soglia quando l'età è stimata.
  - **B, ribasso**: il prezzo è sceso di almeno `minDropPercent` rispetto al prezzo più alto noto.
- Con A e B la priorità è Alta, con uno dei due è Media.
- Un lead è in lista se ha una priorità, oppure se l'agente l'ha lavorato o ha un richiamo (`isListed` in `core/lead-groups.ts`).
- Un lead è «nuovo» se tutto il gruppo è stato visto per la prima volta dopo la visita precedente della lista (`isNewLead`, usata dalla pagina e dal conteggio del giro in `apps/server/src/sweeps.ts`).
- Ogni cambio di prezzo, in su o in giù, lascia uno snapshot in `price_snapshots`. Il tipo `observed` ha come data il momento in cui HomeRadar l'ha visto. Il tipo `declared` ha la data dichiarata dal portale, cioè la mezzanotte UTC del giorno del ribasso.

## Le regole nuove (decise con l'utente)

1. **Nuova impostazione «Online al massimo (giorni)»**, facoltativa: vuota vuol dire nessun limite, quindi il comportamento di oggi.
2. **L'età conta solo tra il minimo e il massimo.** Oltre il massimo l'annuncio non ha il segnale A.
3. **Un annuncio oltre il massimo rientra se ha cambiato prezzo negli ultimi 30 giorni.**
   - Un **rialzo** vale per qualsiasi importo.
   - Un **ribasso** vale se supera la soglia «Ribasso di almeno» già presente.
   - Le modifiche di descrizione o foto non contano: non le registriamo e non si comincia a farlo.
4. **Un annuncio oltre il massimo che rientra ha sempre priorità Media.** Mai Alta.
5. **Oltre il massimo, senza un cambio recente, l'annuncio è nascosto.** Si comporta come gli annunci senza priorità di oggi: resta visibile solo se l'agente l'ha già lavorato. Vale la regola di oggi di `isListed`, cioè stato diverso da «Nuovo» o un richiamo; le sole note non bastano, come oggi.
6. **Un annuncio che rientra è «nuovo».** Lo è se è rientrato dopo la visita precedente della lista, come succede per un annuncio visto per la prima volta. Vale sia per l'evidenza «nuovo» nella pagina sia per il conteggio dei nuovi del giro.

Il senso del punto 6: l'importanza dell'annuncio rientrato non sta nella priorità, ma nel fatto che l'agente lo vede comparire tra i nuovi.

## Obiettivi

- Con il massimo impostato, gli annunci vecchissimi spariscono dalla lista a meno che il prezzo non si muova.
- Un annuncio vecchio che cambia prezzo compare tra i nuovi alla prima visita della lista dopo il giro che l'ha visto.
- Chi non imposta il massimo non vede nessuna differenza.

## Non obiettivi

- Nessun cambio nel connettore o in cosa si legge e si salva. Quindi nessun aggiornamento dell'informativa né di `PRIVACY_VERSION`.
- Niente filtri sui portali nelle ricerche: il giro resta lo stesso.
- Nessuna regola nuova per gli annunci **sotto** il minimo: un rialzo non li fa entrare (oggi entrano solo con un ribasso, e resta così).
- La finestra di 30 giorni non è un'impostazione. Si potrà renderla tale dopo il pilota, se serve.

## Da evitare

- Un annuncio vecchio che resta in lista per sempre per un ribasso di anni fa.
- Un annuncio rientrato che non risulta nuovo e quindi finisce in mezzo agli altri senza che l'agente lo noti.
- Perdere di vista un lead già lavorato perché ha superato il massimo.
- Cambiare il comportamento per chi non imposta il massimo.

## Dettagli decisi da me (rivedibili)

- **Data del cambio, per la finestra di 30 giorni:** la data vera del cambio. È quella dichiarata dal portale se c'è (snapshot `declared`), altrimenti quella in cui HomeRadar l'ha visto. Un ribasso dichiarato «di 2 anni fa», visto oggi per la prima volta, non fa rientrare l'annuncio.
- **Momento del rientro, per «nuovo»:** quando HomeRadar ha saputo del cambio, non la data dichiarata. La data dichiarata è la mezzanotte del giorno e può cadere prima della visita dell'agente, anche se il giro che l'ha visto è successivo. Il momento in cui l'abbiamo saputo coincide con lo snapshot `observed` del nuovo prezzo (`mergeObservation` lo aggiunge ogni volta che il prezzo cambia) e non è mai prima della prima volta che abbiamo visto l'annuncio.
- **Cosa conta come cambio:** i cambi si ricavano dagli snapshot `observed`. Un cambio è uno snapshot `observed` con prezzo diverso da quello del precedente `observed` dello stesso annuncio (o della catena di ripubblicazione). Il primo snapshot non è un cambio. Il momento in cui l'abbiamo saputo è la data di quello snapshot.
  - Gli snapshot `declared` non creano cambi da soli: correggono solo la **data** di un cambio. Se il ribasso dichiarato porta allo stesso prezzo di un cambio osservato (`toPrice` uguale al prezzo nuovo), per la finestra dei 30 giorni conta la data dichiarata. Così il passaggio verso il prezzo «prima» di un ribasso dichiarato non diventa mai un falso rialzo, e lo stesso ribasso osservato e poi dichiarato resta un solo cambio.
  - C'è un'eccezione: un ribasso dichiarato che arriva già alla prima osservazione dell'annuncio, quando non c'è un `observed` precedente. Conta come cambio, con la data dichiarata per la finestra e la prima osservazione come momento in cui l'abbiamo saputo.
  - Per il ribasso la soglia si misura su quel singolo cambio (prezzo prima → prezzo dopo), non sul massimo storico.
- **Età vicino al massimo:** nessuna fascia «da verificare» attorno al massimo. Si usa l'età, anche se è stimata. Se l'età è sconosciuta, il massimo non si applica.
- **Validazione:** il massimo è un intero tra 1 e 3650 e deve essere maggiore del minimo. Messaggio d'errore in italiano: «Online al massimo deve essere più del minimo».
- **Gruppi (stesso immobile su più portali o ripubblicato):** «oltre il massimo» si decide per **immobile**, non per annuncio. Se il membro più vecchio del gruppo, ripubblicazioni comprese, è oltre il massimo, tutto il gruppo è oltre il massimo. Il segnale B storico allora non conta, e il gruppo è in lista solo con un cambio di prezzo recente di un annuncio vivo (Media). Così una ripubblicazione non aggira la regola: per l'utente l'unica modifica che conta è il prezzo. Il momento del rientro del gruppo è il più recente tra quelli dei membri.
- **Lead già lavorati:** un lead lavorato oltre il massimo resta in lista come oggi. Un suo cambio di prezzo non lo rende «nuovo», perché non è mai uscito. Oggi vale lo stesso per tutti i lead lavorati, e qui non cambia.
- **Testi:** nella scheda il motivo spiega il rientro, per esempio «Prezzo alzato del 5% il 12/10» oppure «Ribassato del 10% … il 12/10», e la riga dell'età resta («Online da oltre 10 anni»). Nelle impostazioni c'è un campo «Online al massimo (giorni)» sotto «Online da almeno», con un aiuto (`InfoTip`) che spiega che gli annunci più vecchi tornano in lista per 30 giorni se cambiano prezzo.

## Vincoli

- Restano quelli del repository (CLAUDE.md).
- Migrazione D1 nuova (`0007_…`) con una colonna `max_age_days` nullable in `user_settings`. Non si modificano le migrazioni esistenti.
- La logica sta in `packages/shared` (regole e `isListed`/`isNewLead`), così la usano sia il server sia la pagina.
- Timestamp in ms epoch UTC.

## Lasciato a chi costruisce

- Come portare negli `Evaluation` le informazioni sul rientro (per esempio un campo con il momento del rientro, o `null`), e come `isNewLead` le usa.
- La forma esatta dei testi e dei badge, purché sia chiaro perché l'annuncio è in lista.
- Se `minAgeDays`/`maxAgeDays` restano in `Settings` (eredità dell'estensione) o solo in `AgentSettings`/`RuleSettings`.
