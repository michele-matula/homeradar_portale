-- Archivio condiviso: nessun riferimento all'agente che ha visto l'annuncio.
CREATE TABLE listings (
  key TEXT PRIMARY KEY,
  portal TEXT NOT NULL,
  portal_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  address TEXT,
  city TEXT,
  city_norm TEXT,
  zone TEXT,
  typology TEXT,
  category TEXT NOT NULL,
  surface_m2 REAL,
  rooms INTEGER,
  current_price REAL,
  portal_created_at INTEGER,
  estimated_created_at INTEGER,
  last_drop TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  seen_count INTEGER NOT NULL,
  sweep_scope TEXT,
  scope_istat TEXT,
  missed_sweeps INTEGER NOT NULL DEFAULT 0,
  missing_since INTEGER,
  cover_url TEXT
);
CREATE INDEX listings_scope_istat ON listings(scope_istat, category);
CREATE INDEX listings_city ON listings(city_norm, category);
CREATE INDEX listings_sweep_scope ON listings(sweep_scope);
CREATE TABLE price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_key TEXT NOT NULL REFERENCES listings(key) ON DELETE CASCADE,
  price REAL NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('observed','declared')),
  UNIQUE (listing_key, at)
);
CREATE TABLE calibration_points (
  portal TEXT NOT NULL,
  portal_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (portal, portal_id)
);

-- Connettori collegati.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  version TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX devices_user ON devices(user_id);

-- Giri e ricerche: alla cancellazione dell'agente restano anonimi.
CREATE TABLE sweeps (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT CHECK (outcome IN ('completed','partial','stopped','interrupted')),
  drops INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  result TEXT
);
CREATE INDEX sweeps_user ON sweeps(user_id, started_at);
CREATE TABLE search_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sweep_id TEXT NOT NULL REFERENCES sweeps(id) ON DELETE CASCADE,
  search_key TEXT NOT NULL,
  portal TEXT NOT NULL,
  spec TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','complete','capped','blocked','error','notFound','skipped')),
  started_at INTEGER,
  finished_at INTEGER,
  pages INTEGER NOT NULL DEFAULT 0,
  pages_received INTEGER NOT NULL DEFAULT 0,
  privates INTEGER NOT NULL DEFAULT 0,
  missing_applied INTEGER NOT NULL DEFAULT 0,
  UNIQUE (sweep_id, search_key)
);
CREATE INDEX search_runs_key ON search_runs(search_key, status);
CREATE TABLE run_seen (
  run_id INTEGER NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  listing_key TEXT NOT NULL,
  PRIMARY KEY (run_id, listing_key)
);
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX batches_device ON batches(device_id, received_at);

-- Dati privati dell'agente: si cancellano con l'account.
CREATE TABLE lead_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new','to_contact','contacted','discarded')),
  notes TEXT NOT NULL DEFAULT '',
  status_changed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  recall_at INTEGER,
  PRIMARY KEY (user_id, listing_key)
);
CREATE TABLE splits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, a, b)
);
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  min_age_days INTEGER NOT NULL,
  min_drop_percent REAL NOT NULL,
  categories TEXT NOT NULL,
  enabled_portals TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
