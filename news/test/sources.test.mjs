import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { feeds } from "../tools/feeds.mjs";
import { feedSource, normalizeUrl, parseFeed } from "../tools/rss.mjs";
import * as hackernews from "../tools/sources/hackernews.mjs";

// 소스는 이름·분류·collect()만 내보내고 안쪽은 감춰져 있다. 네트워크를
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

test("Hacker News 수집기는 이름과 분류, collect()를 내보낸다", () => {
  // news-digest는 sources[index].source로 실패 로그와 묶음 제목을 만든다.
  // 이름이 빠지면 수집이 조용히 "undefined: 0건"이 된다.
  assert.equal(typeof hackernews.source, "string");
  assert.ok(hackernews.source.length);
  assert.equal(typeof hackernews.kind, "string");
  assert.ok(hackernews.kind.length);
  assert.equal(typeof hackernews.collect, "function");
});

test("피드 표의 모든 소스가 이름·분류·후보 주소를 갖춘다", () => {
  for (const feed of feeds) {
    assert.ok(feed.source?.length, `이름 없는 소스: ${JSON.stringify(feed)}`);
    assert.ok(feed.kind?.length, `${feed.source}에 분류가 없다`);
    assert.ok(Array.isArray(feed.urls) && feed.urls.length, `${feed.source}에 후보 주소가 없다`);
    for (const url of feed.urls) {
      assert.match(url, /^https:\/\//, `${feed.source}의 후보는 https여야 한다: ${url}`);
    }
  }
});

test("소스 이름은 서로 겹치지 않는다", () => {
  // 이름이 겹치면 묶기에서 한쪽이 다른 쪽 항목을 통째로 잃는다.
  const names = [hackernews.source, ...feeds.map((feed) => feed.source)];
  assert.equal(new Set(names).size, names.length);
});

test("후보 주소는 소스 안에서 중복되지 않는다", () => {
  // 같은 주소를 두 번 두드려 봐야 결과는 같고 실패만 두 배로 걸린다.
  for (const feed of feeds) {
    assert.equal(new Set(feed.urls).size, feed.urls.length, `${feed.source}에 같은 후보가 두 번 있다`);
  }
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

test("항목에 날짜가 없으면 채널의 lastBuildDate로 메운다", () => {
  // 요즘IT와 rss.app 피드는 항목에 날짜 태그를 하나도 달지 않는다. 버리기만
  // 하면 소스가 통째로 0건이 되어 조용히 빠진다.
  const rows = parseFeed(
    `<rss><channel>
       <title>요즘IT » 피드</title>
       <lastBuildDate>Tue, 18 Aug 2026 14:35:09 +0000</lastBuildDate>
       ${rssItem({ title: "날짜 없는 글", link: "https://yozm.wishket.com/magazine/detail/1" })}
     </channel></rss>`
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].at.toISOString(), "2026-08-18T14:35:09.000Z");
});

test("채널 날짜는 항목이 자기 날짜를 가지면 밀어내지 않는다", () => {
  const rows = parseFeed(
    `<rss><channel>
       <lastBuildDate>Tue, 18 Aug 2026 14:35:09 +0000</lastBuildDate>
       ${rssItem({ title: "제 날짜가 있는 글", link: "https://example.com/a", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" })}
     </channel></rss>`
  );

  assert.equal(rows[0].at.toISOString(), "2026-08-17T00:00:00.000Z");
});

test("항목 안의 날짜를 채널 날짜로 착각하지 않는다", () => {
  // 첫 항목까지 훑으면 앞 항목의 pubDate가 뒤따르는 날짜 없는 항목에 번진다.
  const rows = parseFeed(
    rss([
      rssItem({ title: "날짜 있음", link: "https://example.com/a", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
      rssItem({ title: "날짜 없음", link: "https://example.com/b" }),
    ])
  );

  assert.deepEqual(
    rows.map((row) => row.title),
    ["날짜 있음"]
  );
});

test("갱신이 멈춘 피드는 옛 채널 날짜를 그대로 받는다", () => {
  // 퀘이사존의 rss.app 피드처럼 몇 해째 멈춘 피드가 있다. 수집 시각으로
  // 메우면 옛 글이 오늘 소식으로 실린다. 옛 날짜를 남겨 수집 창이 거르게 한다.
  const rows = parseFeed(
    `<rss><channel>
       <lastBuildDate>Mon, 07 Feb 2022 08:15:52 GMT</lastBuildDate>
       ${rssItem({ title: "2022년 글", link: "https://example.com/old" })}
     </channel></rss>`
  );

  assert.equal(rows[0].at.toISOString(), "2022-02-07T08:15:52.000Z");
  assert.ok(rows[0].at < new Date("2026-01-01T00:00:00Z"));
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

test("숫자 문자 참조를 풀어서 읽는다", () => {
  // The Verge는 제목의 작은따옴표를 &#8217;로 보낸다. 풀지 않으면 목록에
  // 그대로 노출된다.
  const rows = parseFeed(
    rss([
      rssItem({
        title: "Apple&#8217;s camera-equipped AirPods",
        link: "https://www.theverge.com/1",
        pubDate: "Mon, 17 Aug 2026 00:00:00 GMT",
      }),
      rssItem({
        title: "Hex &#x2019;quote&#x2019;",
        link: "https://www.theverge.com/2",
        pubDate: "Mon, 17 Aug 2026 00:00:00 GMT",
      }),
    ])
  );

  assert.deepEqual(
    rows.map((row) => row.title),
    ["Apple\u2019s camera-equipped AirPods", "Hex \u2019quote\u2019"]
  );
});

test("두 번 감싼 숫자 참조도 한 번에 푼다", () => {
  // &amp;를 먼저 풀어야 안쪽 &#8217;이 드러난다.
  const rows = parseFeed(
    rss([
      rssItem({
        title: "ABC&amp;#8217;s livestreamed show",
        link: "https://www.theverge.com/1",
        pubDate: "Mon, 17 Aug 2026 00:00:00 GMT",
      }),
    ])
  );

  assert.equal(rows[0].title, "ABC\u2019s livestreamed show");
});

test("범위를 벗어난 숫자 참조는 원문 그대로 둔다", () => {
  // fromCodePoint가 던지면 flatMap 안이라 소스 전체가 실패한다.
  const rows = parseFeed(
    rss([
      rssItem({
        title: "Broken &#999999999; ref",
        link: "https://www.theverge.com/1",
        pubDate: "Mon, 17 Aug 2026 00:00:00 GMT",
      }),
    ])
  );

  assert.equal(rows.length, 1, "던지지 않고 항목을 살려야 한다");
  assert.equal(rows[0].title, "Broken &#999999999; ref");
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

const TEST_FEED = {
  source: "테스트 소스",
  kind: "기술 블로그",
  urls: ["https://example.com/first.xml", "https://example.com/second.xml"],
  limit: 2,
};

test("피드 수집기는 최신 글부터 limit만큼 담는다", async () => {
  const calls = stub(
    () =>
      new Response(
        rss([
          rssItem({ title: "옛 글", link: "https://example.com/old/", pubDate: "Mon, 10 Aug 2026 00:00:00 GMT" }),
          rssItem({ title: "새 글", link: "https://example.com/new/", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" }),
          rssItem({ title: "중간 글", link: "https://example.com/mid/", pubDate: "Fri, 14 Aug 2026 00:00:00 GMT" }),
        ]),
        { status: 200 }
      )
  );

  const rows = await feedSource(TEST_FEED)();

  assert.equal(calls.length, 1, "첫 후보가 되면 다음 후보는 두드리지 않는다");
  assert.equal(calls[0].url, TEST_FEED.urls[0]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["새 글", "중간 글"],
    "최신 글부터 limit만큼 남는다"
  );
  assert.equal(rows[0].source, TEST_FEED.source);
  assert.equal(rows[0].kind, TEST_FEED.kind);
  assert.equal(rows[0].at, "2026-08-17T00:00:00.000Z", "at은 ISO 문자열이다");
});

test("첫 후보가 막히면 다음 후보를 두드린다", async () => {
  const calls = stub((url) =>
    url === TEST_FEED.urls[0]
      ? new Response("", { status: 404 })
      : new Response(
          rss([rssItem({ title: "두 번째 후보", link: "https://example.com/a", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" })]),
          { status: 200 }
        )
  );

  const rows = await feedSource(TEST_FEED)();

  assert.equal(calls.length, 2);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["두 번째 후보"]
  );
});

test("피드가 아닌 200 응답은 후보 실패로 본다", async () => {
  // 개편된 사이트는 없는 피드 자리에 200과 함께 안내 HTML을 준다. 이걸 빈
  // 피드로 받아들이면 살아 있는 다음 후보를 놓친다.
  const calls = stub((url) =>
    url === TEST_FEED.urls[0]
      ? new Response("<html><body>피드가 이전되었습니다</body></html>", { status: 200 })
      : new Response(
          rss([rssItem({ title: "옮겨 간 피드", link: "https://example.com/a", pubDate: "Mon, 17 Aug 2026 00:00:00 GMT" })]),
          { status: 200 }
        )
  );

  const rows = await feedSource(TEST_FEED)();

  assert.equal(calls.length, 2);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["옮겨 간 피드"]
  );
});

test("항목이 0건이어도 피드로 읽히면 그 후보를 쓴다", async () => {
  // 조용한 날과 죽은 주소는 다르다. 0건 경고는 news-digest가 따로 남긴다.
  const calls = stub(() => new Response(rss([]), { status: 200 }));

  const rows = await feedSource(TEST_FEED)();

  assert.equal(calls.length, 1, "0건이라고 다음 후보로 넘어가지 않는다");
  assert.deepEqual(rows, []);
});

test("후보가 모두 막히면 두드린 주소를 모아 던진다", async () => {
  // 던져야 news-digest가 부분 실패로 잡고 종료 코드에 싣는다. 어느 주소가
  // 왜 막혔는지 함께 남겨야 feeds.mjs를 고칠 수 있다.
  stub(() => new Response("", { status: 503 }));

  await assert.rejects(() => feedSource(TEST_FEED)(), (error) => {
    assert.match(error.message, /테스트 소스 피드를 찾지 못했습니다/);
    assert.match(error.message, /first\.xml/);
    assert.match(error.message, /second\.xml/);
    assert.match(error.message, /503/);
    return true;
  });
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
