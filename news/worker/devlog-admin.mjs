// 개발 기록 작성 화면. /devlog/admin/ 아래에서 로그인한 작성자만 초안을 쓰고,
// 발행하고, 발행한 글을 고치거나 비공개로 돌린다.
import { adminConfigured, clearedCookie, createSession, isAdmin, passwordMatches, sameOrigin, sessionCookie } from "./devlog-auth.mjs";
import { escapeHtml, layout, markdownToHtml } from "./render.mjs";

const DAY = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" });
const STAMP = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const LIMITS = { title: 200, summary: 500, body: 100_000 };

const headers = (extra = {}) => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  ...extra,
});
const page = (body, status = 200, extra = {}) => new Response(body, { status, headers: headers(extra) });
const redirect = (location, extra = {}) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store", ...extra } });
const adminLayout = (env, title, content, scripts = []) => layout({ env, title, content, current: "devlog", robots: "noindex, nofollow", scripts });
const stamp = (value) => (value ? STAMP.format(new Date(value)) : "");
const postDay = (value) => DAY.format(new Date(`${value}T00:00:00+09:00`));
const safeNext = (value) => (/^\/devlog\/[\w\-./]*$/.test(String(value || "")) && !String(value).includes("..") ? value : "/devlog/admin/");

export function renderLogin(env, { error = "", next = "/devlog/admin/" } = {}) {
  const configured = adminConfigured(env);
  const content = `<section class="admin-login">
    <p class="journal-eyebrow">WRITING DESK</p>
    <h1>작성자 로그인</h1>
    ${configured ? `<p class="admin-muted">개발 기록을 쓰고 고치려면 로그인하세요.</p>
    ${error ? `<p class="admin-flash admin-flash-error" role="alert">${escapeHtml(error)}</p>` : ""}
    <form method="post" action="/devlog/admin/login" class="admin-login-form">
      <input type="hidden" name="next" value="${escapeHtml(safeNext(next))}" />
      <label class="editor-field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required autofocus /></label>
      <button type="submit" class="admin-button admin-button-primary">로그인</button>
    </form>` : `<p class="admin-flash admin-flash-error" role="alert">작성자 비밀번호가 설정되지 않았습니다.</p>
    <p class="admin-muted">Worker secret <code>DEVLOG_ADMIN_PASSWORD</code>를 등록하면 로그인할 수 있습니다.</p>`}
    <p><a href="/devlog/">← 개발 기록으로</a></p>
  </section>`;
  return adminLayout(env, "작성자 로그인", content);
}

export function renderDashboard(env, posts, { today = TODAY.format(new Date()) } = {}) {
  const drafts = posts.filter((post) => post.status === "draft");
  const published = posts.filter((post) => post.status === "published");
  const row = (post) => {
    const editUrl = `/devlog/admin/posts/${encodeURIComponent(post.slug)}/`;
    const label = post.status === "draft"
      ? (post.body_length ? `<span class="admin-tag admin-tag-writing">쓰는 중</span>` : `<span class="admin-tag">아직 안 씀</span>`)
      : post.ai_generated ? `<span class="admin-tag admin-tag-legacy">이전 AI 자동 기록</span>` : `<span class="admin-tag admin-tag-done">작업 회고</span>`;
    const facts = [post.commit_count ? `커밋 ${post.commit_count}건` : "커밋 없음", post.has_reference ? "참고 자료 있음" : "", post.updated_at ? `수정 ${stamp(post.updated_at)}` : ""].filter(Boolean).join(" · ");
    return `<li class="admin-row">
      <div class="admin-row-main">
        <p class="admin-row-meta"><time datetime="${escapeHtml(post.post_date)}">${postDay(post.post_date)}</time>${label}</p>
        <a class="admin-row-title" href="${editUrl}">${escapeHtml(post.title)}</a>
        <p class="admin-muted">${escapeHtml(facts)}</p>
      </div>
      <div class="admin-row-actions">
        <a class="admin-button${post.status === "draft" ? " admin-button-primary" : ""}" href="${editUrl}">${post.status === "draft" ? "쓰기" : "수정"}</a>
        ${post.status === "published" ? `<a class="admin-button admin-button-quiet" href="/devlog/posts/${encodeURIComponent(post.slug)}/">보기</a>` : ""}
      </div>
    </li>`;
  };
  const content = `<section class="admin-head">
    <div><p class="journal-eyebrow">WRITING DESK</p><h1>글 관리</h1>
    <p class="admin-muted">매일 09:10 KST에 전날까지의 커밋으로 초안과 참고 자료가 만들어집니다. 커밋이 없는 날도 새 글을 쓸 수 있습니다.</p></div>
    <form method="post" action="/devlog/admin/logout"><button type="submit" class="admin-button admin-button-quiet">로그아웃</button></form>
  </section>
  <form method="post" action="/devlog/admin/new" class="admin-new">
    <label class="editor-field"><span>날짜</span><input type="date" name="date" value="${escapeHtml(today)}" required /></label>
    <button type="submit" class="admin-button admin-button-primary">새 글 쓰기</button>
  </form>
  <section class="admin-section" aria-labelledby="drafts-title">
    <h2 id="drafts-title">쓸 차례인 초안 <span>${drafts.length}</span></h2>
    ${drafts.length ? `<ul class="admin-list">${drafts.map(row).join("")}</ul>` : '<p class="admin-muted">쓰지 않은 초안이 없습니다.</p>'}
  </section>
  <section class="admin-section" aria-labelledby="published-title">
    <h2 id="published-title">발행한 글 <span>${published.length}</span></h2>
    ${published.length ? `<ul class="admin-list">${published.map(row).join("")}</ul>` : '<p class="admin-muted">아직 발행한 글이 없습니다.</p>'}
  </section>`;
  return adminLayout(env, "글 관리", content);
}

const FLASH = {
  saved: "저장했습니다.",
  live: "저장했습니다. 공개 글에 바로 반영됐습니다.",
  published: "발행했습니다. 개발 기록 목록에 공개됩니다.",
  unpublished: "비공개로 돌렸습니다. 공개 목록에서 빠졌습니다.",
};

export function renderEditor(env, post, { flash = "", error = "", values = null } = {}) {
  const draft = post.status === "draft";
  const form = values || { title: post.title, summary: post.summary, body: post.body_markdown };
  const groups = new Map();
  for (const commit of post.commits || []) {
    if (!groups.has(commit.repo)) groups.set(commit.repo, []);
    groups.get(commit.repo).push(commit);
  }
  const commits = [...groups].map(([repo, items]) => `<p class="editor-commit-repo">${escapeHtml(repo)}</p><ul class="editor-commits">${items.map((commit) => `<li><a href="https://github.com/${escapeHtml(repo)}/commit/${escapeHtml(commit.sha)}" rel="noopener" target="_blank"><code>${escapeHtml(commit.sha.slice(0, 7))}</code></a> ${escapeHtml(commit.message)}</li>`).join("")}</ul>`).join("");
  const reference = String(post.reference_markdown || "").trim();
  const status = draft
    ? '<span class="admin-tag">초안 · 공개되지 않음</span>'
    : '<span class="admin-tag admin-tag-done">발행됨</span>';
  const content = `<a class="journal-back" href="/devlog/admin/">← 글 관리</a>
  <form method="post" action="/devlog/admin/posts/${encodeURIComponent(post.slug)}/" class="editor" id="editor" data-slug="${escapeHtml(post.slug)}">
    <div class="editor-shell">
      <section class="editor-main" aria-label="글 쓰기">
        <p class="editor-status"><time datetime="${escapeHtml(post.post_date)}">${postDay(post.post_date)}</time>${status}${post.updated_at ? `<span>마지막 저장 ${escapeHtml(stamp(post.updated_at))}</span>` : ""}</p>
        ${flash && FLASH[flash] ? `<p class="admin-flash" role="status">${FLASH[flash]}</p>` : ""}
        ${error ? `<p class="admin-flash admin-flash-error" role="alert">${escapeHtml(error)}</p>` : ""}
        <label class="editor-field"><span>제목</span><input name="title" maxlength="${LIMITS.title}" value="${escapeHtml(form.title)}" required /></label>
        <label class="editor-field"><span>요약 <small>목록 카드와 검색에 쓰입니다</small></span><textarea name="summary" rows="2" maxlength="${LIMITS.summary}">${escapeHtml(form.summary)}</textarea></label>
        <div class="editor-tabs" role="tablist" aria-label="본문 편집">
          <button type="button" role="tab" class="editor-tab is-on" data-tab="write" aria-selected="true">쓰기</button>
          <button type="button" role="tab" class="editor-tab" data-tab="preview" aria-selected="false">미리보기</button>
          <span class="editor-count" id="editor-count" aria-live="polite"></span>
        </div>
        <textarea name="body" id="editor-body" class="editor-body" rows="26" maxlength="${LIMITS.body}" placeholder="오늘 무엇을 왜 바꿨는지, 어디서 막혔고 무엇을 확인했는지 줄글로 적어 보세요. 오른쪽 참고 자료의 질문과 문장을 출발점으로 쓸 수 있습니다." aria-label="본문">${escapeHtml(form.body)}</textarea>
        <div class="editor-preview journal-prose" id="editor-preview" hidden></div>
        <p class="editor-help">## 소제목 · - 목록 · **강조** · \`코드\` · \`\`\` 코드 블록 · &gt; 인용 · Ctrl+S 저장</p>
        <div class="editor-actions">
          ${draft
            ? `<button type="submit" name="action" value="save" class="admin-button">임시 저장</button>
          <button type="submit" name="action" value="publish" class="admin-button admin-button-primary">발행하기</button>`
            : `<button type="submit" name="action" value="save" class="admin-button admin-button-primary">저장하고 반영</button>
          <button type="submit" name="action" value="unpublish" class="admin-button admin-button-quiet" data-confirm="공개 목록에서 내리고 초안으로 돌릴까요?">비공개로 돌리기</button>
          <a class="admin-button admin-button-quiet" href="/devlog/posts/${encodeURIComponent(post.slug)}/">공개 글 보기</a>`}
        </div>
      </section>
      <aside class="editor-reference" aria-label="참고 자료">
        <div class="editor-reference-inner">
          <p class="journal-eyebrow">참고 자료 · 발행되지 않음</p>
          ${reference ? `<div class="editor-reference-body">${markdownToHtml(reference)}</div>` : '<p class="admin-muted">이 글에는 자동으로 모은 참고 자료가 없습니다.</p>'}
          ${commits ? `<details class="editor-reference-commits"><summary>연결된 커밋 ${(post.commits || []).length}건</summary>${commits}</details>` : ""}
        </div>
      </aside>
    </div>
  </form>`;
  return adminLayout(env, `${draft ? "쓰기" : "수정"} · ${post.title}`, content, ["/assets/js/devlog-editor.js"]);
}

export function validatePost(values, status) {
  const errors = [];
  if (values.title.length > LIMITS.title) errors.push(`제목은 ${LIMITS.title}자 이하로 써 주세요.`);
  if (values.summary.length > LIMITS.summary) errors.push(`요약은 ${LIMITS.summary}자 이하로 써 주세요.`);
  if (values.body.length > LIMITS.body) errors.push(`본문은 ${LIMITS.body.toLocaleString("ko-KR")}자 이하로 써 주세요.`);
  if (!values.title) errors.push("제목을 채워 주세요.");
  if (status === "published" && !values.body) errors.push("본문을 쓴 뒤 발행해 주세요.");
  return errors;
}

const formValues = (form) => ({
  title: String(form.get("title") || "").trim(),
  summary: String(form.get("summary") || "").replace(/\s+/g, " ").trim(),
  body: String(form.get("body") || "").replace(/\r\n/g, "\n").trim(),
});

// Returns a Response for /devlog/admin/*, or null when the path is not ours.
export async function handleDevlogAdmin(request, env, store, now = new Date()) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/devlog/admin")) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (method === "POST" && !sameOrigin(request)) return page("다른 사이트에서 보낸 요청은 받지 않습니다.", 403);

  if (path === "/devlog/admin/login") {
    if (method === "GET") {
      if (await isAdmin(request, env)) return redirect(safeNext(url.searchParams.get("next")));
      return page(renderLogin(env, { next: url.searchParams.get("next") || "" }));
    }
    const form = await request.formData();
    const next = safeNext(form.get("next"));
    if (await passwordMatches(env, form.get("password"))) {
      return redirect(next, { "set-cookie": sessionCookie(await createSession(env, now.getTime())) });
    }
    // Slow down guessing; one author never needs many attempts.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return page(renderLogin(env, { error: "비밀번호가 맞지 않습니다.", next }), 401);
  }

  if (path === "/devlog/admin/logout" && method === "POST") return redirect("/devlog/", { "set-cookie": clearedCookie() });

  if (!(await isAdmin(request, env))) {
    if (method === "GET") return redirect(`/devlog/admin/login?next=${encodeURIComponent(url.pathname)}`);
    return page("로그인이 필요합니다.", 401);
  }

  if (path === "/devlog/admin" && method === "GET") {
    return page(renderDashboard(env, await store.listDevlogAdmin(), { today: TODAY.format(now) }));
  }

  if (path === "/devlog/admin/new" && method === "POST") {
    const day = String((await request.formData()).get("date") || "");
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
    if (!valid) return page("날짜 형식이 올바르지 않습니다.", 400);
    const slug = await store.createDevlogEntry(day, now.toISOString());
    return redirect(`/devlog/admin/posts/${encodeURIComponent(slug)}/`);
  }

  if (path === "/devlog/admin/preview" && method === "POST") {
    const body = String((await request.formData()).get("body") || "").slice(0, LIMITS.body);
    return page(markdownToHtml(body, { headingIds: true }));
  }

  const match = path.match(/^\/devlog\/admin\/posts\/([a-z0-9-]+)$/i);
  if (match) {
    const post = await store.getDevlogPostForEdit(match[1]);
    if (!post) return page(adminLayout(env, "없는 글", '<p class="page-intro">이 글을 찾지 못했습니다. <a href="/devlog/admin/">글 관리</a>로 돌아가세요.</p>'), 404);
    if (method === "GET") return page(renderEditor(env, post, { flash: url.searchParams.get("saved") || "" }));
    if (method !== "POST") return page("허용하지 않는 요청입니다.", 405);
    const form = await request.formData();
    const values = formValues(form);
    const action = String(form.get("action") || "save");
    const status = action === "publish" ? "published" : action === "unpublish" ? "draft" : post.status;
    const errors = validatePost(values, status);
    // Re-render with what was typed so a rejected save never loses the text.
    if (errors.length) return page(renderEditor(env, post, { error: errors.join(" "), values }), 422);
    await store.updateDevlogPost({ slug: post.slug, ...values, status, now: now.toISOString() });
    const flash = action === "publish" ? "published" : action === "unpublish" ? "unpublished" : status === "published" ? "live" : "saved";
    return redirect(`/devlog/admin/posts/${encodeURIComponent(post.slug)}/?saved=${flash}`);
  }

  return page(adminLayout(env, "없는 주소", '<p class="page-intro">없는 주소입니다. <a href="/devlog/admin/">글 관리</a>로 돌아가세요.</p>'), 404);
}
