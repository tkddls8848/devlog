import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { normalizeUrl, parseFeed } from "../tools/rss.mjs";
import * as arstechnica from "../tools/sources/arstechnica.mjs";
import * as aws from "../tools/sources/aws.mjs";
import * as github from "../tools/sources/github.mjs";
import * as googlecloud from "../tools/sources/googlecloud.mjs";
import * as hackernews from "../tools/sources/hackernews.mjs";
import * as theverge from "../tools/sources/theverge.mjs";

const all = [hackernews, aws, googlecloud, github, arstechnica, theverge];

// 수집기는 source·kind·collect()만 내보내고 안쪽은 감춰져 있다. 네트워크를
// 스텁해 실제 코드 경로를 그대로 태운다.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (handler) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
};

const SINCE = new Date("2026-08-17T00:00:00.000Z");

test("여섯 수집기 모두 이름과 분류, collect()를 내보낸다", () => {
  // news-digest는 sources[index].source로 실패 로그와 묶음 제목을 만든다.
  // 이름이 빠지면 수집이 조용히 "undefined: 0건"이 된다.
  for (const source of all) {
    assert.equal(typeof source.source, "string");
    assert.ok(source.source.length);
    assert.equal(typeof source.kind, "string");
    assert.ok(source.kind.length);
    assert.equal(typeof source.collect, "function");
  }
});

test("수집기 이름은 서로 겹치지 않는다", () => {
  // 이름이 겹치면 묶기에서 한쪽이 다른 쪽 항목을 통째로 잃는다.
  const names = all.map((source) => source.source);
  assert.equal(new Set(names).size, names.length);
});

// ------------------------------------------------------------------ 피드 파서

const rss = (items) => `<rss><channel>${items.join("")}</channel></rss>`;

const rssItem = ({ title, link, pubDate, guid }) =>
  "<item>" +
  (title === undefined ? "" : `<title>${title}</title>`) +
  (link === undefined ? "" : `<link>${link}</link>`) +
  (guid === undefined ? "" : `<guid>${guid}</guid>`) +
  (pubDate === undefined ? "" : `<pubDate>${pubDate}</pubDate>`) +
  "</item>";

test("RSS 2.0 항목에서 제목·주소·날짜를 읽는다", () => {
  const rows = parseFeed(
    rss([
      rssItem({
        title: "Amazon S3 새 기능",
        link: "https://aws.amazon.com/blogs/aws/s3/",
        pubDate: "Mon, 17 Aug 2026 15:04:05 GMT",
      }),
    ])
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Amazon S3 새 기능");
  assert.equal(rows[0].url, "https://aws.amazon.com/blogs/aws/s3/");
  assert.equal(rows[0].at.toISOString(), "2026-08-17T15:04:05.000Z");
});

test("Atom 항목의 link href와 published를 읽는다", () => {
  const rows = parseFeed(
    `<feed><entry>
       <title>The Verge 기사</title>
       <link rel="edit" href="https://www.theverge.com/edit/1" />
       <link rel="alternate" type="text/html" href="https://www.theverge.com/2026/8/17/1" />
       <published>2026-08-17T09:00:00Z</published>
     </entry></feed>`
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://www.theverge.com/2026/8/17/1");
  assert.equal(rows[0].at.toISOString(), "2026-08-17T09:00:00.000Z");
});

test("published가 없는 Atom 항목은 updated로 대신한다", () => {
  const rows = parseFeed(
    `<feed><entry>
       <title>갱신만 있는 글</title>
       <link href="https://github.blog/post/" />
       <updated>2026-08-16T22:10:00Z</updated>
     </entry></feed>`
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].at.toISOString(), "2026-08-16T22:10:00.000Z");
});

test("제목·주소·날짜가 빠지거나 깨진 항목만 건너뛴다", () => {
  // flatMap 안에서 Date가 던지면 항목 하나 때문에 소스 전체가 실패한다.
  const rows = parseFeed(
    rss([
      rssItem({ title: "정상", link: "https://example.com/a", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
      rssItem({ title: "날짜 없음", link: "https://example.com/b" }),
      rssItem({ title: "날짜 깨짐", link: "https://example.com/c", pubDate: "언젠가" }),
      rssItem({ link: "https://example.com/d", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
      rssItem({ title: "주소 없음", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
      rssItem({ title: "주소가 http가 아님", link: "mailto:a@b.c", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
    ])
  );

  assert.deepEqual(
    rows.map((row) => row.title),
    ["정상"]
  );
});

test("CDATA와 HTML 엔티티를 풀어서 읽는다", () => {
  const rows = parseFeed(
    rss([
      rssItem({
        title: "<![CDATA[Rust &amp; Go: 무엇을 &quot;고를까&quot;]]>",
        link: "https://example.com/a?x=1&amp;y=2",
        pubDate: "Mon, 17 Aug 2026 00:00:00 GMT",
      }),
    ])
  );

  assert.equal(rows[0].title, 'Rust & Go: 무엇을 "고를까"');
  assert.equal(rows[0].url, "https://example.com/a?x=1&y=2");
});

test("link가 없으면 guid를 주소로 쓴다", () => {
  const rows = parseFeed(
    rss([
      rssItem({
        title: "guid만 있는 글",
        guid: "https://cloudblog.withgoogle.com/post/",
        pubDate: "Mon, 17 Aug 2026 00:00:00 GMT",
      }),
    ])
  );

  assert.equal(rows[0].url, "https://cloudblog.withgoogle.com/post/");
});

// ------------------------------------------------------------- 주소 정규화

test("추적 파라미터와 www, 끝 슬래시를 지운 주소로 중복을 본다", () => {
  const plain = normalizeUrl("https://example.com/post");
  assert.equal(normalizeUrl("https://www.example.com/post/?utm_source=rss#top"), plain);
  assert.equal(normalizeUrl("http://EXAMPLE.com/post"), plain);
  assert.notEqual(normalizeUrl("https://example.com/other"), plain);
});

test("주소가 아닌 값은 그대로 두고 던지지 않는다", () => {
  assert.equal(normalizeUrl("주소 아님"), "주소 아님");
});

test("질의 문자열이 다르면 다른 글로 본다", () => {
  // Hacker News의 토론 링크는 item?id=…로만 갈린다.
  assert.notEqual(
    normalizeUrl("https://news.ycombinator.com/item?id=1"),
    normalizeUrl("https://news.ycombinator.com/item?id=2")
  );
});

// ------------------------------------------------------------ 피드 수집기

test("피드 수집기는 최신 글부터 limit만큼 담는다", async () => {
  const calls = stub(
    () =>
      new Response(
        rss([
          rssItem({ title: "옛 글", link: "https://github.blog/old/", pubDate: "Mon, 10 Aug 2026 00:00:00 GMT" }),
          rssItem({ title: "새 글", link: "https://github.blog/new/", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
        ]),
        { status: 200 }
      )
  );

  const rows = await github.collect(SINCE);

  assert.equal(calls[0].url, "https://github.blog/feed/");
  assert.deepEqual(
    rows.map((row) => row.title),
    ["새 글", "옛 글"],
    "최신 글이 앞에 온다"
  );
  assert.equal(rows[0].source, github.source);
  assert.equal(rows[0].kind, github.kind);
  assert.equal(rows[0].at, "2026-08-17T00:00:00.000Z", "at은 ISO 문자열이다");
});

test("피드가 오류를 돌려주면 수집기가 던진다", async () => {
  // 던져야 news-digest가 부분 실패로 잡고 종료 코드에 싣는다.
  stub(() => new Response("", { status: 503 }));
  await assert.rejects(() => aws.collect(SINCE), /피드 503/);
});

// ------------------------------------------------------- Hacker News 수집기

const hnHit = (hit) => ({
  objectID: "1",
  title: "제목",
  url: "https://example.com/a",
  created_at: "2026-08-17T10:00:00.000Z",
  points: 250,
  num_comments: 80,
  ...hit,
});

test("Hacker News는 시간과 점수로 거른 검색을 부른다", async () => {
  const calls = stub(() => new Response(JSON.stringify({ hits: [hnHit({})] }), { status: 200 }));

  const rows = await hackernews.collect(SINCE);

  const cutoff = Math.floor(SINCE.getTime() / 1000);
  assert.match(calls[0].url, new RegExp(`created_at_i>${cutoff}`));
  assert.match(calls[0].url, /points>\d+/);
  assert.deepEqual(rows, [
    {
      source: hackernews.source,
      kind: hackernews.kind,
      title: "제목",
      url: "https://example.com/a",
      at: "2026-08-17T10:00:00.000Z",
      note: "250 points · 댓글 80",
    },
  ]);
});

test("외부 주소가 없는 글은 토론 페이지로 보낸다", async () => {
  stub(() =>
    new Response(JSON.stringify({ hits: [hnHit({ objectID: "4242", url: null, title: "Ask HN: 무엇을" })] }), {
      status: 200,
    })
  );

  const rows = await hackernews.collect(SINCE);
  assert.equal(rows[0].url, "https://news.ycombinator.com/item?id=4242");
});

test("제목이나 시각이 깨진 Hacker News 항목은 건너뛴다", async () => {
  stub(() =>
    new Response(
      JSON.stringify({
        hits: [
          hnHit({ title: "  " }),
          hnHit({ objectID: "2", created_at: "언젠가" }),
          hnHit({ objectID: "3", title: "정상", url: "https://example.com/ok" }),
        ],
      }),
      { status: 200 }
    )
  );

  const rows = await hackernews.collect(SINCE);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["정상"]
  );
});

test("Hacker News 응답에 hits가 없으면 던진다", async () => {
  stub(() => new Response(JSON.stringify({ message: "형식 변경" }), { status: 200 }));
  await assert.rejects(() => hackernews.collect(SINCE), /hits가 없습니다/);
});
