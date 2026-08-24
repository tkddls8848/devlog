import legacyIssues from "./generated/legacy-issues.mjs";
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
    async ensureLegacyIssues() {
      const imported = await db.prepare("SELECT value FROM metadata WHERE key = ?").bind("legacy_import_v1").first();
      if (imported) return;

      for (const issue of legacyIssues) {
        const entries = flattenEntries(issue.sources);
        await db
          .prepare(
            `INSERT OR IGNORE INTO issues
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
          )
          .run();

        for (const group of chunks(entries)) {
          await db.batch(
            group.map((entry) =>
              db
                .prepare(
                  `INSERT OR IGNORE INTO entries
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
            )
          );
        }
      }

      await db
        .prepare("INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
        .bind("legacy_import_v1", new Date().toISOString())
        .run();
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
  };
}
