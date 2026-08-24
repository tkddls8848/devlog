CREATE TABLE IF NOT EXISTS vendor_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  document_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  tag TEXT,
  ref TEXT,
  note TEXT,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vendor, url, document_date)
);

CREATE INDEX IF NOT EXISTS vendor_documents_date_idx
  ON vendor_documents (document_date DESC, vendor ASC);

CREATE TABLE IF NOT EXISTS archive_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'empty', 'failed')),
  collected_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  failed_sources TEXT NOT NULL DEFAULT '[]',
  error TEXT
);

CREATE INDEX IF NOT EXISTS archive_runs_started_at_idx
  ON archive_runs (started_at DESC);
