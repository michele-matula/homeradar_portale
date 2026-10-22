-- Codici monouso per collegare il connettore dal portale: solo l'hash, validi 5 minuti.
CREATE TABLE link_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX link_codes_user ON link_codes(user_id);
