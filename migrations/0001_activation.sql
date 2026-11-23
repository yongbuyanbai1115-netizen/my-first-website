CREATE TABLE IF NOT EXISTS codes (
  hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL REFERENCES codes(hash),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS attempts_expiration ON attempts(expires_at);
