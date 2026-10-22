-- Errori di portale, connettore e server raggruppati; quota oraria contro le valanghe; motivo delle ricerche in errore.
CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('portal','connector','server')),
  version TEXT NOT NULL,
  message TEXT NOT NULL,
  -- '' = nessuno. Niente chiavi esterne: un connettore revocato non fa perdere i suoi errori.
  user_id TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  device_name TEXT,
  context TEXT,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  UNIQUE (source, version, message, user_id, device_id)
);
CREATE INDEX errors_last ON errors(last_at);
CREATE INDEX errors_user ON errors(user_id, last_at);
CREATE TABLE error_quota (
  bucket TEXT NOT NULL,
  hour INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (bucket, hour)
);
ALTER TABLE search_runs ADD COLUMN reason TEXT;
