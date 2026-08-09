import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generate, model, parseDraft, yaml } from "./lib.mjs";

const USER = "tkddls8848";
const BLOG_REPO = process.env.GITHUB_REPOSITORY || `${USER}/devlog`;
const STATE_FILE = ".state/last-seen.json";
const POSTS_DIR = "src/posts";
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) throw new Error("GH_TOKEN이 필요합니다.");

const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
let newestEventId = state.lastEventId;

async function github(endpoint) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "devlog-bot",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  return response.json();
}

async function collectRanges() {
  const ranges = new Map();
  let done = false;

  for (let page = 1; page <= 3 && !done; page++) {
    const events = await github(`/users/${USER}/events/public?per_page=100&page=${page}`);
    for (const event of events) {
      if (!newestEventId || BigInt(event.id) > BigInt(newestEventId)) newestEventId = event.id;
      if (state.lastEventId && BigInt(event.id) <= BigInt(state.lastEventId)) {
        done = true;
        break;
      }
      if (
        event.type !== "PushEvent" ||
        event.repo?.name === BLOG_REPO ||
        !/^refs\/heads\/(main|master)$/.test(event.payload?.ref || "")
      ) {
        continue;
      }

      const { head, before } = event.payload;
      if (!head || !before || /^0+$/.test(before)) continue;
      if (!ranges.has(event.repo.name)) ranges.set(event.repo.name, { head, before });
      else ranges.get(event.repo.name).before = before;
    }
    if (events.length < 100) break;
  }
  return ranges;
}

const ignored = [
  /^merge\s/i,
  /^revert\s/i,
  /^(chore|ci)(\(deps\))?:/i,
  /^bump\s/i,
  /^(wip|test|tmp|temp|initial commit)$/i,
  /\[skip ci\]/i,
];

async function collectCommits(ranges) {
  const commits = [];
  for (const [repo, { before, head }] of ranges) {
    const comparison = await github(`/repos/${repo}/compare/${before}...${head}`);
    for (const item of comparison.commits) {
      const message = String(item.commit.message).split("\n")[0].trim();
      const author = item.commit.author?.name || item.author?.login || "";
      if (
        item.parents.length > 1 ||
        !message ||
        ignored.some((pattern) => pattern.test(message)) ||
        /\[bot\]$|^dependabot|^github-actions/i.test(author)
      ) {
        continue;
      }
      const at = item.commit.author?.date || item.commit.committer.date;
      commits.push({ repo, sha: item.sha, message, day: DAY.format(new Date(at)) });
    }
  }
  return commits;
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
    .map(([repo, commits]) => `## ${repo}\n${commits.map((c) => `- ${c.message}`).join("\n")}`)
    .join("\n\n");
  return `다음 ${day} 커밋을 저장소별 작업 단위로 묶어 담담한 개발 일지를 쓰세요. 추측, 홍보 표현, 커밋 나열은 제외하고 250~600자로 작성하세요.\n\n${source}\n\n정확히 다음 형식으로 답하세요.\nTITLE: 제목\nSUMMARY: 한 줄 요약\n\nMarkdown 본문`;
}

function availableFile(day) {
  let file = path.join(POSTS_DIR, `${day}-devlog.md`);
  for (let n = 2; existsSync(file); n++) file = path.join(POSTS_DIR, `${day}-devlog-${n}.md`);
  return file;
}

function savePost(day, draft, repos) {
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

const ranges = await collectRanges();
const commits = await collectCommits(ranges);

if (commits.length) {
  console.log(`개발 일지 생성 중 (커밋 ${commits.length}건, ${model})`);
  for (const [day, repos] of groupByDay(commits)) {
    const file = savePost(day, parseDraft(await generate(prompt(day, repos))), repos);
    console.log(`  ${file}`);
  }
} else {
  console.log("새 커밋이 없습니다.");
}

writeFileSync(STATE_FILE, `${JSON.stringify({ lastEventId: newestEventId }, null, 2)}\n`, "utf8");
