-- Migration for Vex D1 Database

CREATE TABLE IF NOT EXISTS transaction_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  table_name  TEXT NOT NULL,
  document_id TEXT NOT NULL,
  data        TEXT,
  inserted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS document_index (
  table_name  TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (table_name, document_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_index_table_ts ON document_index(table_name, ts);

CREATE TABLE IF NOT EXISTS deployments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  schema      TEXT NOT NULL,
  functions   TEXT NOT NULL,
  deployed_at INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0
);
