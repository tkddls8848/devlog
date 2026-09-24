import assert from "node:assert/strict";
import test from "node:test";
import { REFERENCE_MARKER, formatJournal, parseJournal, publishSql, sqlString, validateJournal } from "../tools/devlog-journal.mjs";

const draft = { slug: "2026-09-22-devlog", post_date: "2026-09-22", status: "draft", title: "2026-09-22 작업 회고", summary: "", body_markdown: "", reference_markdown: "## 참고\n\n- 커밋 `abc1234` fix: guard" };
const body = "## 입력 경계\n\n오늘은 사용자 조회에서 식별자가 없을 때의 동작을 정리했다. ".repeat(6);

test("받은 초안은 쓸 자리와 발행되지 않는 참고 자료를 나눠 보여 준다", () => {
  const text = formatJournal(draft);
  assert.match(text, /^---\nslug: "2026-09-22-devlog"\ndate: "2026-09-22"\nstatus: "draft"\ntitle: "2026-09-22 작업 회고"\nsummary: ""\n---\n/);
  assert.ok(text.indexOf(REFERENCE_MARKER) < text.indexOf("## 참고"));
  assert.deepEqual(parseJournal(text), { slug: "2026-09-22-devlog", date: "2026-09-22", status: "draft", title: "2026-09-22 작업 회고", summary: "", body: "" });
});

test("발행 본문에는 안내 주석과 참고 자료가 들어가지 않는다", () => {
  const written = formatJournal(draft)
    .replace('summary: ""', 'summary: "빈 식별자의 \\"조회\\" 경로를 정리했다."')
    .replace(REFERENCE_MARKER, `${body}\n\n${REFERENCE_MARKER}`)
    .replace(/\n/g, "\r\n");
  const entry = parseJournal(written);
  assert.equal(entry.summary, '빈 식별자의 "조회" 경로를 정리했다.');
  assert.equal(entry.body, body.trim());
  assert.doesNotMatch(entry.body, /<!--|참고|abc1234/);
  assert.deepEqual(validateJournal(entry), []);
});

test("제목·요약·본문이 비면 발행을 막는다", () => {
  const problems = validateJournal(parseJournal(formatJournal({ ...draft, title: "" })));
  assert.equal(problems.length, 3);
  assert.match(problems.join(" "), /title/);
  assert.match(problems.join(" "), /summary/);
  assert.match(problems.join(" "), /본문이 0자/);
});

test("발행 SQL은 작은따옴표를 escape하고 slug를 검증한다", () => {
  assert.equal(sqlString("it's"), "'it''s'");
  const sql = publishSql({ slug: "2026-09-22-devlog", title: "O'Reilly'); DROP TABLE devlog_posts; --", summary: "s", body: "b" }, new Date("2026-09-22T12:00:00Z"));
  assert.match(sql, /title = 'O''Reilly''\); DROP TABLE devlog_posts; --'/);
  assert.match(sql, /published_at = CASE WHEN status = 'draft' THEN '2026-09-22T12:00:00.000Z' ELSE published_at END/);
  assert.match(sql, /status = 'published'\nWHERE slug = '2026-09-22-devlog';/);
  assert.throws(() => publishSql({ slug: "x' OR 1=1 --", title: "t", summary: "s", body: "b" }), /slug/);
});

test("머리말이 없거나 따옴표가 깨진 파일은 발행하지 않는다", () => {
  assert.throws(() => parseJournal("본문만 있음"), /머리말/);
  assert.throws(() => parseJournal('---\ntitle: "닫히지 않음\n---\n본문'), /따옴표/);
});
