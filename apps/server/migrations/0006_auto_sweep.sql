-- Giro automatico: impostazioni dell'agente, giri segnati come automatici, visite della lista per i lead nuovi.
ALTER TABLE user_settings ADD COLUMN auto_sweep INTEGER NOT NULL DEFAULT 0;
-- NULL = una volta al giorno; altrimenti ogni 3, 4, 6 o 8 ore.
ALTER TABLE user_settings ADD COLUMN auto_sweep_hours INTEGER;
ALTER TABLE sweeps ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','auto'));
-- Ultima apertura della lista dei lead e soglia del «nuovo» della visita in corso.
ALTER TABLE users ADD COLUMN leads_seen_at INTEGER;
ALTER TABLE users ADD COLUMN new_since INTEGER;
