import assert from "node:assert/strict";
import test from "node:test";
import {
  configFromEnv,
  countEntries,
  parseDraft,
  runDigest,
  selectCandidates,
} from "../worker/digest.mjs";

const NOW = new Date("2026-08-24T22:00:00.000Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3600 * 1000).toISOString();

function source(name, items, { kind = "기술 블로그", fail = false } = {}) {
  return {
    source: name,
    kind,
    collect: async () => {
      if (fail) throw new Error(`${name} 다운`);
      return items.map((item) => ({ source: name, kind, ...item }));
    },
  };
}

const story = (title, url, hours = 2) => ({ title, url, at: hoursAgo(hours) });

function memoryStore(published = []) {
  return {
    legacyEnsured: false,
    issue: null,
    run: null,
    async ensureLegacyIssues() {
      this.legacyEnsured = true;
    },
    async publishedLinks(values) {
      const known = new Set(published);
      return new Set(values.filter((value) => known.has(value)));
    },
    async nextSlug(day) {
      return `${day}-news`;
    },
    async saveIssue(issue, run) {
      this.issue = issue;
      this.run = run;
    },
    async saveRun(run) {
      this.run = run;
    },
  };
}

const ai = (response = "TITLE: 오늘의 뉴스\nSUMMARY: 중요한 소식입니다.\n\n## 동향\n\n본문입니다.") => ({
  run: async () => ({ response }),
});

test("여러 소스의 새 소식을 Workers AI로 묶어 D1 저장소에 넘긴다", async () => {
  const store = memoryStore();
  const result = await runDigest({
    env: { AI: ai() },
    store,
    now: NOW,
    sources: [
      source("첫 소스", [story("첫 기사", "https://example.com/a")]),
      source("둘째 소스", [story("둘째 기사", "https://example.net/b")]),
    ],
  });

  assert.equal(result.status, "success");
  assert.equal(store.legacyEnsured, true);
  assert.equal(store.issue.slug, "2026-08-25-news");
  assert.equal(store.issue.title, "오늘의 뉴스");
  assert.equal(store.issue.aiGenerated, true);
  assert.equal(countEntries(store.issue.sources), 2);
  assert.equal(store.run.status, "success");
});

test("D1에 이미 저장한 정규화 주소와 한 수집 안의 중복을 제외한다", async () => {
  const store = memoryStore(["example.com/already"]);
  await runDigest({
    env: { AI: ai() },
    store,
    now: NOW,
    sources: [
      source("소스", [
        story("이미 발행", "https://www.example.com/already/?utm_source=rss"),
        story("새 기사", "https://example.com/new?utm_medium=feed"),
        story("새 기사 중복", "http://www.example.com/new"),
      ]),
    ],
  });

  assert.deepEqual(store.issue.sources[0].entries.map((entry) => entry.title), ["새 기사"]);
});

test("AI가 실패하면 링크 본문을 저장하고 발행은 성공한다", async () => {
  const store = memoryStore();
  const failingAi = { run: async () => { throw new Error("모델 오류"); } };
  await runDigest({
    env: { AI: failingAi },
    store,
    now: NOW,
    sources: [source("소스", [story("기사", "https://example.com/a")])],
    logger: { log() {}, warn() {} },
  });

  assert.equal(store.issue.aiGenerated, false);
  assert.match(store.issue.bodyMarkdown, /\[기사\]\(https:\/\/example\.com\/a\)/);
});

test("일부 소스 실패는 partial 실행 이력과 함께 성공한 기사로 발행한다", async () => {
  const store = memoryStore();
  const result = await runDigest({
    env: { AI: ai() },
    store,
    now: NOW,
    sources: [
      source("성공", [story("기사", "https://example.com/a")]),
      source("실패", [], { fail: true }),
    ],
    logger: { log() {}, warn() {} },
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(store.run.failedSources, ["실패"]);
  assert.equal(store.issue.sources.length, 1);
});

test("모든 소스 실패는 failed 이력을 남기고 던진다", async () => {
  const store = memoryStore();
  await assert.rejects(
    () =>
      runDigest({
        env: { AI: ai() },
        store,
        now: NOW,
        sources: [source("실패", [], { fail: true })],
        logger: { log() {}, warn() {} },
      }),
    /모든 뉴스 소스 수집에 실패/
  );
  assert.equal(store.run.status, "failed");
});

test("새 소식이 없으면 이슈 없이 empty 이력만 저장한다", async () => {
  const store = memoryStore();
  const result = await runDigest({
    env: { AI: ai() },
    store,
    now: NOW,
    sources: [source("조용한 소스", [])],
    logger: { log() {}, warn() {} },
  });
  assert.equal(result.status, "empty");
  assert.equal(store.issue, null);
  assert.equal(store.run.status, "empty");
});

test("시간 창 밖 기사와 깨진 날짜를 제외한다", () => {
  const selected = selectCandidates(
    [
      story("새 기사", "https://example.com/new", 1),
      story("옛 기사", "https://example.com/old", 30),
      { title: "깨짐", url: "https://example.com/bad", at: "언젠가" },
    ],
    new Date(NOW.getTime() - 24 * 3600 * 1000)
  );
  assert.deepEqual(selected.map((item) => item.title), ["새 기사"]);
});

test("잘못된 숫자 설정은 안전한 기본값으로 돌아간다", () => {
  assert.deepEqual(configFromEnv({ NEWS_WINDOW_HOURS: "0", NEWS_MAX_ITEMS: "NaN" }), {
    model: "@cf/meta/llama-3.1-8b-instruct-fast",
    windowHours: 24,
    perSource: 3,
    maxItems: 30,
    hnMinPoints: 100,
  });
});

test("AI 응답의 think와 코드 펜스를 걷어낸다", () => {
  const draft = parseDraft(
    "<think>숨은 추론</think>\n```markdown\nTITLE: 제목\nSUMMARY: 요약\n\n## 본문\n내용\n```"
  );
  assert.deepEqual(draft, { title: "제목", summary: "요약", body: "## 본문\n내용" });
});
