# Roadmap del portale

Architettura: `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md`. Un piano per tappa; ogni tappa lascia software funzionante e testato. Si riparte dal primo punto "da fare".

| # | Tappa | Piano | Stato |
|---|---|---|---|
| 1 | Fondamenta e account: monorepo, logica condivisa copiata dall'estensione, Worker con D1, accesso, inviti, reimpostazione password, admin utenti, portale minimo | `docs/superpowers/plans/2026-10-21-portale-01-fondamenta-account.md` | da fare |
| 2 | Archivio: ingest lato server, piano delle ricerche, `search_runs`, freschezza, "non più visto" con più agenti, lettura dei lead per agente, stati/note/richiami/separazioni, impostazioni dell'agente | da scrivere | da fare |
| 3 | Connettore: estensione senza interfaccia, collegamento dal portale, giro lanciato dal portale e solo nella scheda del giro, coda d'invio con tentativi | da scrivere | da fare |
| 4 | Portale: lista e scheda lead, filtri, richiami, esportazione, impostazioni, layout telefono, avanzamento del giro | da scrivere | da fare |
| 5 | Controllo: eventi d'uso, errori di portale/connettore/server, admin completo (ricerche, uso, errori, "vedi come l'agente", parametri) | da scrivere | da fare |
| 6 | Lancio: informativa, pubblicazione del connettore (non in elenco), dominio e mail automatiche, deploy di produzione | da scrivere | da fare |
| 7 | Parere legale sull'archivio condiviso → primo cliente | — | da fare |
