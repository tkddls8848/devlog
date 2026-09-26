import assert from "node:assert/strict";
import test from "node:test";
import { createSession, passwordMatches, sessionValid, SESSION_SECONDS } from "../worker/devlog-auth.mjs";
import { handleDevlogAdmin } from "../worker/devlog-admin.mjs";
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

test("비밀번호가 없거나 12자 미만이면 누구도 로그인할 수 없다", async () => {
  assert.equal(await passwordMatches({}, ""), false);
  assert.equal(await passwordMatches({ DEVLOG_ADMIN_PASSWORD: "short" }, "short"), false);
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
  assert.match(html, /이전 AI 자동 기록/);
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
