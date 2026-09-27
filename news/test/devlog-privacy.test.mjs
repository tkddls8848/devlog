import test from "node:test";
import assert from "node:assert/strict";
import { privateAlias, privateWorkSummary, publicationGroups } from "../../shared/devlog-privacy.mjs";
import { runDevlog } from "../worker/devlog.mjs";
import { writePost } from "../worker/devlog-writer.mjs";
import { evidenceFromReference } from "../../shared/devlog-writing.mjs";
import { renderDevlogPost } from "../worker/render.mjs";
import { parseEvidence, buildDescription } from "../../video/tools/lib.mjs";

test("비공개 작업은 고정 기술 요약만 허용하고 이름·목표·코드·URL을 복사하지 않는다", async () => {
  const summary = privateWorkSummary("SecretProduct 출시를 위한 중복 요청 수정 https://internal.example\n사업 목표: 독점 서비스\nconst secret = 1");
  assert.equal(summary, "중복 요청과 실행 처리 관련 작업을 했다.");
  assert.doesNotMatch(summary, /SecretProduct|출시|독점|secret|internal/);
  assert.equal(privateWorkSummary("SecretProduct 자료 수집 문서 정리"), "개발 문서 정리, 자료 수집 관련 작업을 했다.");
  assert.equal(privateWorkSummary("SecretProduct 화면 레이아웃 변경"), "화면 구성 관련 작업을 했다.");
  assert.equal(await privateAlias(12), await privateAlias(12));
  assert.notEqual(await privateAlias(12), await privateAlias(13));
  const safe = publicationGroups(new Map([["owner/SecretProduct", [{ visibility: "private", message: "새 사업 계획", details: { files: ["secret"] } }]]]));
  assert.doesNotMatch(JSON.stringify([...safe]), /SecretProduct|새 사업|files|secret/);
});

test("비공개 수집 → 재작성 → 공개 HTML과 영상 근거까지 원문과 식별자를 전달하지 않는다", async () => {
  const original = globalThis.fetch;
  const requests = [], drafts = [], runs = [];
  const sha = "a".repeat(40);
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/events/public")) return { ok: true, json: async () => [] };
    if (String(url).includes("/user/repos?")) return { ok: true, json: async () => [{ id: 123, full_name: "tkddls8848/SecretProduct", private: true, owner: { login: "tkddls8848" }, default_branch: "main" }] };
    if (String(url).includes("/commits?")) return { ok: true, json: async () => [{ sha, commit: { message: "SecretProduct 중복 요청 수정\n독점 서비스 출시 목표", author: { name: "author", date: "2026-09-27T00:00:00Z" } } }] };
    throw Error("Unexpected request");
  };
  try {
    const env = { GITHUB_TOKEN: "fixture", AI: { run: () => { throw Error("Private raw text must not reach AI"); } } };
    const result = await runDevlog({ env, now: new Date("2026-09-27"), store: {
      publishedDevlogShas: async () => new Set(), findDevlogDraft: async () => null,
      nextDevlogSlug: async () => "2026-09-27-devlog", saveDevlogDraft: async (draft) => drafts.push(draft), saveDevlogRun: async (run) => runs.push(run),
    } });
    assert.equal(result.status, "success");
    const draft = drafts[0];
    assert.equal(draft.commits[0].visibility, "private");
    assert.equal(draft.commits[0].sha, sha, "dedup key stays internal");
    for (const text of [draft.bodyMarkdown, draft.referenceMarkdown, draft.summary]) assert.doesNotMatch(text, /SecretProduct|독점|출시|aaaaaaaa/);
    assert.match(draft.bodyMarkdown, /중복 요청과 실행 처리/);
    assert.ok(!requests.some((url) => /\/commits\/[a-f0-9]+/.test(url)), "no private code/diff request");
    const rewritten = await writePost(env, draft.postDate, evidenceFromReference(draft.referenceMarkdown));
    assert.match(rewritten.body, /중복 요청과 실행 처리/);
    assert.doesNotMatch(rewritten.body, /SecretProduct|독점/);
    const html = renderDevlogPost({ ...draft, post_date: draft.postDate, body_markdown: draft.bodyMarkdown, commits: draft.commits }, {}, "https://example.com");
    assert.doesNotMatch(html, /SecretProduct|aaaaaaaa/);
    const groups = parseEvidence(draft.referenceMarkdown);
    assert.equal(groups.length, 1);
    const description = buildDescription({ summary: "요약", postUrl: "https://example.com", sessions: groups.map((s) => ({ ...s, thread: { name: "기술 작업", episode: 1 } })) }, []);
    assert.doesNotMatch(description, /github.com|SecretProduct|독점/);
  } finally { globalThis.fetch = original; }
});

test("비공개 목록 조회 실패는 빈 성공이 아닌 partial로 기록한다", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: !String(url).includes("/user/repos?"), status: 403, json: async () => String(url).includes("/user/repos?") ? { message: "denied" } : [] });
  try {
    const runs = [];
    const result = await runDevlog({ env: { GITHUB_TOKEN: "fixture" }, store: { publishedDevlogShas: async () => new Set(), saveDevlogRun: async (r) => runs.push(r) } });
    assert.equal(result.status, "partial");
    assert.equal(runs[0].status, "partial");
  } finally { globalThis.fetch = original; }
});
