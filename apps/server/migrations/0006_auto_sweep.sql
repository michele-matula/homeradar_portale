-- Giro automatico: impostazioni dell'agente, giri segnati come automatici, visite della lista per i lead nuovi.
ALTER TABLE user_settings ADD COLUMN auto_sweep INTEGER NOT NULL DEFAULT 0;
-- NULL = una volta al giorno; altrimenti ogni 3, 4, 6 o 8 ore.
ALTER TABLE user_settings ADD COLUMN auto_sweep_hours INTEGER;
-- 1 = giro partito da solo (giro automatico).
ALTER TABLE sweeps ADD COLUMN auto INTEGER NOT NULL DEFAULT 0 CHECK (auto IN (0, 1));
-- Portali che hanno chiesto una verifica all'agente nelle ultime 24 ore (a ogni giro automatico dovuto).
CREATE INDEX search_runs_user_blocked ON search_runs(user_id, status, finished_at);
-- Ultima apertura della lista dei lead e soglia del «nuovo» della visita in corso.
ALTER TABLE users ADD COLUMN leads_seen_at INTEGER;
ALTER TABLE users ADD COLUMN new_since INTEGER;
