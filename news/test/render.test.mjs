import assert from "node:assert/strict";
import test from "node:test";
import { markdownToHtml, renderArchive, renderFeed, renderHome, renderIssue } from "../worker/render.mjs";

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
});
