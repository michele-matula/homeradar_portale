# Pagina dei lead in stile idealista

Data: 2026-10-25. Bozze approvate (nel visual companion): `.superpowers/brainstorm/1272-1792927135/content/layout.html` e `detail.html` (cartella ignorata da git, solo riferimento locale).

## Perché

Primo riscontro del pilota sulla pagina dei lead: la lista è **troppo fitta, si legge male e non è paginata**. Il consiglio è una grafica come quella di idealista (es. `idealista.it/vendita-case/salerno-salerno/?ordine=da-privati-asc`): lista centrale con elementi grandi, filtri a sinistra, dettaglio al clic.

Secondo punto del tester: **un lead appena scoperto deve saltare all'occhio**. È il candidato migliore da chiamare subito, e oggi si confonde con quelli già visti.

Come lavora l'agente: apre la lista, sceglie un lead, ne cambia stato, nota o richiamo, **torna alla lista** e ne sceglie un altro. Non scorre da un lead al successivo.

## Obiettivi

- Lista leggibile: schede grandi con foto, una sotto l'altra, 25 per pagina.
- Filtri sempre visibili in una colonna a sinistra.
- Lead nuovi dell'ultimo giro evidenti e in cima.
- Dettaglio in una finestra grande sopra la lista. Chiudendola, la lista è esattamente com'era.

## Non obiettivi

- Nessun dato nuovo: le informazioni sui lead vanno bene così (parole dell'utente). Non cambia cosa si salva né l'informativa (`PRIVACY_VERSION` resta).
- Nessuna paginazione lato server: `GET /api/leads` continua a mandare tutto e filtri, ordinamento e pagine restano nel browser.
- Niente navigazione "lead precedente/successivo" dentro la finestra.
- Nessun cambio alle pagine admin, alle impostazioni e al connettore.

## Da evitare (sarebbe un fallimento anche se funziona)

- Un "nuovo" che segna anche immobili già noti (ripubblicati o comparsi su un altro portale): il tester tornerebbe a non fidarsi del segno.
- Chiudere il dettaglio e ritrovarsi in cima alla pagina 1 o con i filtri azzerati.
- Una scheda della lista fitta come la riga di oggi, solo più larga.

## Vincoli

- Stessi vincoli del repository (CLAUDE.md). La parte web parla col server solo tramite `src/api.ts` e non usa librerie di routing (`src/router.ts`).
- Mantenere l'accessibilità che c'è oggi: ruoli delle schede di stato, `aria-pressed`/`aria-checked` sui filtri, etichette dei link.
- Testi in italiano.

## Cosa è stato deciso

### Definizione di "nuovo" (decisa dall'utente)

Un lead è **nuovo se non c'era nella lista prima dell'ultimo giro**. Esempio dell'utente: prima del giro ci sono 266 lead, il giro ne porta 270, i 4 in più sono nuovi.

- Precisato dall'utente: **nuovo = annuncio mai visto prima dal sistema che entra tra i lead perché rispetta le configurazioni** (es. online da almeno 120 giorni). In pratica: il lead è nella lista (le regole di oggi, `isListed` e zona, non cambiano) e il **più vecchio** `firstSeenAt` tra tutti gli annunci del gruppo (`listing` e `others`, annunci precedenti compresi) è maggiore o uguale all'inizio dell'ultimo giro dell'agente.
- Un annuncio già visto che entra nella lista perché supera i 120 giorni o viene ribassato **non è nuovo** (deciso dall'utente). Se è ribassato ha l'etichetta "Ribassato".
- Un immobile già nel gruppo che compare su un altro portale o viene ripubblicato **non è nuovo** (deciso dall'utente). Mantiene le sue etichette di oggi ("Su 2 portali", "Ripubblicato").
- Gli annunci appena pubblicati e senza segnali restano fuori dalla lista come oggi. Non è un obiettivo mostrarli.
- *Limite accettato (mia scelta):* con l'archivio condiviso, un annuncio trovato dal giro di un altro agente prima del giro più recente di questo agente non risulta nuovo per lui. Nel pilota c'è un solo agente.
- Resta nuovo fino al giro successivo, anche se nel frattempo l'agente lo apre o ne cambia lo stato. Se non si lanciano giri, resta nuovo.
- Riferimento: l'inizio del giro in corso se ce n'è uno, altrimenti l'inizio dell'ultimo giro finito (`SweepStatus.running.startedAt` / `SweepStatus.last.startedAt` da `GET /api/sweep`). Nessun giro, nessun nuovo. *Mia scelta:* quando parte un giro, i nuovi del giro prima perdono subito il segno.
- La regola va in **una sola funzione condivisa** in `packages/shared/src/core/lead-groups.ts` (accanto a `seenSince`, es. `isNewLead(v, since)`), usata dalla parte web e dal server. Oggi `newLeadsSince` in `apps/server/src/sweeps.ts` usa `seenSince` (basta un annuncio visto dopo) e quindi conta anche i ripubblicati: va allineato, così il numero "N nuovi lead" del giro coincide con i segni nella lista. *Mia scelta:* il conteggio prende tutti i lead nuovi, di qualunque stato, come il segno nella lista (oggi conta solo quelli con stato `new`). *Mia scelta:* il conteggio approssimato durante il giro (`progress`, conta gli annunci) resta com'è.

### Rinomina dello stato "Nuovo" (mia scelta, mostrata e accettata)

Lo stato `new` si chiama **"Da lavorare"** (scheda della lista e bottone nel dettaglio), così "nuovo" vuol dire solo "trovato dall'ultimo giro". Si cambiano `STATUS_LABELS.new` in `packages/shared/src/core/leads.ts` (vale anche per la colonna "Stato" dell'esportazione) e `TAB_LABELS.new` in `apps/web/src/leads/filters.ts`. Il valore `new` nei dati non cambia.

### Disposizione della pagina (bozza `layout.html`, approvata)

- **Colonna sinistra** (circa 270 px): in alto il riquadro del giro (ultimo giro, quanti nuovi, "Avvia il giro", stati di avanzamento ed esito come oggi), sotto i filtri **sempre aperti**, a gruppi con titolo e conteggio per opzione. I gruppi sono quelli di oggi: priorità, comune, prezzo (min/max e "solo trattativa riservata"), tipologia, portale (con "Su più portali"), "Non più visti". Il cassetto apri/chiudi e la preferenza `filtersOpen` in `prefs.ts` spariscono su schermo largo. "Azzera filtri" resta in cima alla colonna quando c'è un filtro attivo.
- **Centro:** schede di stato in alto (Richiami, Da lavorare, Da contattare, Contattati, Scartati, coi conteggi e il rosso dei richiami da fare), poi la ricerca, una riga con il numero di lead e l'ordinamento a tendina, poi la lista.
- **Scheda del lead nella lista:** foto a sinistra (circa 300 × 210, con `Cover` com'è oggi: copertine in ordine, riquadro neutro se mancano). A destra, in quest'ordine: prezzo in grande (con il prezzo precedente barrato e la percentuale se c'è stato un ribasso), titolo, riga con locali · m² · comune/zona (dati che ci sono già ma oggi la lista non mostra; *mia scelta*, accettata), motivi (`evaluation.reasons`), etichette (priorità, "Ribassato −N%" quando `evaluation.dropPercent` supera la soglia di ribasso, portali, "Su N portali", "Ripubblicato", "Non più visto dal…", richiamo). Tutta la scheda è il link che apre il dettaglio. *Mia scelta:* il piccolo grafico dei prezzi (`Sparkline`) resta nella scheda.
- **Nuovi:** bordo verde spesso con alone e la scritta "NUOVO" sulla foto. In ogni scheda di stato i nuovi stanno **in cima, in un gruppo con titolo** ("Nuovi dall'ultimo giro · N"), poi "Altri lead · N". Dentro ciascun gruppo vale l'ordinamento scelto. Il gruppo dei nuovi non compare se è vuoto. Il verde dei nuovi è un colore distinto dal rosso della priorità alta e dal colore del marchio.
- **"Mostra i nuovi"** del riquadro di fine giro diventa il filtro **"Solo nuovi"** tra i filtri (sostituisce `since` e il chip "Da questo giro"). Il bottone di fine giro attiva quel filtro.
- **Paginazione:** 25 lead per pagina, con numeri di pagina e frecce in fondo e "Lead 1–25 di 182". La pagina 1 contiene prima i nuovi. Cambiando filtro, ricerca, scheda di stato o ordinamento si torna alla pagina 1. Cambiando pagina si torna in cima alla lista.
- **Sotto i 900 px:** la colonna sinistra non c'è più. Il riquadro del giro va sopra la lista e i filtri si aprono da un bottone "Filtri (N)" in un pannello. Le schede della lista mettono la foto sopra il testo.

### Dettaglio del lead (bozza `detail.html`, approvata; finestra scelta dall'utente)

- **Finestra grande sopra la lista** (larghezza massima circa 1040 px, sfondo scurito), aperta sull'indirizzo `/lead/<chiave>` come oggi. Si chiude con ✕, Esc, clic fuori o "indietro" del browser. Alla chiusura la lista resta com'era: filtri, scheda di stato, pagina e posizione di scorrimento. Mentre la finestra è aperta la pagina sotto non scorre, il fuoco resta nella finestra e alla chiusura torna alla scheda da cui si era partiti. Un `/lead/<chiave>` aperto direttamente (link, ricarica) mostra la finestra sopra la lista. Se il lead non c'è (più), si torna alla lista come succede oggi.
- **In alto:** foto grande a sinistra (link all'annuncio, come oggi). A destra le etichette, il prezzo molto grande, il titolo, l'indirizzo (indirizzo · zona · città), una riga di dati in evidenza (m², locali, prezzo al m² calcolato da prezzo e superficie; *mia scelta*, accettata) e il bottone "Apri l'annuncio su <portale> ↗". C'è la scritta "NUOVO" se il lead è nuovo.
- **Sotto a sinistra**, le sezioni di oggi nello stesso ordine: Perché è un lead, Storico prezzi, Mercato, Stesso immobile (con Apri e Separa).
- **Sotto a destra**, il riquadro "Il tuo lavoro", che resta visibile scorrendo la finestra. Contiene lo **stato a quattro bottoni** (Da lavorare, Da contattare, Contattato, Scartato) al posto della tendina, i **richiami rapidi sempre visibili** (le scorciatoie `RECALL_SHORTCUTS` e "Scegli data…"; con un richiamo già fissato mostra data, "Fatto" e "Sposta…" come oggi), poi le note e la frase sulla privacy. Il comportamento di salvataggio non cambia: coda dei salvataggi, nota salvata uscendo dal campo e alla chiusura, errori.
- In alto nella finestra c'è una riga con la posizione ("Lead 3 di 25 · pagina 1") e la ✕.
- **Sul telefono** la finestra prende tutto lo schermo e "Il tuo lavoro" va sotto i dati principali.

## Lasciato a chi costruisce

- Struttura dei componenti: come dividere `LeadList`, `LeadRow`, `LeadDetail` e `Leads.tsx`, e se il calcolo della pagina va in `leads/filters.ts`, che è logica pura e testata (consigliato).
- Come far arrivare a `Leads.tsx` l'inizio dell'ultimo giro, oggi letto solo dentro `Sweep.tsx`.
- Misure esatte, ombre e spaziature, partendo dalle bozze e dai colori di `styles.css`.
- Se tenere in `localStorage` la pagina corrente (non richiesto, l'ordinamento per scheda lo è già).
- Aggiornare i test esistenti (`leads.test.tsx`, `lead-detail.test.tsx`, `filters.test.ts`, `sweep.test.tsx`, e2e di `apps/web`) e aggiungere quelli per la regola dei nuovi (ripubblicato e nuovo portale **non** nuovi), la paginazione e la chiusura della finestra che conserva la lista.
- Aggiungere la tappa alla roadmap (`docs/roadmap.md`), prima del lancio.
