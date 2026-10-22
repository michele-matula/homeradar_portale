# Roadmap del portale

Architettura: `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md`. Un piano per tappa; ogni tappa lascia software funzionante e testato. Si riparte dal primo punto "da fare".

| # | Tappa | Piano | Stato |
|---|---|---|---|
| 1 | Fondamenta e account: monorepo, logica condivisa copiata dall'estensione, Worker con D1, accesso, inviti, reimpostazione password, admin utenti, portale minimo | `docs/superpowers/plans/2026-10-21-portale-01-fondamenta-account.md` | fatto |
| 2 | Archivio: ingest lato server, piano delle ricerche, `search_runs`, freschezza, "non più visto" con più agenti, lettura dei lead per agente, stati/note/richiami/separazioni, impostazioni dell'agente | `docs/superpowers/plans/2026-10-21-portale-02-archivio.md` | fatto |
| 3 | Connettore: estensione senza interfaccia, collegamento dal portale con codice monouso, giro lanciato dal portale e solo nella scheda del giro, coda d'invio con tentativi che manda lotti ed esiti nell'ordine in cui nascono; «Cerca», stato minimo del giro e computer collegati nel portale | `docs/superpowers/plans/2026-10-22-portale-03-connettore.md` | fatto |
| 4 | Portale: lista e scheda lead, filtri, richiami, esportazione, impostazioni, layout telefono, avanzamento completo del giro | `docs/superpowers/plans/2026-10-22-portale-04-portale.md` | fatto |
| 5 | Controllo: eventi d'uso, errori di portale/connettore/server (il connettore oggi li scrive solo nella console), admin completo (ricerche, uso, errori, revoca dei dispositivi, "vedi come l'agente", parametri) | da scrivere | da fare |
| 6 | Lancio: informativa (deve dire: archivio condiviso degli annunci di privati; stati, note, richiami e impostazioni privati dell'agente, cancellati con l'account; giri e ricerche resi anonimi alla cancellazione; computer collegati: nome del browser e del sistema, versione, ultimo uso; il connettore legge i portali solo durante il giro e solo nella scheda del giro), pubblicazione del connettore (non in elenco; chiave e ID del Web Store al posto di quelli di prova, link d'installazione nel portale), dominio e mail automatiche, deploy di produzione; e2e del portale invito → accesso → lead (spec §9: la tappa 4 lo copre solo con i test dei componenti) | da scrivere | da fare |
| 7 | Parere legale sull'archivio condiviso → primo cliente | — | da fare |
