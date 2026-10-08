import { repoOutline } from "../../shared/devlog-writing.mjs";
import { privateProjectLabel } from "../../shared/devlog-privacy.mjs";

export function createStore(db) {
  return {
    // One page of published posts. The search covers every post, not just the page.
    async listDevlogPage({ page = 1, perPage = 5, query = "" } = {}) {
      const pattern = `%${String(query).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const filter = query ? " AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')" : "";
      const binds = query ? [pattern, pattern] : [];
      const counted = await db.prepare(`SELECT COUNT(*) AS total FROM devlog_posts WHERE status = 'published'${filter}`).bind(...binds).first();
      const total = Number(counted?.total || 0);
      const pages = Math.max(1, Math.ceil(total / perPage));
      const current = Math.min(Math.max(1, page), pages);
      const result = await db.prepare(
        `SELECT slug, post_date, title, summary, ai_generated, published_at
         FROM devlog_posts WHERE status = 'published'${filter}
         ORDER BY post_date DESC, published_at DESC LIMIT ? OFFSET ?`
      ).bind(...binds, perPage, (current - 1) * perPage).all();
      return { posts: result.results || [], total, page: current, pages, perPage, query };
    },

    async getDevlogPost(slug) {
      const post = await db.prepare(
        `SELECT slug, post_date, title, summary, body_markdown, ai_generated, published_at
         FROM devlog_posts WHERE slug = ? AND status = 'published'`
      ).bind(slug).first();
      if (!post) return null;
      const commits = await db.prepare(
        `SELECT repo, sha, message, visibility FROM devlog_commits WHERE post_slug = ? AND visibility = 'public' ORDER BY position`
      ).bind(slug).all();
      return { ...post, commits: commits.results || [] };
    },

    async publishedDevlogShas() {
      const result = await db.prepare("SELECT sha FROM devlog_commits").all();
      return new Set((result.results || []).map((row) => row.sha));
    },

    async privateRepoAlias(key) {
      await db.prepare(`INSERT OR IGNORE INTO devlog_private_aliases(alias_key, ordinal)
        SELECT ?, COALESCE(MAX(ordinal), 0) + 1 FROM devlog_private_aliases`).bind(key).run();
      const row = await db.prepare("SELECT ordinal FROM devlog_private_aliases WHERE alias_key = ?").bind(key).first();
      return privateProjectLabel(row.ordinal);
    },

    async nextDevlogSlug(day) {
      const result = await db.prepare("SELECT slug FROM devlog_posts WHERE slug = ? OR slug LIKE ?")
        .bind(`${day}-devlog`, `${day}-devlog-%`).all();
      const used = new Set((result.results || []).map((row) => row.slug));
      if (!used.has(`${day}-devlog`)) return `${day}-devlog`;
      for (let suffix = 2; ; suffix++) if (!used.has(`${day}-devlog-${suffix}`)) return `${day}-devlog-${suffix}`;
    },

    async listDevlogAdmin(limit = 500) {
      const result = await db.prepare(
        `SELECT p.slug, p.post_date, p.title, p.summary, p.status, p.ai_generated, p.published_at, p.updated_at,
                length(p.body_markdown) AS body_length, length(p.reference_markdown) > 0 AS has_reference,
                (SELECT COUNT(*) FROM devlog_commits c WHERE c.post_slug = p.slug) AS commit_count
         FROM devlog_posts p ORDER BY p.post_date DESC, p.slug DESC LIMIT ?`
      ).bind(limit).all();
      return result.results || [];
    },

    async getDevlogPostForEdit(slug) {
      const post = await db.prepare(
        `SELECT slug, post_date, title, summary, body_markdown, reference_markdown, status, ai_generated, published_at, updated_at
         FROM devlog_posts WHERE slug = ?`
      ).bind(slug).first();
      if (!post) return null;
      const commits = await db.prepare(
        `SELECT repo, sha, message, visibility, public_repo AS publicRepo FROM devlog_commits WHERE post_slug = ? ORDER BY position`
      ).bind(slug).all();
      return { ...post, commits: commits.results || [] };
    },

    // Anything saved through the editor is the author's own writing.
    async updateDevlogPost({ slug, title, summary, body, status, now }) {
      const result = await db.prepare(
        `UPDATE devlog_posts SET title = ?, summary = ?, body_markdown = ?, ai_generated = 0,
           published_at = CASE WHEN status = 'draft' AND ? = 'published' THEN ? ELSE published_at END,
           status = ?, updated_at = ?
         WHERE slug = ?`
      ).bind(title, summary, body, status, now, status, now, slug).run();
      return (result.meta?.changes ?? 1) > 0;
    },

    // Opens the day's unwritten draft if there is one, so a date never gets two drafts.
    // Otherwise the new post starts with a heading per repo that had commits that day.
    async createDevlogEntry(day, now) {
      const draft = await this.findDevlogDraft(day);
      if (draft) return draft.slug;
      const repos = await db.prepare(
        `SELECT CASE WHEN c.visibility = 'public' THEN c.repo ELSE COALESCE(c.public_repo, '비공개 작업') END AS repo FROM devlog_commits c JOIN devlog_posts p ON p.slug = c.post_slug
         WHERE p.post_date = ? GROUP BY c.repo ORDER BY MIN(c.position), c.repo`
      ).bind(day).all();
      const slug = await this.nextDevlogSlug(day);
      await db.prepare(
        `INSERT INTO devlog_posts
         (slug, post_date, title, summary, body_markdown, ai_generated, published_at, status, reference_markdown, updated_at)
         VALUES (?, ?, ?, '', ?, 0, ?, 'draft', '', ?)`
      ).bind(slug, day, `${day} 작업 회고`, repoOutline((repos.results || []).map((row) => row.repo)), now, now).run();
      return slug;
    },

    async findDevlogDraft(day) {
      return db.prepare(
        `SELECT slug, body_markdown, reference_markdown, (SELECT COUNT(*) FROM devlog_commits WHERE post_slug = devlog_posts.slug) AS commit_count
         FROM devlog_posts WHERE post_date = ? AND status = 'draft' ORDER BY slug LIMIT 1`
      ).bind(day).first();
    },

    // A day's draft is created once and later runs append to it, so the author
    // keeps one file per day even when commits arrive across several runs.
    // With an AI-written post (title given) the row is filled and may be published.
    async saveDevlogDraft(draft) {
      const status = draft.status || "draft";
      const ai = draft.aiGenerated ? 1 : 0;
      const statements = [draft.existing
        ? db.prepare(
          `UPDATE devlog_posts SET reference_markdown = reference_markdown || ?, body_markdown = ?,
             title = COALESCE(?, title), summary = COALESCE(?, summary), ai_generated = ?,
             published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
             status = ?, updated_at = ?
           WHERE slug = ? AND status = 'draft'`
        ).bind(`\n\n${draft.referenceMarkdown}`, draft.bodyMarkdown ?? draft.existing.body_markdown ?? "",
          draft.title ?? null, draft.summary ?? null, ai, status, draft.createdAt, status, draft.createdAt, draft.slug)
        : db.prepare(
          `INSERT INTO devlog_posts
           (slug, post_date, title, summary, body_markdown, ai_generated, published_at, status, reference_markdown)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(draft.slug, draft.postDate, draft.title || `${draft.postDate} 작업 회고`, draft.summary || "", draft.bodyMarkdown ?? "", ai, draft.createdAt, status, draft.referenceMarkdown)];
      const offset = draft.existing?.commit_count || 0;
      statements.push(...draft.commits.map((item, index) => db.prepare(
        `INSERT INTO devlog_commits (sha, post_slug, repo, message, position, visibility, public_repo) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(item.sha, draft.slug, item.repo, item.message, offset + index, item.visibility || "public", item.publicRepo || null)));
      await db.batch(statements);
    },

    async saveDevlogRun(run) {
      await db.prepare(
        `INSERT INTO devlog_runs (started_at, finished_at, status, collected_count, post_count, error)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(run.startedAt, run.finishedAt, run.status, run.collectedCount, run.postCount, run.error || null).run();
    },

    async latestDevlogRun() {
      return db.prepare(
        `SELECT started_at, finished_at, status, collected_count, post_count, error
         FROM devlog_runs ORDER BY id DESC LIMIT 1`
      ).first();
    },
  };
}
