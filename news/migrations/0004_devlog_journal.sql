-- 개발 기록을 직접 쓰는 작업 회고로 바꾼다. Cron은 그날의 초안과 참고 자료만
-- 만들고(status = 'draft'), 공개 화면은 발행한 글만 보여 준다. 이미 있던 글은
-- 발행 상태로 남는다.
ALTER TABLE devlog_posts ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published'));
ALTER TABLE devlog_posts ADD COLUMN reference_markdown TEXT NOT NULL DEFAULT '';
ALTER TABLE devlog_posts ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS devlog_posts_status_idx ON devlog_posts (status, post_date DESC);
