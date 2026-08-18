import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generate, model, parseDraft, yaml } from "./lib.mjs";
import { feeds } from "./feeds.mjs";
import { feedSource, normalizeUrl } from "./rss.mjs";
import * as hackernews from "./sources/hackernews.mjs";

const ISSUES_DIR = "src/issues";
const STATE_FILE = ".state/last-seen.json";
const DRY_RUN = process.argv.includes("--dry-run");
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

// 미국 시간대 소스가 많아 KST 오늘치만 담으면 아침 발행에 남는 소식이 없다.
// 발행 시각 기준 최근 24시간을 하루로 본다.
const WINDOW_HOURS = Number(process.env.NEWS_WINDOW_HOURS || 24);
const PER_SOURCE = Number(process.env.NEWS_PER_SOURCE || 6);
const MAX_ITEMS = Number(process.env.NEWS_MAX_ITEMS || 24);

// Hacker News만 피드 대신 검색 API를 쓴다. 나머지는 표에 적힌 후보 주소를
// 두드리는 같은 수집기이며, 소스를 늘릴 때 손댈 곳은 feeds.mjs 하나다.
const sources = [
  hackernews,
  ...feeds.map((feed) => ({
    source: feed.source,
    kind: feed.kind,
    collect: feedSource({ ...feed, limit: PER_SOURCE }),
  })),
];

async function collectAll(since) {
  const settled = await Promise.allSettled(sources.map((source) => source.collect(since)));
  const items = [];
  const failed = [];
  settled.forEach((result, index) => {
    const name = sources[index].source;
    if (result.status === "fulfilled") {
      console.log(`  ${name}: ${result.value.length}건 수집`);
      // 여섯 소스 모두 항상 최근 글을 돌려준다. 0건은 실패는 아니지만
      // 피드 구조가 바뀌었다는 신호에 가깝다.
      if (!result.value.length) {
        console.warn(`  ⚠️ ${name}가 글을 하나도 돌려주지 않았습니다. 피드 구조 변경을 의심하세요.`);
      }
      items.push(...result.value);
    } else {
      const message = result.reason?.message || String(result.reason);
      console.warn(`  ⚠️ ${name} 수집 실패, 다른 소스는 계속 처리합니다: ${message}`);
      failed.push({ source: name, message });
    }
  });
  return { items, failed };
}

// 이미 실은 링크는 다시 싣지 않는다. 발행된 이슈의 앞머리가 곧 기록이다.
function publishedLinks() {
  if (!existsSync(ISSUES_DIR)) return new Set();
  const links = new Set();
  for (const name of readdirSync(ISSUES_DIR)) {
    if (!name.endsWith(".md")) continue;
    const source = readFileSync(path.join(ISSUES_DIR, name), "utf8");
    for (const match of source.matchAll(/^\s*(?:-\s*)?url:\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) {
      links.add(normalizeUrl(match[1].replace(/\\(.)/g, "$1")));
    }
  }
  return links;
}

function selectFresh(items, since, published) {
  const seen = new Set();
  const fresh = [];
  for (const item of items) {
    const at = new Date(item.at);
    if (Number.isNaN(at.getTime()) || at < since) continue;
    const key = normalizeUrl(item.url);
    if (published.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...item, at: at.toISOString() });
  }
  return fresh.sort((a, b) => b.at.localeCompare(a.at));
}

// 출처 하나가 뉴스레터를 다 채우지 않게 소스별로 먼저 자르고, 그다음 전체를 자른다.
function groupBySource(fresh) {
  const groups = new Map();
  for (const item of fresh) {
    if (!groups.has(item.source)) groups.set(item.source, []);
    const entries = groups.get(item.source);
    if (entries.length < PER_SOURCE) entries.push(item);
  }

  const kept = new Set(
    [...groups.values()]
      .flat()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_ITEMS)
      .map((item) => item.url)
  );

  const ordered = [];
  for (const source of sources) {
    const entries = (groups.get(source.source) || []).filter((item) => kept.has(item.url));
    if (entries.length) ordered.push({ source: source.source, kind: source.kind, entries });
  }
  return ordered;
}

const countOf = (grouped) => grouped.reduce((sum, group) => sum + group.entries.length, 0);

function prompt(day, grouped) {
  const source = grouped
    .map(
      (group) =>
        `## ${group.source} (${group.kind})\n${group.entries
          .map((entry) => `- ${entry.title}`)
          .join("\n")}`
    )
    .join("\n\n");
  return (
    `다음은 ${day}에 모은 IT 업계 뉴스와 블로그 headline입니다. 비슷한 주제끼리 3~5개 갈래로 묶어 ` +
    `한국어 뉴스레터 본문을 쓰세요. headline에 없는 사실, 추측, 홍보 표현, 단순 나열은 넣지 말고 ` +
    `400~800자로 작성하세요. 각 갈래는 "## 소제목"으로 시작합니다.\n\n${source}\n\n` +
    `정확히 다음 형식으로 답하세요.\nTITLE: 제목\nSUMMARY: 한 줄 요약\n\nMarkdown 본문`
  );
}

function fallbackDraft(day, grouped) {
  const body = grouped
    .map(
      (group) =>
        `## ${group.source}\n\n${group.entries
          .map((entry) => `- [${entry.title}](${entry.url})`)
          .join("\n")}`
    )
    .join("\n\n");
  return {
    title: `${day} IT 뉴스 다이제스트`,
    summary: `출처 ${grouped.length}곳에서 소식 ${countOf(grouped)}건을 모았습니다.`,
    body,
  };
}

function availableFile(day) {
  let file = path.join(ISSUES_DIR, `${day}-news.md`);
  for (let n = 2; existsSync(file); n++) file = path.join(ISSUES_DIR, `${day}-news-${n}.md`);
  return file;
}

function saveIssue(day, draft, grouped, aiGenerated) {
  const front = ["sources:"];
  for (const group of grouped) {
    front.push(`  - source: ${yaml(group.source)}`, `    kind: ${yaml(group.kind)}`, "    entries:");
    for (const entry of group.entries) {
      front.push(
        `      - title: ${yaml(entry.title)}`,
        `        url: ${yaml(entry.url)}`,
        `        at: ${yaml(entry.at)}`
      );
      if (entry.note) front.push(`        note: ${yaml(entry.note)}`);
    }
  }

  mkdirSync(ISSUES_DIR, { recursive: true });
  const file = availableFile(day);
  const document = [
    "---",
    `title: ${yaml(draft.title)}`,
    `date: ${day}`,
    `summary: ${yaml(draft.summary)}`,
    `aiGenerated: ${aiGenerated}`,
    ...front,
    "---",
    "",
    draft.body,
    "",
  ].join("\n");
  // 쓰다 중단되면 앞머리가 잘린 글이 남아 다음 빌드가 통째로 실패한다.
  // 임시 파일에 다 쓴 뒤 한 번에 바꾼다.
  writeFileSync(`${file}.tmp`, document, "utf8");
  renameSync(`${file}.tmp`, file);
  return file;
}

function saveState(since, grouped, failed) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        windowHours: WINDOW_HOURS,
        since: since.toISOString(),
        picked: Object.fromEntries(grouped.map((group) => [group.source, group.entries.length])),
        failed: failed.map((item) => item.source),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000);
const day = DAY.format(new Date());
console.log(`IT 뉴스 수집 중 (최근 ${WINDOW_HOURS}시간, ${since.toISOString()} 이후)`);

const { items, failed } = await collectAll(since);
if (failed.length === sources.length) {
  throw new Error("모든 뉴스 소스 수집에 실패했습니다.");
}

const fresh = selectFresh(items, since, publishedLinks());
const grouped = groupBySource(fresh);

console.log(`수집 ${items.length}건, 창 안의 새 소식 ${fresh.length}건, 뉴스레터에 담을 ${countOf(grouped)}건`);

if (!grouped.length) {
  console.log("새 소식이 없습니다.");
} else if (DRY_RUN) {
  for (const group of grouped) {
    console.log(`  ${group.source}: ${group.entries.length}건`);
    for (const entry of group.entries) console.log(`    - ${entry.title}`);
  }
  console.log("드라이런이므로 파일을 저장하지 않았습니다.");
} else {
  console.log(`${day} 뉴스레터 생성 중 (${model})`);
  const fallback = fallbackDraft(day, grouped);
  let draft = fallback;
  let aiGenerated = false;
  try {
    draft = parseDraft(await generate(prompt(day, grouped)), fallback);
    aiGenerated = true;
  } catch (error) {
    console.warn(`  ⚠️ AI 요약 실패, 링크 목록만 저장합니다: ${error.message}`);
  }
  console.log(`  ${saveIssue(day, draft, grouped, aiGenerated)}`);
  saveState(since, grouped, failed);
}

if (failed.length) process.exitCode = 1;
