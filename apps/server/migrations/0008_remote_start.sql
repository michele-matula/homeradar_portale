-- Avvio dal telefono: nome scelto e interruttore per computer, richiesta dell'agente, giri avviati dal telefono e stop da remoto.
-- Nome scelto dall'agente; NULL = quello automatico (`name`), che il connettore aggiorna.
ALTER TABLE devices ADD COLUMN label TEXT;
-- 1 = «Avvia dal telefono» attivo su questo computer.
ALTER TABLE devices ADD COLUMN remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1));
-- Ultimo controllo delle richieste (`POST /connector/remote`): dice se il computer è online.
ALTER TABLE devices ADD COLUMN polled_at INTEGER;
-- 1 = giro avviato dal telefono.
ALTER TABLE sweeps ADD COLUMN remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1));
-- 1 = «Ferma» premuto dal telefono: il connettore lo legge nella risposta ai lotti o al controllo.
ALTER TABLE sweeps ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1));
-- Ultima richiesta di giro dal telefono, una per agente. La prende il primo computer abilitato che controlla.
CREATE TABLE remote_requests (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  claimed_at INTEGER,
  outcome TEXT CHECK (outcome IN ('started', 'fresh', 'busy', 'failed', 'cancelled')),
  sweep_id TEXT
);
