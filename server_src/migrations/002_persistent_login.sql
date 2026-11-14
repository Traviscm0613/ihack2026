CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mutation_receipts (
  user_id TEXT NOT NULL REFERENCES users(id),
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY (user_id, operation_id)
);
