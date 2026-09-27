import assert from "node:assert/strict";
import test from "node:test";
import { createSession, passwordMatches, sessionValid, SESSION_SECONDS } from "../worker/devlog-auth.mjs";
import { handleDevlogAdmin, withoutDiffExcerpts } from "../worker/devlog-admin.mjs";
import { chunkText, parseIssues } from "../worker/devlog-spellcheck.mjs";
import { markdownToHtml, renderDevlogHome, renderDevlogPost } from "../worker/render.mjs";

const env = { DEVLOG_ADMIN_PASSWORD: "correct horse battery" };
const ORIGIN = "https://devlog.example.com";
const now = new Date("2026-09-26T03:00:00Z");

const draft = { slug: "2026-09-25-devlog", post_date: "2026-09-25", title: "2026-09-25 작업 회고", summary: "", body_markdown: "", reference_markdown: "## 참고 자료\n\n- 질문 <script>alert(1)</script>\n\n> 커밋 본문 인용", status: "draft", ai_generated: 0, updated_at: null, commits: [{ repo: "o/r", sha: "a".repeat(40), message: "fix: guard" }] };

function fakeStore(posts = [draft]) {
  const calls = { update: [], create: [] };
  return {
    calls,
    listDevlogAdmin: async () => posts.map((post) => ({ ...post, body_length: post.body_markdown.length, has_reference: post.reference_markdown ? 1 : 0, commit_count: post.commits?.length || 0 })),
    getDevlogPostForEdit: async (slug) => posts.find((post) => post.slug === slug) || null,
    updateDevlogPost: async (values) => { calls.update.push(values); return true; },
    createDevlogEntry: async (day, at) => { calls.create.push([day, at]); return `${day}-devlog`; },
  };
}

async function cookie() {
  return `devlog_admin=${await createSession(env, now.getTime())}`;
}

function request(path, { method = "GET", form, cookie: session, origin = ORIGIN } = {}) {
  const headers = new Headers();
  if (session) headers.set("cookie", session);
  if (method === "POST" && origin) headers.set("origin", origin);
  const body = form ? new URLSearchParams(form) : undefined;
  return new Request(`${ORIGIN}${path}`, { method, headers, body });
}

test("세션은 서명과 만료를 확인하고, 비밀번호가 바뀌면 끊긴다", async () => {
  const token = await createSession(env, now.getTime());
  assert.equal(await sessionValid(env, token, now.getTime()), true);
  assert.equal(await sessionValid(env, token, now.getTime() + (SESSION_SECONDS + 1) * 1000), false, "만료");
  const [v, expires, signature] = token.split(".");
  assert.equal(await sessionValid(env, `${v}.${Number(expires) + 9999}.${signature}`, now.getTime()), false, "만료 시각 조작");
  assert.equal(await sessionValid({ DEVLOG_ADMIN_PASSWORD: "another long password" }, token, now.getTime()), false, "비밀번호 교체");
  assert.equal(await sessionValid(env, "garbage", now.getTime()), false);
});

test("비밀번호가 비어 있으면 누구도 로그인할 수 없고, 길이 제한은 없다", async () => {
  assert.equal(await passwordMatches({}, ""), false);
  assert.equal(await passwordMatches({ DEVLOG_ADMIN_PASSWORD: "" }, ""), false);
  assert.equal(await passwordMatches({ DEVLOG_ADMIN_PASSWORD: "short" }, "short"), true);
  assert.equal(await passwordMatches({ DEVLOG_ADMIN_PASSWORD: "short" }, "shor"), false);
  assert.equal(await passwordMatches(env, "correct horse battery"), true);
  assert.equal(await passwordMatches(env, "correct horse batter"), false);
  const response = await handleDevlogAdmin(request("/devlog/admin/login"), {}, fakeStore(), now);
  assert.match(await response.text(), /DEVLOG_ADMIN_PASSWORD/);
});

test("로그인하지 않으면 관리 화면 대신 로그인으로 보낸다", async () => {
  const response = await handleDevlogAdmin(request("/devlog/admin/"), env, fakeStore(), now);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/devlog/admin/login?next=%2Fdevlog%2Fadmin%2F");
  const post = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", form: { title: "x" } }), env, fakeStore(), now);
  assert.equal(post.status, 401);
});

test("로그인은 올바른 비밀번호에만 HttpOnly·SameSite=Strict 쿠키를 준다", async () => {
  const wrong = await handleDevlogAdmin(request("/devlog/admin/login", { method: "POST", form: { password: "nope", next: "/devlog/admin/" } }), env, fakeStore(), now);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);
  const right = await handleDevlogAdmin(request("/devlog/admin/login", { method: "POST", form: { password: env.DEVLOG_ADMIN_PASSWORD, next: "https://evil.example/" } }), env, fakeStore(), now);
  assert.equal(right.status, 303);
  assert.equal(right.headers.get("location"), "/devlog/admin/", "외부 주소로는 돌려보내지 않는다");
  assert.match(right.headers.get("set-cookie"), /^devlog_admin=v1\.\d+\.[\w-]+; Path=\/devlog; HttpOnly; Secure; SameSite=Strict/);
});

test("다른 사이트에서 온 쓰기 요청은 로그인 쿠키가 있어도 거절한다", async () => {
  const store = fakeStore();
  const response = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), origin: "https://evil.example", form: { title: "t", body: "b", action: "publish" } }), env, store, now);
  assert.equal(response.status, 403);
  assert.equal(store.calls.update.length, 0);
});

test("관리 화면은 초안과 발행한 글을 나눠 보여 준다", async () => {
  const published = { ...draft, slug: "2026-09-20-devlog", post_date: "2026-09-20", title: "발행한 회고", status: "published", body_markdown: "본문", ai_generated: 1 };
  const response = await handleDevlogAdmin(request("/devlog/admin/", { cookie: await cookie() }), env, fakeStore([draft, published]), now);
  const html = await response.text();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(html, /쓸 차례인 초안 <span>1<\/span>/);
  assert.match(html, /발행한 글 <span>1<\/span>/);
  assert.match(html, /AI 자동 작성/);
  assert.match(html, /name="date" value="2026-09-26"/);
  assert.match(html, /noindex/);
});

test("편집 화면은 참고 자료를 escape해서 옆에 보여 준다", async () => {
  const response = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { cookie: await cookie() }), env, fakeStore(), now);
  const html = await response.text();
  assert.match(html, /참고 자료 · 발행되지 않음/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<blockquote><p>커밋 본문 인용<\/p><\/blockquote>/);
  assert.match(html, /value="publish"/);
  assert.match(html, /devlog-editor\.js/);
});

test("발행은 제목과 본문이 있어야 하고, 거절돼도 쓴 글을 그대로 돌려준다", async () => {
  const store = fakeStore();
  const rejected = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), form: { title: "쓰던 제목", summary: "", body: "", action: "publish" } }), env, store, now);
  assert.equal(rejected.status, 422);
  const html = await rejected.text();
  assert.match(html, /본문을 쓴 뒤 발행해 주세요/);
  assert.match(html, /value="쓰던 제목"/);
  assert.equal(store.calls.update.length, 0);

  const saved = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), form: { title: " 입력 경계를 정리하다 ", summary: "요약\n두 줄", body: "## 시작\r\n\r\n오늘은", action: "publish" } }), env, store, now);
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("location"), "/devlog/admin/posts/2026-09-25-devlog/?saved=published");
  assert.deepEqual(store.calls.update[0], { slug: "2026-09-25-devlog", title: "입력 경계를 정리하다", summary: "요약 두 줄", body: "## 시작\n\n오늘은", status: "published", now: now.toISOString() });
});

test("임시 저장은 상태를 유지하고, 비공개 전환은 초안으로 돌린다", async () => {
  const published = { ...draft, status: "published", body_markdown: "본문" };
  const store = fakeStore([published]);
  const save = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), form: { title: "t", summary: "", body: "고친 본문", action: "save" } }), env, store, now);
  assert.equal(save.headers.get("location"), "/devlog/admin/posts/2026-09-25-devlog/?saved=live");
  assert.equal(store.calls.update[0].status, "published");
  await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), form: { title: "t", summary: "", body: "", action: "unpublish" } }), env, store, now);
  assert.equal(store.calls.update[1].status, "draft");
});

test("커밋이 없는 날도 날짜를 골라 새 글을 만든다", async () => {
  const store = fakeStore();
  const created = await handleDevlogAdmin(request("/devlog/admin/new", { method: "POST", cookie: await cookie(), form: { date: "2026-09-26" } }), env, store, now);
  assert.equal(created.headers.get("location"), "/devlog/admin/posts/2026-09-26-devlog/");
  assert.deepEqual(store.calls.create[0], ["2026-09-26", now.toISOString()]);
  const invalid = await handleDevlogAdmin(request("/devlog/admin/new", { method: "POST", cookie: await cookie(), form: { date: "2026-02-30" } }), env, store, now);
  assert.equal(invalid.status, 400);
});

test("미리보기는 로그인한 작성자에게 escape된 HTML 조각을 준다", async () => {
  const response = await handleDevlogAdmin(request("/devlog/admin/preview", { method: "POST", cookie: await cookie(), form: { body: "## 제목\n\n<img src=x onerror=alert(1)>" } }), env, fakeStore(), now);
  const html = await response.text();
  assert.match(html, /<h2 id="section-1">제목<\/h2>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("관리 경로가 아니면 넘겨준다", async () => {
  assert.equal(await handleDevlogAdmin(request("/devlog/"), env, fakeStore(), now), null);
});

test("공개 화면은 작성자에게만 수정 링크를 보여 준다", () => {
  const post = { slug: "2026-09-25-devlog", post_date: "2026-09-25", title: "제목", summary: "", body_markdown: "본문", ai_generated: 0, commits: [] };
  assert.doesNotMatch(renderDevlogPost(post, {}, ORIGIN), /이 글 수정/);
  assert.match(renderDevlogPost(post, {}, ORIGIN, { admin: true }), /href="\/devlog\/admin\/posts\/2026-09-25-devlog\/">이 글 수정/);
  assert.doesNotMatch(renderDevlogHome([post], {}, ORIGIN), /글 관리/);
  assert.match(renderDevlogHome([post], {}, ORIGIN, { admin: true }), /글 관리 · 새 글 쓰기/);
});

test("참고 자료용 Markdown: h4~h6, 인용, 백틱이 든 긴 울타리", () => {
  const html = markdownToHtml("#### 흐름\n\n> 첫 줄\n> 둘째 줄\n\n````diff\n+```js\n+x\n+```\n````\n\n끝", { headingIds: true });
  assert.match(html, /<h4>흐름<\/h4>/, "h4에는 목차 id를 붙이지 않는다");
  assert.match(html, /<blockquote><p>첫 줄 둘째 줄<\/p><\/blockquote>/);
  assert.match(html, /<pre><code>\+```js\n\+x\n\+```<\/code><\/pre>/);
  assert.match(html, /<p>끝<\/p>/);
});

test("맞춤법 제안은 원문에 그대로 있는 구절만, 코드 밖에서만 남긴다", () => {
  const text = "어느정도 만들었다. `어느정도`는 코드다.\n\n```js\n게임내\n```\n게임내 상황";
  const raw = `<think>생각</think>설명 [
    {"original": "어느정도", "suggestion": "어느 정도", "reason": "띄어쓰기"},
    {"original": "어느정도", "suggestion": "어느 정도", "reason": "중복"},
    {"original": "없는 구절", "suggestion": "x", "reason": "환각"},
    {"original": "게임내 상황", "suggestion": "게임 내 상황", "reason": "띄어쓰기"},
    {"original": "같음", "suggestion": "같음"},
    {"original": "만들었다", "suggestion": ""}
  ] 끝`;
  const issues = parseIssues(raw, text, "body");
  assert.deepEqual(issues.map((issue) => [issue.original, issue.suggestion]), [["어느정도", "어느 정도"], ["게임내 상황", "게임 내 상황"]]);
  assert.deepEqual(parseIssues("[]", text, "body"), []);
  assert.deepEqual(parseIssues("JSON이 아님", text, "body"), []);
  // 코드 안에만 있는 구절은 버린다.
  assert.deepEqual(parseIssues('[{"original": "`어느정도`는", "suggestion": "x"}]', text, "body"), []);
});

test("긴 본문은 빈 줄 기준으로 나눠 검사한다", () => {
  const chunks = chunkText(["가".repeat(900), "나".repeat(900), "다".repeat(100)].join("\n\n"), 1500);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].startsWith("가"));
  assert.ok(chunks[1].startsWith("나") && chunks[1].endsWith("다"));
});

test("맞춤법 검사 경로는 제목·요약·본문의 제안을 모아 돌려주고, 실패하면 502로 알린다", async () => {
  const calls = [];
  const ai = { run: async (model, args) => { calls.push({ model, text: args.messages[1].content }); return { choices: [{ message: { content: '[{"original": "어느정도", "suggestion": "어느 정도", "reason": "띄어쓰기"}]' } }] }; } };
  const response = await handleDevlogAdmin(request("/devlog/admin/spellcheck", { method: "POST", cookie: await cookie(), form: { title: "제목", summary: "", body: "어느정도 만들었다." } }), { ...env, AI: ai }, fakeStore(), now);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).issues, [{ field: "body", original: "어느정도", suggestion: "어느 정도", reason: "띄어쓰기" }]);
  assert.equal(calls.length, 2, "빈 요약은 검사하지 않는다");
  assert.equal(calls[0].model, "@cf/openai/gpt-oss-120b");
  assert.match(calls[1].text, /<<<\n어느정도 만들었다\.\n>>>/);

  const failing = await handleDevlogAdmin(request("/devlog/admin/spellcheck", { method: "POST", cookie: await cookie(), form: { title: "t", body: "b" } }), { ...env, AI: { run: async () => { throw new Error("down"); } } }, fakeStore(), now);
  assert.equal(failing.status, 502);
  assert.match((await failing.json()).error, /맞춤법 검사를 하지 못했습니다/);

  const anonymous = await handleDevlogAdmin(request("/devlog/admin/spellcheck", { method: "POST", form: { body: "b" } }), { ...env, AI: ai }, fakeStore(), now);
  assert.equal(anonymous.status, 401);
});

test("편집기 참고 자료에는 코드 내용 없이 커밋 메시지만 보여 준다", async () => {
  const reference = "- 오늘 이 작업을 시작한 계기는?\n\n##### `abc1234` fix: guard\n\n> 본문 설명\n>\n> Co-Authored-By: Claude <noreply@anthropic.com>\n\n변경 파일 48개 (30개만 표시), +3 -1\n- `src/user.ts` modified +3 -1\n- `docs/a b.md` added +10 -0\n\n`src/user.ts` diff 발췌:\n\n````diff\n+```js\n+ if (!userId) return null;\n````\n\n##### `def5678` docs\n\n※ 상세 조회 한도 밖이라 메시지만 있습니다.\n\n##### `0000000` old\n\n_상세 조회 한도 밖이라 메시지만 있습니다._";
  const stripped = withoutDiffExcerpts(reference);
  assert.doesNotMatch(stripped, /diff 발췌|userId|변경 파일|src\/user\.ts|a b\.md|상세 조회|Co-Authored-By/);
  assert.match(stripped, /> 본문 설명\n\n/, "트레일러를 뺀 뒤 빈 인용 줄도 남기지 않는다");
  assert.match(stripped, /`def5678` docs/);
  assert.match(stripped, /^- 오늘 이 작업을 시작한 계기는\?$/m, "질문 목록은 남긴다");
  const html = await (await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { cookie: await cookie() }), env, fakeStore([{ ...draft, reference_markdown: reference }]), now)).text();
  assert.doesNotMatch(html, /userId/);
  assert.match(html, /id="spell-run"/);
});

test("저장소 소제목 뼈대: 만들기, 빠진 것만 더하기, 빈 부분 찾기", async () => {
  const { repoOutline, addRepoHeadings, emptySections } = await import("../../shared/devlog-writing.mjs");
  assert.equal(repoOutline(["o/game", "o/localRAG", "o/game"]), "## game\n\n\n## localRAG");
  assert.equal(addRepoHeadings("## game\n\n소리", ["o/game", "o/stock_chatbot"]), "## game\n\n소리\n\n## stock_chatbot");
  assert.equal(addRepoHeadings("## GAME\n\n소리", ["o/game"]), "## GAME\n\n소리", "대소문자가 달라도 같은 소제목으로 본다");
  assert.equal(addRepoHeadings("", ["o/a.b"]), "## a.b");
  assert.deepEqual(emptySections("도입\n\n## game\n\n소리\n\n## localRAG\n\n\n## stock_chatbot\n"), ["localRAG", "stock_chatbot"]);
  assert.deepEqual(emptySections("## game\n소리"), []);
});

test("편집기는 빈 초안을 저장소 소제목으로 채워 열고, 빈 소제목이 남으면 발행하지 않는다", async () => {
  const repos = { ...draft, body_markdown: "", commits: [{ repo: "o/game", sha: "a".repeat(40), message: "소리" }, { repo: "o/localRAG", sha: "b".repeat(40), message: "검색" }, { repo: "o/game", sha: "c".repeat(40), message: "빛" }] };
  const html = await (await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { cookie: await cookie() }), env, fakeStore([repos]), now)).text();
  assert.match(html, /aria-label="본문">## game\n\n\n## localRAG<\/textarea>/);
  assert.match(html, /id="add-repo-headings" data-repos="\[&quot;game&quot;,&quot;localRAG&quot;\]"/);

  const store = fakeStore([repos]);
  const rejected = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), form: { title: "t", summary: "", body: "## game\n\n소리를 넣었다.\n\n## localRAG\n", action: "publish" } }), env, store, now);
  assert.equal(rejected.status, 422);
  assert.match(await rejected.text(), /비어 있는 소제목이 있습니다: localRAG/);
  assert.equal(store.calls.update.length, 0);
  // 임시 저장은 빈 소제목이 있어도 된다.
  const saved = await handleDevlogAdmin(request("/devlog/admin/posts/2026-09-25-devlog/", { method: "POST", cookie: await cookie(), form: { title: "t", summary: "", body: "## game\n\n## localRAG\n", action: "save" } }), env, store, now);
  assert.equal(saved.status, 303);
});
