ALTER TABLE devlog_commits ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE devlog_commits ADD COLUMN public_repo TEXT;
