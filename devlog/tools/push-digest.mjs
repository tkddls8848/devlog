import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generate, model, parseDraft, yaml } from "./lib.mjs";

const USER = "tkddls8848";
const BLOG_REPO = process.env.GITHUB_REPOSITORY || `${USER}/devlog`;
const STATE_FILE = ".state/last-seen.json";
const POSTS_DIR = "src/posts";
const EVENT_PAGES = 3;
const DRY_RUN = process.argv.includes("--dry-run");
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

async function github(endpoint) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "devlog-bot",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`GitHub API ${response.status}: ${endpoint} (JSON 응답 없음)`);
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${endpoint} — ${data.message || raw.slice(0, 200)}`);
  }
  return data;
}

async function collectEvents() {
  const events = [];
  for (let page = 1; page <= EVENT_PAGES; page++) {
    const batch = await github(`/users/${USER}/events/public?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`GitHub 이벤트 ${page}페이지 형식이 올바르지 않습니다.`);
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

function collectRanges(events) {
  const ranges = [];
  const known = new Set();
  for (const event of events) {
    if (
      event.type !== "PushEvent" ||
      event.repo?.name === BLOG_REPO ||
      !/^refs\/heads\/(main|master|dev)$/.test(event.payload?.ref || "")
    ) {
      continue;
    }
    const { before, head } = event.payload;
    if (!head || !before || /^0+$/.test(before)) continue;
    const key = `${event.repo.name}:${before}:${head}`;
    if (known.has(key)) continue;
    known.add(key);
    const eventCommits = Array.isArray(event.payload.commits) ? event.payload.commits : [];
    ranges.push({
      repo: event.repo.name,
      before,
      head,
      createdAt: event.created_at,
      eventCommits,
      distinctSize: Number(event.payload.distinct_size ?? event.payload.size ?? eventCommits.length),
    });
  }
  return ranges;
}

function publishedShas() {
  if (!existsSync(POSTS_DIR)) return new Set();
  const shas = new Set();
  for (const name of readdirSync(POSTS_DIR)) {
    if (!name.endsWith(".md")) continue;
    const source = readFileSync(path.join(POSTS_DIR, name), "utf8");
    for (const match of source.matchAll(/^\s*-?\s*sha:\s*["']?([0-9a-f]{40})["']?\s*$/gim)) {
      shas.add(match[1]);
    }
  }
  return shas;
}

const ignored = [
  /^merge\s/i,
  /^revert\s/i,
  /^(chore|ci)(\(deps\))?:/i,
  /^bump\s/i,
  /^(wip|test|tmp|temp|initial commit)$/i,
  /\[skip ci\]/i,
];

function normalizeCommit(item, range) {
  const sha = item.sha || item.id;
  const message = String(item.commit?.message || item.message || "").split("\n")[0].trim();
  const author =
    item.commit?.author?.name || item.author?.name || item.author?.login || item.author?.username || "";
  const at = item.commit?.author?.date || item.commit?.committer?.date || range.createdAt;
  if (
    !sha ||
    item.parents?.length > 1 ||
    !message ||
    ignored.some((pattern) => pattern.test(message)) ||
    /\[bot\]$|^dependabot|^github-actions/i.test(author)
  ) {
    return null;
  }
  return { repo: range.repo, sha, message, day: DAY.format(new Date(at)) };
}

async function collectCommits(ranges, published) {
  const commits = new Map();
  const failed = [];

  for (const range of ranges) {
    const eventShas = range.eventCommits.map((item) => item.sha || item.id).filter(Boolean);
    const payloadComplete = eventShas.length > 0 && eventShas.length >= range.distinctSize;
    if (payloadComplete) {
      const pending = range.eventCommits
        .map((item) => normalizeCommit(item, range))
        .filter(Boolean)
        .filter((commit) => !published.has(commit.sha) && !commits.has(commit.sha));
      if (!pending.length) continue;
    }

    let items;
    try {
      const comparison = await github(
        `/repos/${range.repo}/compare/${range.before}...${range.head}`
      );
      items = Array.isArray(comparison.commits) ? comparison.commits : [];
    } catch (error) {
      failed.push(`${range.repo}: ${error.message}`);
      items = range.eventCommits;
      console.warn(`  ⚠️ ${range.repo} 비교 실패, 이벤트 내 커밋으로 복구합니다: ${error.message}`);
    }

    for (const item of items) {
      const commit = normalizeCommit(item, range);
      if (!commit || published.has(commit.sha) || commits.has(commit.sha)) continue;
      commits.set(commit.sha, commit);
    }
  }

  return { commits: [...commits.values()], failed };
}

function groupByDay(commits) {
  const days = new Map();
  for (const commit of commits) {
    if (!days.has(commit.day)) days.set(commit.day, new Map());
    const repos = days.get(commit.day);
    if (!repos.has(commit.repo)) repos.set(commit.repo, []);
    repos.get(commit.repo).push(commit);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b));
}

function prompt(day, repos) {
  const source = [...repos]
    .map(([repo, commits]) => `## ${repo}\n${commits.map((commit) => `- ${commit.message}`).join("\n")}`)
    .join("\n\n");
  return `다음 ${day} 커밋을 저장소별 작업 단위로 묶어 담담한 개발 일지를 쓰세요. 추측, 홍보 표현, 커밋 나열은 제외하고 250~600자로 작성하세요.\n\n${source}\n\n정확히 다음 형식으로 답하세요.\nTITLE: 제목\nSUMMARY: 한 줄 요약\n\nMarkdown 본문`;
}

function fallbackDraft(day, repos) {
  const total = [...repos.values()].reduce((sum, commits) => sum + commits.length, 0);
  const body = [...repos]
    .map(
      ([repo, commits]) =>
        `## ${repo}\n\n${commits.map((commit) => `- ${commit.message}`).join("\n")}`
    )
    .join("\n\n");
  return {
    title: `${day} 개발 일지`,
    summary: `${repos.size}개 저장소의 커밋 ${total}건을 기록했습니다.`,
    body,
  };
}

function availableFile(day) {
  let file = path.join(POSTS_DIR, `${day}-devlog.md`);
  for (let n = 2; existsSync(file); n++) file = path.join(POSTS_DIR, `${day}-devlog-${n}.md`);
  return file;
}

function savePost(day, draft, repos, aiGenerated) {
  const commits = [];
  for (const [repo, items] of repos) {
    commits.push(`  - repo: ${yaml(repo)}`, "    items:");
    for (const item of items) {
      commits.push(`      - sha: ${yaml(item.sha)}`, `        message: ${yaml(item.message)}`);
    }
  }
  mkdirSync(POSTS_DIR, { recursive: true });
  const file = availableFile(day);
  writeFileSync(
    file,
    [
      "---",
      `title: ${yaml(draft.title)}`,
      `date: ${day}`,
      `summary: ${yaml(draft.summary)}`,
      `aiGenerated: ${aiGenerated}`,
      "commits:",
      ...commits,
      "---",
      "",
      draft.body,
      "",
    ].join("\n"),
    "utf8"
  );
  return file;
}

function saveState(events) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        newestEventId: events[0]?.id || null,
        newestEventAt: events[0]?.created_at || null,
        checkedAt: new Date().toISOString(),
        pagesScanned: Math.ceil(events.length / 100),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

if (!token) console.warn("  ⚠️ GitHub 토큰 없이 공개 API를 조회합니다. 요청 한도가 낮습니다.");
const events = await collectEvents();
const ranges = collectRanges(events);
const published = publishedShas();
const { commits, failed } = await collectCommits(ranges, published);
const days = groupByDay(commits);

console.log(
  `GitHub 이벤트 ${events.length}건, 대상 푸시 ${ranges.length}건, 기존 커밋 ${published.size}건, 새 커밋 ${commits.length}건`
);

if (DRY_RUN) {
  for (const [day, repos] of days) {
    const total = [...repos.values()].reduce((sum, items) => sum + items.length, 0);
    console.log(`  ${day}: 저장소 ${repos.size}개, 커밋 ${total}건`);
  }
  if (failed.length) console.log(`  비교 실패 ${failed.length}건은 이벤트 payload로 대체했습니다.`);
  console.log("드라이런이므로 파일을 저장하지 않았습니다.");
  process.exit(0);
}

if (!days.length) {
  console.log("새 커밋이 없습니다.");
  process.exit(0);
}

console.log(`개발 일지 ${days.length}편 생성 중 (${model})`);
for (const [day, repos] of days) {
  const fallback = fallbackDraft(day, repos);
  let draft = fallback;
  let aiGenerated = false;
  try {
    draft = parseDraft(await generate(prompt(day, repos)), fallback);
    aiGenerated = true;
  } catch (error) {
    console.warn(`  ⚠️ ${day} AI 요약 실패, 기본 본문을 저장합니다: ${error.message}`);
  }
  console.log(`  ${savePost(day, draft, repos, aiGenerated)}`);
}
saveState(events);
