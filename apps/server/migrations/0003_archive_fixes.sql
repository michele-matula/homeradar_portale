-- Ultima lettura di un annuncio: lastSeenAt resta fermo dentro una visita di 30 minuti e non basta per i lotti in ritardo.
ALTER TABLE listings ADD COLUMN last_read_at INTEGER;
-- Pagine distinte ricevute per ricerca: una pagina riletta non conta due volte.
CREATE TABLE run_pages (
  run_id INTEGER NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  PRIMARY KEY (run_id, page)
);
-- Un solo giro aperto per agente, anche con due avvii nello stesso istante.
CREATE UNIQUE INDEX sweeps_one_open ON sweeps(user_id) WHERE finished_at IS NULL;
