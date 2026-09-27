CREATE TABLE devlog_private_aliases (
  alias_key TEXT PRIMARY KEY,
  ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal > 0)
);
INSERT INTO devlog_private_aliases(alias_key, ordinal)
SELECT c.public_repo, ROW_NUMBER() OVER (ORDER BY MIN(p.post_date), MIN(c.position), c.public_repo)
FROM devlog_commits c JOIN devlog_posts p ON p.slug = c.post_slug
WHERE c.visibility = 'private' AND c.public_repo LIKE '비공개-작업-%'
GROUP BY c.public_repo;
