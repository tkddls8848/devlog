CREATE TABLE IF NOT EXISTS devlog_posts (
  slug TEXT PRIMARY KEY,
  post_date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0, 1)),
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS devlog_posts_date_idx ON devlog_posts (post_date DESC, published_at DESC);

CREATE TABLE IF NOT EXISTS devlog_commits (
  sha TEXT PRIMARY KEY,
  post_slug TEXT NOT NULL REFERENCES devlog_posts(slug) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  message TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS devlog_commits_post_idx ON devlog_commits (post_slug, position);

CREATE TABLE IF NOT EXISTS devlog_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'empty', 'failed')),
  collected_count INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS devlog_runs_started_at_idx ON devlog_runs (started_at DESC);
