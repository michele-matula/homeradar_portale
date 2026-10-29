-- Online al massimo (giorni): oltre, un immobile rientra tra i lead solo se cambia prezzo. NULL = nessun limite.
ALTER TABLE user_settings ADD COLUMN max_age_days INTEGER;
