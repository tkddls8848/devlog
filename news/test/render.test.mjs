import assert from "node:assert/strict";
import test from "node:test";
import { markdownToHtml, renderDevlogHome, renderDevlogPost, renderNotFound } from "../worker/render.mjs";

test("기술 글의 코드와 강조는 렌더링하고 HTML은 실행하지 않는다", () => {
  const html = markdownToHtml("## 경계\n\n**검증**과 `userId`\n\n```js\n<script>alert(1)</script>\n## 코드 안의 제목\n```", { headingIds: true });
  assert.match(html, /<h2 id="section-1">경계<\/h2>/);
  assert.match(html, /<strong>검증<\/strong>/);
  assert.match(html, /<code>userId<\/code>/);
  assert.match(html, /<pre><code>&lt;script&gt;/);
  assert.doesNotMatch(html, /id="section-2"|<script>/);
});

test("개발 기록은 실제 데이터로 목록, 목차, 근거를 표시한다", () => {
  const post = { slug: "2026-09-22-devlog", post_date: "2026-09-22", title: "<img src=x> 제목", summary: "입력 경계 정리", ai_generated: 1, body_markdown: "## [조건](https://example.com)\n\n내용\n\n### 조건\n\n내용", commits: [{ repo: "owner/app", sha: "a".repeat(40), message: "fix: guard user" }] };
  const home = renderDevlogHome([post], {}, "https://example.com");
  assert.match(home, /journal-featured/);
  assert.match(home, /<form class="journal-search" method="get" action="\/devlog\/"/);
  assert.match(home, /name="q"/);
  assert.match(home, /&lt;img src=x&gt; 제목/);
  assert.match(home, /<title>개발 기록 · devlog<\/title>/);
  const html = renderDevlogPost(post, {}, "https://example.com");
  assert.match(html, /href="#section-1">조건<\/a>/);
  assert.match(html, /id="section-2"/);
  assert.match(html, /커밋 1개 · 저장소 1개/);
  assert.match(html, /<details><summary>참고한 커밋 1개/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(renderDevlogHome([], {}, "https://example.com"), /첫 번째 기록을 기다리고/);
});

test("제한된 Markdown만 안전한 HTML로 바꾼다", () => {
  const html = markdownToHtml("## 제목\n\n- [기사](https://example.com/a)\n- <img src=x onerror=alert(1)>");
  assert.match(html, /<h2>제목<\/h2>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("개발 기록 목록은 페이지 번호로 나누고 검색어를 유지한다", async () => {
  const { pageWindow } = await import("../worker/render.mjs");
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, "…", 20]);
  assert.deepEqual(pageWindow(10, 20), [1, "…", 9, 10, 11, "…", 20]);
  assert.deepEqual(pageWindow(20, 20), [1, "…", 19, 20]);

  const post = (n) => ({ slug: `2026-09-${String(n).padStart(2, "0")}-devlog`, post_date: `2026-09-${String(n).padStart(2, "0")}`, title: `글 ${n}`, summary: "", ai_generated: 0 });
  const first = renderDevlogHome({ posts: [1, 2, 3, 4, 5].map(post), total: 12, page: 1, pages: 3, query: "" }, {}, "https://example.com");
  assert.match(first, /journal-featured/);
  assert.match(first, /개발 기록 <span>12<\/span>/);
  assert.match(first, /<span class="journal-page is-current" aria-current="page">1<\/span>/);
  assert.match(first, /href="\/devlog\/\?page=2" rel="next"/);
  assert.match(first, /<link rel="canonical" href="https:\/\/example\.com\/devlog\/" \/>/);

  const second = renderDevlogHome({ posts: [6, 7].map(post), total: 12, page: 2, pages: 3, query: "" }, {}, "https://example.com");
  assert.doesNotMatch(second, /journal-featured/, "최신 글 강조는 첫 페이지에만");
  assert.match(second, /href="\/devlog\/" rel="prev"/);
  assert.match(second, /<title>개발 기록 2쪽 · devlog<\/title>/);
  assert.match(second, /canonical" href="https:\/\/example\.com\/devlog\/\?page=2"/);

  const search = renderDevlogHome({ posts: [post(8)], total: 6, page: 1, pages: 2, query: "<게임>" }, {}, "https://example.com");
  assert.match(search, /value="&lt;게임&gt;"/);
  assert.match(search, /href="\/devlog\/\?q=%3C%EA%B2%8C%EC%9E%84%3E&amp;page=2"/);
  assert.match(search, /noindex, follow/);
  assert.doesNotMatch(search, /journal-featured/);
  assert.match(renderDevlogHome({ posts: [], total: 0, page: 1, pages: 1, query: "없음" }, {}, "https://example.com"), /검색 결과가 없습니다/);
  assert.doesNotMatch(first.replace(/journal-pagination[\s\S]*/, ""), /journal-pagination/);
  assert.doesNotMatch(renderDevlogHome([post(1)], {}, "https://example.com"), /journal-pagination/, "한 페이지면 번호를 그리지 않는다");
});

test("내비게이션에는 개발 일지만 있고 뉴스레터·아카이브·RSS 링크는 없다", () => {
  const html = renderNotFound({});
  assert.match(html, />개발 일지<\/a>/);
  assert.doesNotMatch(html, /뉴스레터<\/a>|아카이브<\/a>|feed\.xml|specsheet/);
  assert.match(html, /개발 기록 목록/);
});
