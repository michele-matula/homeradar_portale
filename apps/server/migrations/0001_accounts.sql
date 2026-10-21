CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('agent','admin')),
  status TEXT NOT NULL CHECK (status IN ('invited','active','suspended')),
  comuni TEXT NOT NULL DEFAULT '[]',
  max_comuni INTEGER NOT NULL,
  privacy_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX tokens_user ON tokens(user_id);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempts_email ON login_attempts(email, at);
CREATE INDEX login_attempts_ip ON login_attempts(ip, at);
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO config (key, value) VALUES ('freshness_minutes', '60'), ('default_max_comuni', '4');
