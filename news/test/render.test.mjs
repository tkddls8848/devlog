import assert from "node:assert/strict";
import test from "node:test";
import { markdownToHtml, renderArchive, renderFeed, renderHome, renderIssue, renderDevlogHome, renderDevlogPost } from "../worker/render.mjs";

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

test("동적 페이지는 외부 제목과 요약을 HTML escape한다", () => {
  const html = renderHome(
    [{
      slug: "2026-08-24-news",
      title: "<script>alert(1)</script>",
      summary: '"요약" & 설명',
      published_at: "2026-08-24T00:00:00.000Z",
      entry_count: 1,
      source_count: 1,
    }],
    {},
    "https://example.com"
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /&quot;요약&quot; &amp; 설명/);
});

test("제한된 Markdown만 안전한 HTML로 바꾼다", () => {
  const html = markdownToHtml("## 제목\n\n- [기사](https://example.com/a)\n- <img src=x onerror=alert(1)>");
  assert.match(html, /<h2>제목<\/h2>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("이슈 페이지와 RSS가 D1 행을 렌더링한다", () => {
  const issue = {
    slug: "2026-08-24-news",
    title: "뉴스",
    summary: "요약",
    body_markdown: "## 본문\n\n내용",
    ai_generated: 1,
    entry_count: 1,
    source_count: 1,
    published_at: "2026-08-24T00:00:00.000Z",
    sources: [{ source: "소스", kind: "분류", entries: [{ title: "기사", url: "https://example.com", at: "2026-08-24T00:00:00.000Z" }] }],
  };
  const html = renderIssue(issue, {}, "https://news.example.com");
  const rss = renderFeed([issue], "https://news.example.com");
  assert.match(html, /AI 생성/);
  assert.match(html, /오늘 읽은 소식/);
  assert.match(rss, /<rss version="2\.0">/);
  assert.match(rss, /https:\/\/news\.example\.com\/issues\/2026-08-24-news\//);
});

test("아카이브는 벤더 아이콘과 선택 필터를 렌더링한다", () => {
  const html = renderArchive([
    { vendor: "IBM", title: "IBM 가이드", url: "https://example.com/ibm", document_date: "2026-08-24", kind: "기술 문서", ref: "IBM-1" },
    { vendor: "Dell", title: "Dell 가이드", url: "https://example.com/dell", document_date: "2026-08-23", kind: "스펙 시트", ref: "DELL-1" },
  ], {}, "https://example.com");
  assert.match(html, /class="archive-chip" data-vendor="IBM"/);
  assert.match(html, /class="archive-chip" data-vendor="Dell"/);
  assert.match(html, /data-vendor="IBM"/);
  assert.match(html, /row\.dataset\.vendor===vendor/);
  // 아직 문서가 없는 벤더도 버튼을 보여 주고 0건으로 표시한다.
  assert.match(html, /data-vendor="NetApp" aria-pressed="false">.*?<strong>0<\/strong>/);
  assert.match(html, /data-vendor="Oracle" aria-pressed="false">.*?<strong>0<\/strong>/);
  assert.match(html, /id="archive-empty" hidden/);
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
