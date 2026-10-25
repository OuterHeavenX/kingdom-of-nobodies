-- D1 schema for the optional Kingdom of Nobodies cloud backup service.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- 'gh:<github id>'
  login TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,    -- SHA-256 of the session token; the token itself is never stored
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saves (
  user_id TEXT NOT NULL REFERENCES users(id),
  slot TEXT NOT NULL,
  revision INTEGER NOT NULL,
  saved_at TEXT, uploaded_at INTEGER, device TEXT,
  version INTEGER, day INTEGER, year INTEGER, population INTEGER,
  checksum TEXT, bytes INTEGER, kingdom_name TEXT,
  body TEXT NOT NULL,             -- the save envelope, AES-GCM sealed when SAVE_ENCRYPTION_KEY is set
  PRIMARY KEY (user_id, slot)
);

CREATE TABLE IF NOT EXISTS save_revisions (
  user_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  revision INTEGER NOT NULL,
  saved_at TEXT, uploaded_at INTEGER, device TEXT,
  version INTEGER, day INTEGER, year INTEGER, population INTEGER,
  checksum TEXT, bytes INTEGER, kingdom_name TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (user_id, slot, revision)
);

CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
