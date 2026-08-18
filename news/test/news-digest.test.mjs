import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// news-digest.mjs는 export가 없는 실행 스크립트다. 임시 작업 폴더에서 하위
// 프로세스로 돌리고 여섯 소스와 Cloudflare AI의 네트워크만 스텁해, 저장한
// 이슈와 종료 코드까지 실제 경로로 확인한다.
const SCRIPT = fileURLToPath(new URL("../tools/news-digest.mjs", import.meta.url));
const ISSUES = "src/issues";

const STUB = `
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(process.env.NEWS_FIXTURE, "utf8"));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body, status = 200) => new Response(body, { status });

const rss = (items) =>
  "<rss><channel>" +
  items
    .map(
      (doc) =>
        "<item><title>" + doc.title + "</title><link>" + doc.url + "</link>" +
        "<pubDate>" + doc.at + "</pubDate></item>"
    )
    .join("") +
  "</channel></rss>";

globalThis.fetch = async (url) => {
  const target = String(url);

  if (target.includes("hn.algolia.com")) {
    if (fixture.hackernews?.fail) return json({ message: "다운" }, 500);
    return json({
      hits: (fixture.hackernews?.items ?? []).map((doc, index) => ({
        objectID: String(index + 1),
        title: doc.title,
        url: doc.url,
        created_at: doc.at,
        points: 300,
        num_comments: 42,
      })),
    });
  }

  if (target.includes("api.cloudflare.com")) {
    if (fixture.ai.fail) return json({ success: false, errors: [{ code: 7000, message: "모델 없음" }] }, 400);
    return json({ success: true, result: { response: fixture.ai.response } });
  }

  // 피드는 feeds.mjs의 후보 주소로 들어온다. 붙박이 목록을 테스트에 복사해 두면
  // 표가 바뀔 때마다 같이 고쳐야 하므로, 주소 안에 든 호스트로 픽스처를 찾는다.
  for (const [host, doc] of Object.entries(fixture.feeds ?? {})) {
    if (!target.includes(host)) continue;
    if (doc.fail) return text("", 503);
    return text(rss(doc.items ?? []));
  }
  // 픽스처에 없는 소스는 조용한 피드로 둔다. 실패가 아니라 0건이다.
  return text(rss([]));
};
`;

const NOTHING = { items: [] };
const AI_RESPONSE = [
  "TITLE: 오늘의 IT 다이제스트",
  "SUMMARY: 국내외 소식을 묶었습니다.",
  "",
  "## 국내 미디어",
  "",
  "본문입니다.",
].join("\n");

// 창 안에 든 시각. 실행 시점 기준으로 계산해 테스트가 날짜에 매이지 않게 한다.
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

function run({
  issues = {},
  hackernews = NOTHING,
  feeds = {},
  ai = { response: AI_RESPONSE },
  args = [],
  env = {},
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "news-digest-"));
  const fixture = path.join(dir, "fixture.json");
  const stub = path.join(dir, "stub.mjs");

  writeFileSync(fixture, JSON.stringify({ hackernews, feeds, ai }), "utf8");
  writeFileSync(stub, STUB, "utf8");
  mkdirSync(path.join(dir, ISSUES), { recursive: true });
  for (const [name, body] of Object.entries(issues)) {
    writeFileSync(path.join(dir, ISSUES, name), body, "utf8");
  }

  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(stub).href, SCRIPT, ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        NEWS_FIXTURE: fixture,
        CF_ACCOUNT_ID: "acct",
        CF_API_TOKEN: "token",
        ...env,
      },
    }
  );

  const files = readdirSync(path.join(dir, ISSUES)).sort();
  const published = files.filter((name) => !Object.hasOwn(issues, name));
  const read = (name) => readFileSync(path.join(dir, ISSUES, name), "utf8");
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    files,
    published,
    issue: published.length ? read(published[0]) : null,
    state: existsSync(path.join(dir, ".state/last-seen.json"))
      ? JSON.parse(readFileSync(path.join(dir, ".state/last-seen.json"), "utf8"))
      : null,
    leftovers: files.filter((name) => name.endsWith(".tmp")),
  };
}

const story = (title, url, hours = 2) => ({ title, url, at: hoursAgo(hours) });

// 픽스처 키는 feeds.mjs 후보 주소의 호스트다. 표에 실제로 있는 소스만 쓴다.
const ZDNET = "zdnet.co.kr";
const BYLINE = "byline.network";
const REGISTER = "theregister.com";
const TOSS = "toss.tech";

test("여러 소스의 소식을 한 편으로 묶어 발행한다", () => {
  const result = run({
    hackernews: { items: [story("HN 글", "https://example.com/hn")] },
    feeds: {
      [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] },
      [REGISTER]: { items: [story("Register 기사", "https://www.theregister.com/2026/08/18/a/")] },
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.published.length, 1);
  assert.match(result.published[0], /^\d{4}-\d{2}-\d{2}-news\.md$/);
  assert.match(result.issue, /title: "오늘의 IT 다이제스트"/);
  assert.match(result.issue, /aiGenerated: true/);
  assert.match(result.issue, /본문입니다\./);
  // 앞머리는 소스별로 묶인다. 레이아웃이 이 모양을 그대로 읽는다.
  assert.match(result.issue, /source: "Hacker News"\n {4}kind: "커뮤니티"\n {4}entries:/);
  assert.match(result.issue, /source: "지디넷코리아"\n {4}kind: "국내 미디어"/);
  assert.match(result.issue, /url: "https:\/\/zdnet\.co\.kr\/view\/\?no=1"/);
  assert.match(result.issue, /note: "300 points · 댓글 42"/);
  assert.deepEqual(result.leftovers, [], "임시 파일을 남기지 않는다");
});

test("표에 있는 소스는 모두 수집을 시도한다", () => {
  // 픽스처에 없는 소스는 조용한 피드로 답한다. 표 전체가 한 번씩 불려야 한다.
  const result = run({ feeds: { [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] } } });

  for (const name of ["Hacker News", "전자신문", "GeekNews", "The Register", "토스 테크"]) {
    assert.match(result.output, new RegExp(`${name}: \\d+건 수집`), `${name}를 수집하지 않았다`);
  }
});

test("발행한 이슈에 담긴 링크는 다시 싣지 않는다", () => {
  const previous = [
    "---",
    'title: "어제 이슈"',
    "date: 2026-08-17",
    "sources:",
    '  - source: "지디넷코리아"',
    "    entries:",
    '      - url: "https://zdnet.co.kr/view/?no=1"',
    "---",
    "",
  ].join("\n");

  const result = run({
    issues: { "2026-08-17-news.md": previous },
    // 추적 파라미터와 www만 다른 같은 글이다.
    feeds: { [ZDNET]: { items: [story("지디넷 기사", "https://www.zdnet.co.kr/view/?no=1&utm_source=rss")] } },
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /새 소식이 없습니다/);
  assert.deepEqual(result.published, [], "새 이슈를 만들지 않는다");
});

test("한 수집에서 중복으로 올라온 글은 하나만 담는다", () => {
  const result = run({
    feeds: {
      [BYLINE]: {
        items: [
          story("바이라인 기사", "https://byline.network/2026/08/a/"),
          story("바이라인 기사 재발행", "https://byline.network/2026/08/a/?utm_medium=feed"),
        ],
      },
    },
  });

  assert.match(result.output, /뉴스레터에 담을 1건/);
});

test("수집 창보다 오래된 글은 빼고 센다", () => {
  const result = run({
    feeds: {
      [BYLINE]: { items: [story("어제 글", "https://byline.network/old/", 30)] },
      [TOSS]: { items: [story("오늘 글", "https://toss.tech/article/new", 3)] },
    },
  });

  assert.match(result.output, /수집 2건, 창 안의 새 소식 1건/);
  assert.doesNotMatch(result.issue, /어제 글/);
  assert.match(result.issue, /오늘 글/);
});

test("수집 창은 NEWS_WINDOW_HOURS로 늘릴 수 있다", () => {
  const result = run({
    feeds: { [BYLINE]: { items: [story("이틀 전 글", "https://byline.network/old/", 40)] } },
    env: { NEWS_WINDOW_HOURS: "48" },
  });

  assert.match(result.output, /최근 48시간/);
  assert.match(result.issue, /이틀 전 글/);
  assert.equal(result.state.windowHours, 48);
});

test("한 소스가 뉴스레터를 다 채우지 못하게 자른다", () => {
  const many = Array.from({ length: 9 }, (_, index) =>
    story(`지디넷 ${index}`, `https://zdnet.co.kr/view/?no=${index}`, index + 1)
  );
  const result = run({
    feeds: {
      [ZDNET]: { items: many },
      [TOSS]: { items: [story("토스 글", "https://toss.tech/article/x")] },
    },
    env: { NEWS_PER_SOURCE: "3" },
  });

  assert.match(result.output, /뉴스레터에 담을 4건/);
  assert.equal(result.state.picked["지디넷코리아"], 3);
  assert.equal(result.state.picked["토스 테크"], 1);
});

test("전체 개수 상한을 넘으면 최신 글부터 남긴다", () => {
  const result = run({
    feeds: {
      [ZDNET]: {
        items: [
          story("가장 새 글", "https://zdnet.co.kr/view/?no=1", 1),
          story("중간 글", "https://zdnet.co.kr/view/?no=2", 5),
        ],
      },
      [TOSS]: { items: [story("가장 옛 글", "https://toss.tech/article/3", 9)] },
    },
    env: { NEWS_MAX_ITEMS: "2" },
  });

  assert.match(result.output, /뉴스레터에 담을 2건/);
  assert.match(result.issue, /가장 새 글/);
  assert.match(result.issue, /중간 글/);
  assert.doesNotMatch(result.issue, /가장 옛 글/);
});

test("AI가 실패해도 링크 목록으로 뉴스레터를 낸다", () => {
  const result = run({
    feeds: { [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] } },
    ai: { fail: true },
  });

  assert.equal(result.status, 0, "AI는 거들 뿐이라 실패해도 발행은 성공이다");
  assert.match(result.output, /AI 요약 실패, 링크 목록만 저장합니다/);
  assert.match(result.issue, /aiGenerated: false/);
  assert.match(result.issue, /IT 뉴스 다이제스트/);
  assert.match(result.issue, /\[지디넷 기사\]\(https:\/\/zdnet\.co\.kr\/view\/\?no=1\)/);
});

test("일부 소스가 실패해도 나머지는 발행하고 종료 코드로 알린다", () => {
  const result = run({
    feeds: {
      [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] },
      [REGISTER]: { fail: true },
    },
    hackernews: { fail: true },
  });

  assert.equal(result.status, 1, "부분 실패는 조용히 지나가면 안 된다");
  assert.match(result.output, /Hacker News 수집 실패, 다른 소스는 계속 처리합니다/);
  assert.match(result.output, /The Register 피드를 찾지 못했습니다/);
  assert.equal(result.published.length, 1, "성공한 소스의 결과는 그대로 발행한다");
  assert.deepEqual(result.state.failed, ["Hacker News", "The Register"]);
});

test("모든 소스가 실패하면 아무것도 쓰지 않는다", () => {
  // 픽스처 하나가 표의 모든 호스트를 덮도록 빈 문자열 키를 쓴다.
  const result = run({ hackernews: { fail: true }, feeds: { "": { fail: true } } });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /모든 뉴스 소스 수집에 실패했습니다/);
  assert.deepEqual(result.published, []);
  assert.equal(result.state, null);
});

test("글을 하나도 못 받은 소스는 구조 변경을 의심하라고 경고한다", () => {
  const result = run({ feeds: { [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] } } });

  assert.equal(result.status, 0, "0건은 실패가 아니다");
  assert.match(result.output, /전자신문가 글을 하나도 돌려주지 않았습니다/);
  assert.match(result.output, /피드 구조 변경을 의심하세요/);
});

test("드라이런은 담을 소식을 보여 주고 저장하지 않는다", () => {
  const result = run({
    feeds: { [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] } },
    args: ["--dry-run"],
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /지디넷코리아: 1건/);
  assert.match(result.output, /- 지디넷 기사/);
  assert.match(result.output, /드라이런이므로 파일을 저장하지 않았습니다/);
  assert.deepEqual(result.published, []);
  assert.equal(result.state, null);
});

test("같은 날 두 번 돌면 뒤 이슈에 번호를 붙인다", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const result = run({
    issues: { [`${today}-news.md`]: '---\ntitle: "아침 이슈"\n---\n' },
    feeds: { [ZDNET]: { items: [story("지디넷 기사", "https://zdnet.co.kr/view/?no=1")] } },
  });

  assert.deepEqual(result.published, [`${today}-news-2.md`]);
});
