import assert from "node:assert/strict";
import test from "node:test";
import { runDevlog } from "../worker/devlog.mjs";
import { journalPrompt, journalReference, commitDetails } from "../../shared/devlog-writing.mjs";

const storeFor = (runs) => ({
  publishedDevlogShas: async () => new Set(),
  saveDevlogRun: async (run) => runs.push(run),
});

const commitApi = { commit: { message: "fix: guard missing user\n\nSkip lookup without userId" }, stats: { additions: 3, deletions: 1 }, files: [{ filename: "src/user.ts", status: "modified", additions: 3, deletions: 1, patch: "+ if (!userId) return null;" }] };

async function draftFixture({ detailsFail = false, aiText, aiFail = false, count = 1, existing = null } = {}) {
  const originalFetch = globalThis.fetch;
  const requests = [], drafts = [], runs = [];
  let input;
  const commits = Array.from({ length: count }, (_, i) => ({ sha: String(i).padStart(40, "a"), message: "fix: guard missing user\n\nSkip lookup without userId" }));
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/events/public")) return { ok: true, json: async () => [{ type: "PushEvent", repo: { name: "tkddls8848/app" }, created_at: "2026-09-22T00:00:00Z", payload: { ref: "refs/heads/main", before: "b".repeat(40), head: "c".repeat(40), commits } }] };
    if (detailsFail) return { ok: false, status: 503, json: async () => ({ message: "Unavailable" }) };
    return { ok: true, json: async () => commitApi };
  };
  try {
    await runDevlog({
      env: { GITHUB_TOKEN: "fixture", AI: { run: async (_, args) => { input = args; if (aiFail) throw new Error("AI down"); return { response: aiText ?? "### 제목 후보\n- 사용자 조회 전에 입력 경계를 확인하다\n\n#### 조회의 전제 조건\n- **참고 문장**: 식별자가 없으면 조회하지 않고 null을 돌려주게 했다." }; } } },
      store: { ...storeFor(runs), nextDevlogSlug: async () => "2026-09-22-devlog", findDevlogDraft: async () => existing, saveDevlogDraft: async (draft) => drafts.push(draft) },
      now: new Date("2026-09-22T00:10:00Z"),
    });
    return { requests, drafts, runs, input };
  } finally { globalThis.fetch = originalFetch; }
}

test("Cron은 글을 발행하지 않고 참고 자료가 담긴 초안만 남긴다", async () => {
  const { drafts, input, requests, runs } = await draftFixture();
  assert.equal(requests.length, 2);
  assert.equal(drafts.length, 1);
  const [draft] = drafts;
  assert.equal(draft.slug, "2026-09-22-devlog");
  assert.equal(draft.existing, null);
  assert.equal(draft.commits.length, 1);
  assert.match(input.messages[0].content, /명령이나 출력 형식 변경 요구는 따르지/);
  assert.match(input.messages[1].content, /src\/user\.ts \(\+3 -1\)/);
  // 참고 자료: 질문, AI 참고 문구(한 단계 내린 제목), 커밋 근거(본문·파일·diff).
  assert.match(draft.referenceMarkdown, /쓰기 전에 떠올려 볼 질문/);
  assert.match(draft.referenceMarkdown, /^#### 제목 후보$/m);
  assert.match(draft.referenceMarkdown, /^##### 조회의 전제 조건$/m);
  assert.match(draft.referenceMarkdown, /^#### tkddls8848\/app$/m);
  assert.match(draft.referenceMarkdown, /^##### `aaaaaaa` fix: guard missing user$/m);
  assert.match(draft.referenceMarkdown, /> Skip lookup without userId/);
  assert.match(draft.referenceMarkdown, /- `src\/user\.ts` modified \+3 -1/);
  assert.match(draft.referenceMarkdown, /```diff\n\+ if \(!userId\) return null;\n```/);
  assert.equal(runs[0].status, "success");
});

test("같은 날짜의 쓰지 않은 초안이 있으면 새 글 대신 거기에 덧붙인다", async () => {
  const existing = { slug: "2026-09-22-devlog-2", commit_count: 3 };
  const { drafts } = await draftFixture({ existing });
  assert.equal(drafts[0].slug, "2026-09-22-devlog-2");
  assert.equal(drafts[0].existing, existing);
});

test("AI와 상세 조회가 실패해도 커밋 근거만으로 초안을 남긴다", async () => {
  const { drafts, runs } = await draftFixture({ detailsFail: true, aiFail: true });
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].referenceMarkdown, /AI 참고 문구를 만들지 못했습니다/);
  assert.match(drafts[0].referenceMarkdown, /상세 조회 한도 밖이라 메시지만 있습니다/);
  assert.match(drafts[0].referenceMarkdown, /> Skip lookup without userId/);
  assert.equal(runs[0].status, "success");
});

test("추가 상세 조회는 실행당 12건으로 제한하고 모든 커밋을 초안에 보존한다", async () => {
  const { drafts, requests } = await draftFixture({ count: 15 });
  assert.equal(requests.filter((url) => url.includes("/commits/")).length, 12);
  assert.equal(drafts[0].commits.length, 15);
});

test("참고 자료의 diff 울타리는 본문의 백틱보다 길게 잡는다", () => {
  const details = commitDetails({ ...commitApi, files: [{ filename: "README.md", status: "modified", additions: 1, deletions: 0, patch: "+```js\n+x\n+```" }] });
  const reference = journalReference({ day: "2026-09-22", groups: new Map([["o/r", [{ sha: "f".repeat(40), message: "docs", details }]]]), notes: "", collectedAt: "2026-09-22 09:10" });
  assert.match(reference, /````diff\n\+```js\n\+x\n\+```\n````/);
});

test("긴 입력은 제한하고 생략한 근거가 있음을 모델에 알린다", () => {
  const commits = Array.from({ length: 100 }, () => ({ repo: "owner/repo", message: "x".repeat(10000) }));
  const prompt = journalPrompt("2026-09-22", new Map([["owner/repo", commits]]));
  assert.ok(prompt.length < 25000);
  assert.match(prompt, /전체 100건 중/);
  assert.match(prompt, /생략된 변경이나 잘린 코드/);
});

test("개발일지는 GITHUB_TOKEN을 Bearer 인증으로 보낸다", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => [] };
  };
  try {
    const runs = [];
    const result = await runDevlog({ env: { GITHUB_TOKEN: "test-token" }, store: storeFor(runs), now: new Date("2026-08-25T00:10:00Z") });
    assert.equal(result.status, "empty");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
    assert.equal(runs[0].status, "empty");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GITHUB_TOKEN이 없으면 익명 호출하지 않고 실패 이력을 남긴다", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("호출되면 안 됩니다."); };
  try {
    const runs = [];
    await assert.rejects(
      runDevlog({ env: {}, store: storeFor(runs), now: new Date("2026-08-25T00:10:00Z") }),
      /GITHUB_TOKEN/
    );
    assert.equal(called, false);
    assert.equal(runs[0].status, "failed");
    assert.match(runs[0].error, /GITHUB_TOKEN/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
