import legacyArchive from "./generated/legacy-archive.mjs";
import { normalizeUrl } from "../tools/rss.mjs";

const chunks = (values, size = 50) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

const flattenEntries = (sources) => {
  let position = 0;
  return sources.flatMap((group) =>
    group.entries.map((entry) => ({
      ...entry,
      source: group.source,
      kind: group.kind,
      normalizedUrl: normalizeUrl(entry.url),
      position: position++,
    }))
  );
};

export function createStore(db) {
  return {
    async ensureLegacyArchive() {
      const imported = await db.prepare("SELECT value FROM metadata WHERE key = ?").bind("legacy_archive_import_v1").first();
      if (imported) return;
      for (const group of chunks(legacyArchive, 50)) {
        await db.batch(group.map((item) => db.prepare(
          `INSERT OR IGNORE INTO vendor_documents
           (vendor, title, url, document_date, kind, tag, ref, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(item.vendor, item.title, item.url, item.date, item.kind, item.tag || null, item.ref || null, item.note || null)));
      }
      await db.prepare("INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
        .bind("legacy_archive_import_v1", new Date().toISOString()).run();
    },

    async publishedLinks(values) {
      const found = new Set();
      for (const group of chunks([...new Set(values)].filter(Boolean), 80)) {
        if (!group.length) continue;
        const placeholders = group.map(() => "?").join(", ");
        const result = await db
          .prepare(`SELECT normalized_url FROM entries WHERE normalized_url IN (${placeholders})`)
          .bind(...group)
          .all();
        for (const row of result.results || []) found.add(row.normalized_url);
      }
      return found;
    },

    async nextSlug(day) {
      const result = await db
        .prepare("SELECT slug FROM issues WHERE slug = ? OR slug LIKE ?")
        .bind(`${day}-news`, `${day}-news-%`)
        .all();
      const used = new Set((result.results || []).map((row) => row.slug));
      const base = `${day}-news`;
      if (!used.has(base)) return base;
      for (let suffix = 2; ; suffix++) {
        if (!used.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
      }
    },

    async saveIssue(issue, run) {
      const entries = flattenEntries(issue.sources);
      const statements = [
        db
          .prepare(
            `INSERT INTO issues
             (slug, issue_date, title, summary, body_markdown, ai_generated, entry_count, source_count, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            issue.slug,
            issue.issueDate,
            issue.title,
            issue.summary,
            issue.bodyMarkdown,
            issue.aiGenerated ? 1 : 0,
            entries.length,
            issue.sources.length,
            issue.publishedAt
          ),
        ...entries.map((entry) =>
          db
            .prepare(
              `INSERT INTO entries
               (issue_slug, source, kind, title, url, normalized_url, published_at, note, position)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              issue.slug,
              entry.source,
              entry.kind,
              entry.title,
              entry.url,
              entry.normalizedUrl,
              entry.at,
              entry.note || null,
              entry.position
            )
        ),
        db
          .prepare(
            `INSERT INTO collection_runs
             (started_at, finished_at, since_at, status, issue_slug, collected_count, selected_count, failed_sources, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            run.startedAt,
            run.finishedAt,
            run.sinceAt,
            run.status,
            issue.slug,
            run.collectedCount,
            entries.length,
            JSON.stringify(run.failedSources),
            run.error || null
          ),
      ];
      await db.batch(statements);
    },

    async saveRun(run) {
      await db
        .prepare(
          `INSERT INTO collection_runs
           (started_at, finished_at, since_at, status, issue_slug, collected_count, selected_count, failed_sources, error)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .bind(
          run.startedAt,
          run.finishedAt,
          run.sinceAt,
          run.status,
          run.collectedCount,
          run.selectedCount || 0,
          JSON.stringify(run.failedSources),
          run.error || null
        )
        .run();
    },

    async listIssues(limit = 100) {
      const result = await db
        .prepare(
          `SELECT slug, issue_date, title, summary, ai_generated, entry_count, source_count, published_at
           FROM issues ORDER BY published_at DESC LIMIT ?`
        )
        .bind(limit)
        .all();
      return result.results || [];
    },

    async getIssue(slug) {
      const issue = await db
        .prepare(
          `SELECT slug, issue_date, title, summary, body_markdown, ai_generated, entry_count, source_count, published_at
           FROM issues WHERE slug = ?`
        )
        .bind(slug)
        .first();
      if (!issue) return null;
      const result = await db
        .prepare(
          `SELECT source, kind, title, url, published_at, note
           FROM entries WHERE issue_slug = ? ORDER BY position`
        )
        .bind(slug)
        .all();
      const sources = [];
      for (const entry of result.results || []) {
        let source = sources.at(-1);
        if (!source || source.source !== entry.source) {
          source = { source: entry.source, kind: entry.kind, entries: [] };
          sources.push(source);
        }
        source.entries.push({
          title: entry.title,
          url: entry.url,
          at: entry.published_at,
          ...(entry.note ? { note: entry.note } : {}),
        });
      }
      return { ...issue, sources };
    },

    async latestRun() {
      return db
        .prepare(
          `SELECT started_at, finished_at, status, issue_slug, collected_count, selected_count, failed_sources, error
           FROM collection_runs ORDER BY id DESC LIMIT 1`
        )
        .first();
    },

    async saveVendorDocuments(values) {
      const unique = new Map();
      for (const item of values) {
        if (!item?.vendor || !item?.title || !item?.url || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) continue;
        unique.set(`${item.vendor}:${item.url}:${item.date}`, item);
      }
      let inserted = 0;
      for (const group of chunks([...unique.values()], 50)) {
        const result = await db.batch(group.map((item) => db.prepare(
          `INSERT OR IGNORE INTO vendor_documents
           (vendor, title, url, document_date, kind, tag, ref, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(item.vendor, item.title, item.url, item.date, item.kind || "기술 문서", item.tag || null, item.ref || null, item.note || null)));
        inserted += (result || []).reduce((sum, row) => sum + Number(row.meta?.changes || 0), 0);
      }
      return inserted;
    },

    async listVendorDocuments(limit = 1000) {
      const result = await db.prepare(
        `SELECT vendor, title, url, document_date, kind, tag, ref, note
         FROM vendor_documents ORDER BY document_date DESC, vendor ASC, id DESC LIMIT ?`
      ).bind(limit).all();
      return result.results || [];
    },

    async latestArchiveRun() {
      return db.prepare(
        `SELECT started_at, finished_at, status, collected_count, inserted_count, failed_sources, error
         FROM archive_runs ORDER BY id DESC LIMIT 1`
      ).first();
    },

    async saveArchiveRun(run) {
      await db.prepare(
        `INSERT INTO archive_runs
         (started_at, finished_at, status, collected_count, inserted_count, failed_sources, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(run.startedAt, run.finishedAt, run.status, run.collectedCount, run.insertedCount, JSON.stringify(run.failedSources || []), run.error || null).run();
    },

    async listDevlogPosts(limit = 100) {
      const result = await db.prepare(
        `SELECT slug, post_date, title, summary, ai_generated, published_at
         FROM devlog_posts ORDER BY post_date DESC, published_at DESC LIMIT ?`
      ).bind(limit).all();
      return result.results || [];
    },

    async getDevlogPost(slug) {
      const post = await db.prepare(
        `SELECT slug, post_date, title, summary, body_markdown, ai_generated, published_at
         FROM devlog_posts WHERE slug = ?`
      ).bind(slug).first();
      if (!post) return null;
      const commits = await db.prepare(
        `SELECT repo, sha, message FROM devlog_commits WHERE post_slug = ? ORDER BY position`
      ).bind(slug).all();
      return { ...post, commits: commits.results || [] };
    },

    async publishedDevlogShas() {
      const result = await db.prepare("SELECT sha FROM devlog_commits").all();
      return new Set((result.results || []).map((row) => row.sha));
    },

    async nextDevlogSlug(day) {
      const result = await db.prepare("SELECT slug FROM devlog_posts WHERE slug = ? OR slug LIKE ?")
        .bind(`${day}-devlog`, `${day}-devlog-%`).all();
      const used = new Set((result.results || []).map((row) => row.slug));
      if (!used.has(`${day}-devlog`)) return `${day}-devlog`;
      for (let suffix = 2; ; suffix++) if (!used.has(`${day}-devlog-${suffix}`)) return `${day}-devlog-${suffix}`;
    },

    async saveDevlogPost(post) {
      const statements = [db.prepare(
        `INSERT INTO devlog_posts
         (slug, post_date, title, summary, body_markdown, ai_generated, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(post.slug, post.postDate, post.title, post.summary, post.bodyMarkdown, post.aiGenerated ? 1 : 0, post.publishedAt)];
      statements.push(...post.commits.map((item, position) => db.prepare(
        `INSERT INTO devlog_commits (sha, post_slug, repo, message, position) VALUES (?, ?, ?, ?, ?)`
      ).bind(item.sha, post.slug, item.repo, item.message, position)));
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
