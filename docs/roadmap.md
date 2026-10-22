# Roadmap del portale

Architettura: `docs/superpowers/specs/2026-10-21-homeradar-portale-design.md`. Un piano per tappa; ogni tappa lascia software funzionante e testato. Si riparte dal primo punto "da fare".

| # | Tappa | Piano | Stato |
|---|---|---|---|
| 1 | Fondamenta e account: monorepo, logica condivisa copiata dall'estensione, Worker con D1, accesso, inviti, reimpostazione password, admin utenti, portale minimo | `docs/superpowers/plans/2026-10-21-portale-01-fondamenta-account.md` | fatto |
| 2 | Archivio: ingest lato server, piano delle ricerche, `search_runs`, freschezza, "non più visto" con più agenti, lettura dei lead per agente, stati/note/richiami/separazioni, impostazioni dell'agente | `docs/superpowers/plans/2026-10-21-portale-02-archivio.md` | fatto |
| 3 | Connettore: estensione senza interfaccia, collegamento dal portale con codice monouso, giro lanciato dal portale e solo nella scheda del giro, coda d'invio con tentativi che manda lotti ed esiti nell'ordine in cui nascono; «Cerca», stato minimo del giro e computer collegati nel portale | `docs/superpowers/plans/2026-10-22-portale-03-connettore.md` | fatto |
| 4 | Portale: lista e scheda lead, filtri, richiami, esportazione, impostazioni, layout telefono, avanzamento completo del giro | `docs/superpowers/plans/2026-10-22-portale-04-portale.md` | fatto |
| 5 | Controllo: pagina «Controllo» (una riga per agente con verde/arancio/rosso; scheda con connettori, ultimo contatto, ultimo giro riuscito, giri e ricerche, revoca), pagina «Errori» (portale, connettore, server), contatto quotidiano del connettore. Design: `docs/superpowers/specs/2026-10-22-tappa-5-controllo-design.md`. Rinviati: "vedi come l'agente", parametri regolabili, eventi d'uso completi, avvisi | `docs/superpowers/plans/2026-10-22-portale-05-controllo.md` | fatto |
| 6 | Pronti per il pilota: minori dell'uso quotidiano, informativa minima, connettore sul Chrome Web Store («Non in elenco»), e2e invito → accesso → lead; dopo l'approvazione ID e link dello Store. Design: `docs/superpowers/specs/2026-10-22-tappa-6-pilota-design.md` | `docs/superpowers/plans/2026-10-22-portale-06-pilota.md` | da fare |
| 7 | Lancio (dopo i riscontri del pilota): dominio, mail automatiche, informativa legale (`PRIVACY_VERSION` 2), altri minori rinviati | — | da fare |
| 8 | Parere legale sull'archivio condiviso → primo cliente | — | da fare |
