/**
 * 내 GitHub 공개 푸시를 모아 개발 일지 초안을 만듭니다.
 *
 *   node tools/push-digest.mjs
 *
 * 흐름
 *   1. .state/last-seen.json 에 적힌 지점 이후의 PushEvent 를 모읍니다.
 *   2. 저장소별로 before...head 구간을 compare 해서 커밋과 변경 파일을 받습니다.
 *   3. 그 재료를 Cloudflare Workers AI(IBM Granite)에 넘겨 한국어 초안을 받습니다.
 *   4. src/posts/ 에 draft: true 인 Markdown 으로 저장하고 watermark 를 갱신합니다.
 *
 * 저장된 글은 draft: true 라서 사이트에 나오지 않습니다. 사람이 읽고 고친 뒤
 * draft 줄을 지워야 발행됩니다(src/posts/posts.11tydata.js 참고).
 *
 * ⚠️ 왜 이벤트의 commits 배열을 안 쓰는가:
 *    문서에는 PushEvent payload 에 commits 가 있다고 되어 있지만, 공개 이벤트
 *    피드(/users/{user}/events/public)는 실제로 head 와 before 해시만 주고
 *    commits 는 비워서 보냅니다. 그것만 믿으면 푸시를 아무리 많이 해도 글감이
 *    0건이 됩니다. 그래서 두 해시로 compare 를 겁니다.
 *    덤으로 이벤트 payload 의 20개 제한이 없고, 변경 파일 집계도 같이 옵니다.
 *
 * watermark 를 왜 PR 안에서 같이 옮기는가:
 *    초안 PR 을 병합하지 않고 닫으면 그 기간의 커밋은 영영 글이 되지 않습니다.
 *    그래서 .state/last-seen.json 을 main 에 바로 커밋하지 않고 초안과 같은
 *    브랜치에 넣습니다. 병합해야 지점이 넘어가므로, PR 을 열어 둔 동안에는
 *    다음 실행이 같은 구간을 다시 요약해 PR 을 갱신합니다.
 *
 * 필요한 환경 변수
 *   GH_TOKEN        GitHub API 조회용 (Actions 의 GITHUB_TOKEN)
 *   CF_ACCOUNT_ID   Cloudflare 계정 ID
 *   CF_API_TOKEN    Workers AI 권한을 가진 API 토큰
 *   CF_AI_MODEL     (선택) 기본값은 아래 DEFAULT_MODEL
 *   GITHUB_USER     (선택) 기본값 tkddls8848
 *   BLOG_REPO       (선택) 제외할 저장소. Actions 에서는 GITHUB_REPOSITORY 로 자동
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const POSTS_DIR = path.resolve("src/posts");
const STATE_FILE = path.resolve(".state/last-seen.json");

/** Cloudflare Workers AI 가 호스팅하는 IBM Granite. */
const DEFAULT_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;

/** 이벤트를 몇 페이지까지 볼지. GitHub 는 사용자 이벤트를 300건까지만 줍니다. */
const EVENT_PAGES = 3;

/**
 * 한 글에 담을 저장소 수 상한.
 *
 * 평소에는 한두 곳이지만, 처음 돌리거나 한동안 병합을 안 하면 90일치가 한꺼번에
 * 잡힙니다. 그대로 넣으면 프롬프트가 모델 컨텍스트를 넘겨 응답이 잘립니다.
 * 최근 활동 순으로 자르고, 남은 것은 다음 실행에서 다시 잡힙니다.
 */
const MAX_REPOS = 5;

/** 한 저장소에서 글에 쓸 커밋 수 상한. 넘으면 최신 것부터 자릅니다. */
const MAX_COMMITS_PER_REPO = 25;

/** 프롬프트에 넣을 변경 파일 수 상한 (저장소당). */
const MAX_FILES_PER_REPO = 12;

/**
 * watermark 에 남겨 둘 최근 sha 개수.
 *
 * 이벤트 id 만으로 놓치는 경우의 안전망이자, 저장소 상한에 걸려 여러 번에 나눠
 * 실을 때 "이미 실은 커밋" 을 가려내는 근거입니다. 90일치를 처음 훑으면 수백
 * 건이 나오므로 넉넉하게 잡습니다.
 */
const SEEN_SHA_KEEP = 1000;

const GITHUB_USER = process.env.GITHUB_USER || "tkddls8848";

const ZERO_SHA = "0".repeat(40);

/**
 * 글감에서 뺄 커밋.
 *
 * 자동 생성 커밋과 병합 커밋은 "무엇을 만들었는가" 와 무관한데, 그대로 넣으면
 * 모델이 이것들까지 성과로 서술합니다.
 */
const SKIP_MESSAGE = [
  /^merge\s+(branch|pull request|remote)/i,
  /^revert\s+"/i,
  /^(chore|ci)\(?deps\)?:/i,
  /^bump\s+\S+\s+from\s/i,
  /^initial commit$/i,
  /^(wip|test|tmp|temp|asdf|\.)$/i,
  /\[skip ci\]/i,
];

const SKIP_AUTHOR = /\[bot\]$|^dependabot|^github-actions/i;

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name} 가 필요합니다.`);
  return value;
};

/* ── GitHub API ──────────────────────────────────────────────────────────── */
async function gh(pathname, { optional = false } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${GITHUB_USER}-devlog-bot/1.0`,
  };
  // 토큰 없이도 공개 이벤트는 읽히지만 시간당 60회로 묶입니다.
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${pathname}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    // 강제 푸시로 사라진 커밋 등은 404 가 납니다. 그것 때문에 전체를 멈출
    // 이유는 없어서 선택 조회는 조용히 건너뜁니다.
    if (optional) return null;
    const remaining = res.headers.get("x-ratelimit-remaining");
    const hint = remaining === "0" ? " (API 한도 소진)" : "";
    throw new Error(`GitHub API ${res.status}${hint}: ${pathname}`);
  }
  return res.json();
}

/* ── 1. 상태 읽기 ────────────────────────────────────────────────────────── */
function loadState() {
  if (!existsSync(STATE_FILE)) return { lastEventId: null, seenShas: [] };
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return {
      lastEventId: parsed.lastEventId ?? null,
      seenShas: Array.isArray(parsed.seenShas) ? parsed.seenShas : [],
    };
  } catch (error) {
    // 상태 파일이 깨졌다고 멈추면 자동화가 죽습니다. 처음부터 다시 보는 쪽이
    // 낫습니다 — 중복은 사람이 PR 에서 걸러낼 수 있지만 멈춘 건 아무도 모릅니다.
    console.warn(`  ⚠️ 상태 파일을 읽지 못해 처음부터 봅니다: ${error.message}`);
    return { lastEventId: null, seenShas: [] };
  }
}

/* ── 2. 푸시 구간 수집 ───────────────────────────────────────────────────── */
const newerThan = (a, b) => {
  // 이벤트 id 는 증가하는 정수 문자열입니다. Number 로는 정밀도를 잃습니다.
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return true;
  }
};

const firstLine = (s) => String(s || "").split("\n")[0].trim();

/**
 * 처리하지 않은 PushEvent 를 저장소별 하나의 구간으로 접습니다.
 *
 * 푸시마다 compare 를 걸면 저장소 하나에 수십 번 호출하게 됩니다. 연속된
 * 푸시의 before/head 는 사슬처럼 이어지므로, 가장 오래된 before 와 가장 최신
 * head 를 잡으면 한 번의 compare 로 구간 전체가 나옵니다.
 */
async function collectRanges(state) {
  const blogRepo = (process.env.BLOG_REPO || process.env.GITHUB_REPOSITORY || "").toLowerCase();
  const ranges = new Map();
  let newestEventId = state.lastEventId;
  let pushEvents = 0;

  for (let page = 1; page <= EVENT_PAGES; page++) {
    const events = await gh(`/users/${GITHUB_USER}/events/public?per_page=100&page=${page}`);
    if (!Array.isArray(events) || events.length === 0) break;

    let reachedWatermark = false;

    for (const event of events) {
      if (!newestEventId || newerThan(event.id, newestEventId)) {
        newestEventId = event.id;
      }
      // 이벤트는 최신순이라, watermark 이하를 만나면 그 뒤는 전부 처리된 것입니다.
      if (state.lastEventId && !newerThan(event.id, state.lastEventId)) {
        reachedWatermark = true;
        break;
      }
      if (event.type !== "PushEvent") continue;

      const repo = event.repo?.name || "";
      // 블로그 저장소 자신은 뺍니다. 자동 생성된 초안 커밋이 다음 글의 소재가
      // 되어 스스로를 계속 요약하는 되먹임을 막습니다.
      if (!repo || repo.toLowerCase() === blogRepo) continue;

      // 기본 브랜치가 아닌 브랜치의 작업은 아직 정리되지 않은 경우가 많습니다.
      if (!/^refs\/heads\/(main|master)$/.test(event.payload?.ref || "")) continue;

      const { head, before } = event.payload || {};
      if (!head) continue;

      pushEvents++;

      // 이벤트는 최신순 → 처음 본 것이 가장 새로운 head.
      if (!ranges.has(repo)) {
        ranges.set(repo, { head, before: null, pushes: 0, at: event.created_at });
      }
      const range = ranges.get(repo);
      range.pushes++;
      // 계속 덮어써서 마지막(=가장 오래된 푸시)의 before 가 남게 합니다.
      // 브랜치를 새로 만든 푸시는 before 가 0 이라 compare 가 되지 않으므로
      // 그때는 직전에 잡아 둔 값을 유지합니다.
      if (before && before !== ZERO_SHA) range.before = before;
    }

    if (reachedWatermark) break;
    if (events.length < 100) break;
  }

  console.log(`  PushEvent ${pushEvents}건, 저장소 ${ranges.size}곳`);
  return { ranges, newestEventId };
}

/* ── 3. 구간을 커밋·변경 파일로 펼치기 ───────────────────────────────────── */
function isNoise(message, authorName) {
  if (!message) return true;
  if (SKIP_MESSAGE.some((re) => re.test(message))) return true;
  if (SKIP_AUTHOR.test(authorName || "")) return true;
  return false;
}

async function expandRanges(ranges, seen) {
  const work = new Map();

  /*
   * 상한을 "비교하기 전" 이 아니라 "글감이 실제로 나온 뒤" 에 겁니다.
   *
   * 앞에서 잘라 버리면 이미 다 실린 저장소가 계속 앞자리를 차지해서 뒤쪽
   * 저장소는 영영 차례가 오지 않습니다. 실린 커밋은 seenShas 에 쌓이므로,
   * 여기서 세는 것은 "새 커밋이 나온 저장소" 뿐이고 다음 실행에서는 자연히
   * 그다음 저장소가 앞으로 옵니다.
   */
  let truncated = false;

  for (const [repo, range] of ranges) {
    if (work.size >= MAX_REPOS) {
      truncated = true;
      console.log(`  이번 글은 저장소 ${MAX_REPOS}곳까지만 담습니다. 나머지는 다음 실행에서 이어집니다.`);
      break;
    }
    if (!range.before) {
      console.warn(`  ${repo}: 비교 기준(before)을 잡지 못해 건너뜁니다.`);
      continue;
    }

    const cmp = await gh(`/repos/${repo}/compare/${range.before}...${range.head}`, {
      optional: true,
    });
    if (!cmp) {
      // 강제 푸시로 before 가 사라지면 404 입니다. 다음 실행에서 새 구간으로
      // 다시 잡히므로 여기서는 넘어갑니다.
      console.warn(`  ${repo}: ${range.before.slice(0, 7)}...${range.head.slice(0, 7)} 비교 실패`);
      continue;
    }

    const commits = [];
    for (const c of cmp.commits || []) {
      if (!c.sha || seen.has(c.sha)) continue;
      const message = firstLine(c.commit?.message);
      if (isNoise(message, c.commit?.author?.name || c.author?.login)) continue;
      // 병합 커밋은 부모가 둘입니다. 메시지 규칙으로 다 걸러지지 않아 여기서도 봅니다.
      if ((c.parents || []).length > 1) continue;

      seen.add(c.sha);
      commits.push({ sha: c.sha, message });
    }

    if (commits.length === 0) {
      console.log(`  ${repo}: 새 커밋 없음 (${cmp.commits?.length || 0}건 전부 제외)`);
      continue;
    }

    // 최신 커밋이 글의 주제가 되도록 뒤에서부터 자릅니다.
    const kept = commits.slice(-MAX_COMMITS_PER_REPO).reverse();

    const files = (cmp.files || [])
      .slice()
      .sort((a, b) => (b.changes || 0) - (a.changes || 0))
      .slice(0, MAX_FILES_PER_REPO)
      .map((f) => ({
        filename: f.filename,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
      }));

    work.set(repo, {
      commits: kept,
      files,
      fileCount: (cmp.files || []).length,
      additions: (cmp.files || []).reduce((n, f) => n + (f.additions || 0), 0),
      deletions: (cmp.files || []).reduce((n, f) => n + (f.deletions || 0), 0),
    });

    console.log(`  ${repo}: 커밋 ${kept.length}건, 파일 ${(cmp.files || []).length}개`);
  }

  return { work, truncated };
}

/* ── 4. Granite 호출 ─────────────────────────────────────────────────────── */
function buildPrompt(work, repoMeta) {
  const blocks = [];

  for (const [repo, data] of work) {
    const name = repo.split("/")[1] || repo;
    const meta = repoMeta.get(repo);
    const head = [
      `### ${name}`,
      meta?.description ? `설명: ${meta.description}` : null,
      meta?.language ? `주 언어: ${meta.language}` : null,
      `규모: 파일 ${data.fileCount}개, +${data.additions}/-${data.deletions}줄`,
    ]
      .filter(Boolean)
      .join("\n");

    const commitLines = data.commits.map((c) => `  - ${c.message}`).join("\n");
    const fileLines = data.files
      .map((f) => `  - ${f.filename} (+${f.additions}/-${f.deletions})`)
      .join("\n");

    blocks.push(`${head}\n\n커밋:\n${commitLines}\n\n많이 바뀐 파일:\n${fileLines}`);
  }

  return `출력 형식을 반드시 지키세요. 다른 말은 덧붙이지 마세요.

TITLE: (여기에 글 제목 한 줄)
SUMMARY: (여기에 한 줄 요약)

(빈 줄 뒤부터 본문 Markdown. 구분선 --- 은 쓰지 마세요.)

당신은 자기 작업을 기록하는 한국어 개발 일지의 필자입니다.
아래는 최근에 직접 푸시한 내용입니다. 저장소별로 묶여 있습니다.

${blocks.join("\n\n")}

이 기록을 바탕으로 "요즘 무엇을 만들고 있는지" 를 정리하는 글을 쓰세요.

지켜야 할 것:
- 위에 없는 사실을 지어내지 마세요. 적히지 않은 기술 이름, 성능 수치, 버전,
  날짜를 넣지 마세요. 근거는 커밋 메시지와 파일 이름뿐입니다.
- 커밋을 하나씩 나열하지 마세요. 저장소별로 무슨 작업이 있었는지 묶어서
  흐름으로 쓰세요. 개별 커밋은 글 아래에 자동으로 링크됩니다.
- 왜 그 작업을 했는지 단정하지 마세요. 추측이면 추측으로 쓰세요.
- 홍보하듯 쓰지 마세요. 담담한 기록체로 씁니다.
- 소제목(##)은 저장소나 주제 단위로 2개에서 4개까지. 결론 절은 넣지 마세요.
- 분량은 600~1000자.
- 제목(#)은 본문에 넣지 마세요. TITLE 줄에만 씁니다.`;
}

async function generate(prompt) {
  const accountId = env("CF_ACCOUNT_ID");
  const token = env("CF_API_TOKEN");
  const model = process.env.CF_AI_MODEL || DEFAULT_MODEL;

  console.log(`  모델: ${model}`);

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "당신은 한국어로 개발 일지를 쓰는 필자입니다. " +
              "주어진 커밋 기록에 없는 내용은 절대 쓰지 않고, 요청받은 형식을 정확히 지킵니다.",
          },
          { role: "user", content: prompt },
        ],
        // 기본값 256 은 글 한 편에 턱없이 모자랍니다.
        max_tokens: 1800,
        // 낮출수록 지시를 잘 지킵니다. 초안이라 창의성보다 그쪽이 중요합니다.
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Cloudflare Workers AI 호출에 실패했습니다: ${error.message}`);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.success) {
    const detail =
      json?.errors?.map((e) => `${e.code} ${e.message}`).join(", ") ||
      (await res.text().catch(() => ""));
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `인증에 실패했습니다 (HTTP ${res.status}).\n` +
          "  CF_API_TOKEN 에 Workers AI 권한이 있는지, CF_ACCOUNT_ID 가 맞는지 확인하세요.\n" +
          `  응답: ${detail}`
      );
    }
    throw new Error(`Cloudflare Workers AI 오류: HTTP ${res.status} ${detail}`);
  }

  /*
   * /ai/run 은 보낸 형식에 맞춰 응답 형식을 바꿉니다.
   *   prompt 로 보내면    → result.response
   *   messages 로 보내면  → result.choices[0].message.content (OpenAI 호환)
   * 우리는 messages 를 쓰지만, 형식이 바뀌어도 견디도록 둘 다 봅니다.
   */
  const result = json.result ?? json;
  const text = (
    result.response ??
    result.choices?.[0]?.message?.content ??
    result.choices?.[0]?.text ??
    ""
  ).trim();

  if (!text) {
    throw new Error(
      "Cloudflare Workers AI 응답에서 본문을 찾지 못했습니다.\n" +
        `  result 의 키: ${Object.keys(result).join(", ") || "(없음)"}\n` +
        `  응답 일부: ${JSON.stringify(result).slice(0, 400)}`
    );
  }

  const used = result.usage;
  if (used) {
    console.log(`  토큰: 입력 ${used.prompt_tokens ?? "?"} / 출력 ${used.completion_tokens ?? "?"}`);
  }
  return text;
}

/* ── 5. 저장 ─────────────────────────────────────────────────────────────── */
const yamlString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function saveDraft(generated, work) {
  const lines = generated.split("\n");

  /*
   * 모델이 표시 앞에 공백이나 군더더기를 붙이는 일이 흔합니다.
   * 인덱스를 직접 찾아야 합니다 — 값으로 indexOf 를 하면 표시가 없을 때
   * 빈 문자열을 찾아 엉뚱한 빈 줄을 가리킵니다.
   */
  const findIndex = (marker) => lines.findIndex((l) => l.trimStart().startsWith(marker));
  const titleAt = findIndex("TITLE:");
  const summaryAt = findIndex("SUMMARY:");

  const after = (index, marker) =>
    index === -1 ? "" : lines[index].trimStart().slice(marker.length).trim();

  const title = after(titleAt, "TITLE:") || "제목을 붙여 주세요";
  const summary = after(summaryAt, "SUMMARY:");

  // 표시를 하나도 못 찾으면 출력 전체를 본문으로 봅니다(형식이 어긋나도 내용을
  // 잃지 않게). 사람이 검토하면서 제목·요약을 채우면 됩니다.
  const lastMarker = Math.max(titleAt, summaryAt);
  const rawBody = (lastMarker === -1 ? lines : lines.slice(lastMarker + 1)).join("\n").trim();

  /*
   * 본문 맨 앞의 구분선(---)을 걷어냅니다. 모델이 프롬프트의 구분선을 따라
   * 그리는 일이 잦은데, front matter 바로 뒤에 오면 파서가 두 번째 front
   * matter 로 읽어 글머리가 깨집니다.
   */
  const body = rawBody.replace(/^(\s*(-{3,}|\*{3,}|_{3,})\s*\n)+/, "").trim();

  if (titleAt === -1 || summaryAt === -1) {
    console.warn("  ⚠️ 출력에서 TITLE/SUMMARY 를 찾지 못했습니다. 검토할 때 채워 주세요.");
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const file = path.join(POSTS_DIR, `${today}-devlog.md`);

  const commitBlock = [];
  for (const [repo, data] of work) {
    commitBlock.push(`  - repo: ${yamlString(repo)}`);
    commitBlock.push("    items:");
    for (const c of data.commits) {
      commitBlock.push(`      - sha: ${yamlString(c.sha)}`);
      commitBlock.push(`        message: ${yamlString(c.message)}`);
    }
  }

  const frontMatter = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${today}`,
    `summary: ${yamlString(summary)}`,
    "aiDraft: true",
    "# 검토를 마치면 아래 draft 줄을 지우세요. 그전까지는 사이트에 나오지 않습니다.",
    "draft: true",
    "commits:",
    ...commitBlock,
    "---",
    "",
    body,
    "",
  ].join("\n");

  if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });
  writeFileSync(file, frontMatter, "utf8");
  return file;
}

function saveState(newestEventId, seen) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const seenShas = [...seen].slice(-SEEN_SHA_KEEP);
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { lastEventId: newestEventId, seenShas, updatedAt: new Date().toISOString() },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

/* ── 실행 ────────────────────────────────────────────────────────────────── */
const state = loadState();
console.log(`푸시 수집 중… (기준 이벤트 ${state.lastEventId || "없음 — 처음부터"})`);

const { ranges, newestEventId } = await collectRanges(state);

/*
 * --seed: 글을 만들지 않고 "지금까지는 처리한 것으로 친다" 고만 적습니다.
 * 처음 설치할 때 90일치 과거가 통째로 글이 되는 것을 막는 용도입니다.
 */
if (process.argv.includes("--seed")) {
  saveState(newestEventId, new Set());
  console.log(`\n기준점을 현재 시점(이벤트 ${newestEventId})으로 맞췄습니다.`);
  console.log("이제부터의 푸시만 글감이 됩니다.");
  process.exit(0);
}

if (ranges.size === 0) {
  console.log("새 푸시가 없어 초안을 만들지 않았습니다.");
  process.exit(0);
}

const seen = new Set(state.seenShas);
const { work, truncated } = await expandRanges(ranges, seen);

const total = [...work.values()].reduce((n, d) => n + d.commits.length, 0);
console.log(`  글감 커밋 ${total}건`);

if (total === 0) {
  console.log("글로 쓸 만한 커밋이 없어 초안을 만들지 않았습니다.");
  process.exit(0);
}

// 저장소 설명·언어는 모델이 프로젝트 성격을 짐작하는 데 도움이 됩니다.
const repoMeta = new Map();
for (const repo of work.keys()) {
  const info = await gh(`/repos/${repo}`, { optional: true });
  if (info) repoMeta.set(repo, { description: info.description, language: info.language });
}

console.log("IBM Granite 로 초안 생성 중…");
const generated = await generate(buildPrompt(work, repoMeta));

const file = saveDraft(generated, work);

/*
 * 저장소 상한에 걸려 일부만 실었다면 기준점을 옮기지 않습니다.
 * 옮겨 버리면 이번에 못 실은 저장소의 푸시가 영영 글이 되지 않습니다.
 * 실은 커밋은 seenShas 에 남으므로 다음 실행은 같은 구간을 다시 보되
 * 나머지 저장소부터 채웁니다.
 */
saveState(truncated ? state.lastEventId : newestEventId, seen);
if (truncated) {
  console.log("  (남은 저장소가 있어 기준점은 그대로 둡니다.)");
}

console.log(`\n초안을 저장했습니다: ${path.relative(process.cwd(), file)}`);
console.log("draft: true 상태라 사이트에는 나오지 않습니다. 검토 후 그 줄을 지우세요.");
