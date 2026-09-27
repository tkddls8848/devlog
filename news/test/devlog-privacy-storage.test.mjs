import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStore } from "../worker/repository.mjs";

// Node 22+ exercises real SQLite; production still supports the Node 20 toolchain.
const { DatabaseSync } = await import("node:sqlite").catch(() => ({}));
test("마이그레이션과 D1 저장은 공개 범위를 유지하고 공개 조회에서 비공개 커밋을 제외한다", { skip: !DatabaseSync }, async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const name of ["0003_devlog.sql", "0004_devlog_journal.sql", "0005_devlog_privacy.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    const db = {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        let values = [];
        return { bind(...args) { values = args; return this; }, async all() { return { results: statement.all(...values) }; }, async first() { return statement.get(...values); }, async run() { return { meta: statement.run(...values) }; } };
      },
      async batch(statements) { for (const statement of statements) await statement.run(); },
    };
    const store = createStore(db);
    await store.saveDevlogDraft({ slug: "2026-09-27-devlog", postDate: "2026-09-27", createdAt: "2026-09-27T00:00:00Z", status: "published", title: "작업", bodyMarkdown: "안전한 요약", referenceMarkdown: "", commits: [
      { repo: "o/public", sha: "a", message: "public change", visibility: "public" },
      { repo: "o/secret", sha: "b", message: "검증용 테스트 관련 작업을 했다.", visibility: "private", publicRepo: "비공개-작업-123456abcdef" },
    ] });
    const publicPost = await store.getDevlogPost("2026-09-27-devlog");
    assert.deepEqual(publicPost.commits.map((c) => c.repo), ["o/public"]);
    const editable = await store.getDevlogPostForEdit("2026-09-27-devlog");
    assert.equal(editable.commits[1].visibility, "private");
    assert.equal(editable.commits[1].publicRepo, "비공개-작업-123456abcdef");
    const slug = await store.createDevlogEntry("2026-09-27", "2026-09-27T01:00:00Z");
    const draft = await store.getDevlogPostForEdit(slug);
    assert.doesNotMatch(draft.body_markdown, /secret/);
    assert.match(draft.body_markdown, /비공개-작업/);
  } finally { sqlite.close(); }
});
