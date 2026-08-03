/**
 * 벤더 제품 문서의 갱신을 모아 아카이브로 쌓고, 하루치를 글 한 편으로 정리합니다.
 *
 *   node tools/vendor-watch.mjs
 *   node tools/vendor-watch.mjs --dry-run   (무엇이 새로 잡히는지만 보기)
 *   node tools/vendor-watch.mjs --seed      (지금까지는 본 것으로 치고 기준점만 잡기)
 *   node tools/vendor-watch.mjs --no-ai     (요약 없이 아카이브만 갱신)
 *
 * 다루는 곳
 *   IBM     발표 공고 · 세일즈 매뉴얼   (JSON API)
 *   Lenovo  Lenovo Press 기술 문서      (RSS, 변경 내역 포함)
 *   HPE     QuickSpecs 제품 사양        (Coveo 검색 API)
 *
 * ── 왜 "관측한 날" 로 글을 묶는가 ────────────────────────────────────────
 * 개발 일지(push-digest)는 커밋을 *작성한 날* 로 묶습니다. 커밋에는 믿을 만한
 * 작성 시각이 있기 때문입니다. 벤더 문서는 사정이 다릅니다.
 *
 *   - 세 곳 모두 최근 몇십 건만 담는 롤링 창이라 전체 이력을 주지 않습니다.
 *   - HPE 는 2025년 12월자 문서가 오늘 새로 색인돼 올라오기도 합니다.
 *
 * 문서 날짜로 글을 묶으면 오늘 관측한 변경이 반년 전 날짜의 글에 적히고,
 * 이미 발행한 글을 계속 고쳐 써야 합니다. 그래서 글은 *관측한 날* 로 묶고,
 * 각 항목이 들고 있는 벤더 날짜는 항목마다 따로 보여 줍니다.
 *
 * 문서 날짜 기준으로 훑어보는 건 아카이브 페이지(/archive/)가 맡습니다.
 * 글은 흐름(무엇이 새로 나왔나), 아카이브는 자료(무엇이 있나) 입니다.
 *
 * 필요한 환경 변수
 *   CF_ACCOUNT_ID   Cloudflare 계정 ID      (--no-ai 면 불필요)
 *   CF_API_TOKEN    Workers AI API 토큰     (--no-ai 면 불필요)
 *   CF_AI_MODEL     (선택) 기본값은 DEFAULT_MODEL
 *   IBM_REGION      (선택) 기본값 AP
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import * as ibm from "./sources/ibm.mjs";
import * as lenovo from "./sources/lenovo.mjs";
import * as hpe from "./sources/hpe.mjs";

const SOURCES = [ibm, lenovo, hpe];

const POSTS_DIR = path.resolve("src/updates");
const ARCHIVE_FILE = path.resolve("src/_data/vendorArchive.json");
const STATE_FILE = path.resolve(".state/vendor-seen.json");

/** 개발 일지와 같은 모델을 씁니다. 바꾸려면 저장소 변수 CF_AI_MODEL. */
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * 지문을 몇 개까지 기억할지.
 *
 * 세 소스가 한 번에 주는 게 300건 안팎입니다. 넉넉히 잡아야 롤링 창 안에서
 * 오래 머무는 문서를 매번 "새 것" 으로 잘못 잡지 않습니다.
 */
const SEEN_KEEP = 20000;

/** 프롬프트에 넣을 최대 항목 수. 넘으면 벤더별로 골라 넣고 나머지는 수만 알립니다. */
const MAX_PROMPT_ITEMS = 40;

const KST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const today = () => KST_DAY.format(new Date());

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name} 가 필요합니다.`);
  return value;
};

/* ── 상태 ────────────────────────────────────────────────────────────────── */
function loadState() {
  if (!existsSync(STATE_FILE)) return { seen: [] };
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { seen: Array.isArray(parsed.seen) ? parsed.seen : [] };
  } catch (error) {
    // 상태가 깨졌다고 멈추면 자동화가 죽습니다. 처음부터 다시 보는 편이 낫습니다.
    console.warn(`  ⚠️ 상태 파일을 읽지 못해 처음부터 봅니다: ${error.message}`);
    return { seen: [] };
  }
}

function saveState(seen) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { seen: [...seen].slice(-SEEN_KEEP), updatedAt: new Date().toISOString() },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function loadArchive() {
  if (!existsSync(ARCHIVE_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(ARCHIVE_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`  ⚠️ 아카이브를 읽지 못했습니다: ${error.message}`);
    return [];
  }
}

function saveArchive(records) {
  mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
  // 벤더가 밝힌 날짜 기준 최신순. 아카이브 페이지가 이 순서를 그대로 씁니다.
  const sorted = [...records].sort(
    (a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor)
  );
  writeFileSync(ARCHIVE_FILE, JSON.stringify(sorted, null, 1) + "\n", "utf8");
}

/* ── 수집 ────────────────────────────────────────────────────────────────── */
async function collectAll() {
  const items = [];
  const failed = [];

  for (const source of SOURCES) {
    try {
      const got = await source.collect();
      console.log(`  ${source.vendor}: ${got.length}건`);
      items.push(...got);
    } catch (error) {
      /*
       * 한 곳이 막혀도 나머지는 실어야 합니다. HPE 는 공식 API 가 아니라
       * 화면 내부 호출을 쓰므로 언젠가는 깨집니다. 그때 IBM·Lenovo 까지
       * 같이 멈추면 아카이브에 구멍이 납니다.
       */
      console.warn(`  ⚠️ ${source.vendor} 수집 실패 — 건너뜁니다: ${error.message}`);
      failed.push({ vendor: source.vendor, message: error.message });
    }
  }

  return { items, failed };
}

/* ── 요약 ────────────────────────────────────────────────────────────────── */
function buildPrompt(day, byVendor, total) {
  const blocks = [];

  for (const [vendor, list] of byVendor) {
    const shown = list.slice(0, Math.ceil(MAX_PROMPT_ITEMS / byVendor.size));
    const lines = shown.map((r) => {
      const bits = [r.kind, r.tag].filter(Boolean).join("/");
      const note = r.note ? `\n      변경: ${r.note}` : "";
      return `  - [${r.date}] ${r.title}${bits ? ` (${bits})` : ""}${note}`;
    });
    const more = list.length > shown.length ? `\n  … 외 ${list.length - shown.length}건` : "";
    blocks.push(`### ${vendor} — ${list.length}건\n${lines.join("\n")}${more}`);
  }

  return `출력 형식을 반드시 지키세요. 다른 말은 덧붙이지 마세요.

TITLE: (여기에 글 제목 한 줄)
SUMMARY: (여기에 한 줄 요약)

(빈 줄 뒤부터 본문 Markdown. 구분선 --- 은 쓰지 마세요.)

당신은 서버·스토리지 벤더의 제품 문서 갱신을 추적해 정리하는 한국어 기록자입니다.
${day}에 새로 관측된 문서 ${total}건입니다. 벤더별로 묶여 있습니다.
각 항목 앞 [날짜]는 벤더가 밝힌 발표일 또는 갱신일입니다.

${blocks.join("\n\n")}

이 날 관측된 변경을 정리하는 글을 쓰세요.

지켜야 할 것:
- 위에 없는 사실을 지어내지 마세요. 적히지 않은 제품명, 사양, 성능 수치,
  가격, 출시일을 넣지 마세요. 근거는 위 제목과 변경 내역뿐입니다.
- 항목을 하나씩 나열하지 마세요. 벤더별로 어떤 종류의 갱신이 있었는지
  묶어서 쓰세요. 개별 문서는 글 아래에 자동으로 링크됩니다.
- 눈에 띄는 것이 있으면 짚되, 중요도를 단정하지 마세요. 추측이면 추측으로 쓰세요.
- 홍보하듯 쓰지 마세요. 담담한 기록체로 씁니다.
- 소제목(##)은 벤더 단위로. 벤더가 하나뿐이면 소제목 없이 쓰세요.
- 분량은 400~800자. 항목이 적으면 짧게 쓰세요. 억지로 늘리지 마세요.
- 제목(#)은 본문에 넣지 마세요. TITLE 줄에만 씁니다.`;
}

async function generate(prompt) {
  const accountId = env("CF_ACCOUNT_ID");
  const token = env("CF_API_TOKEN");
  const model = process.env.CF_AI_MODEL || DEFAULT_MODEL;

  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "당신은 한국어로 제품 문서 갱신 기록을 쓰는 기록자입니다. " +
                "주어진 목록에 없는 내용은 절대 쓰지 않고, 요청받은 형식을 정확히 지킵니다.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 1500,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      }
    );
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

  const result = json.result ?? json;
  const text = (
    result.response ??
    result.choices?.[0]?.message?.content ??
    result.choices?.[0]?.text ??
    ""
  ).trim();

  if (!text) throw new Error("Cloudflare Workers AI 응답에서 본문을 찾지 못했습니다.");
  return text;
}

/* ── 저장 ────────────────────────────────────────────────────────────────── */
const yamlString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function freeFilename(day) {
  let file = path.join(POSTS_DIR, `${day}-updates.md`);
  let n = 2;
  while (existsSync(file)) {
    file = path.join(POSTS_DIR, `${day}-updates-${n}.md`);
    n++;
  }
  return file;
}

/** 요약을 못 만들었을 때 쓰는 본문. 목록만으로도 기록의 값어치는 남습니다. */
function fallbackBody(byVendor) {
  return [...byVendor]
    .map(([vendor, list]) => `- **${vendor}** ${list.length}건`)
    .join("\n");
}

function savePost(day, generated, byVendor, total, failed) {
  let title = `${day} 벤더 문서 갱신 ${total}건`;
  let summary = [...byVendor].map(([v, l]) => `${v} ${l.length}`).join(" · ");
  let body = fallbackBody(byVendor);

  if (generated) {
    // 추론형 모델은 <think> 로 사고 과정을 먼저 뱉습니다.
    const lines = generated
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim()
      .split("\n");

    const findIndex = (marker) => lines.findIndex((l) => l.trimStart().startsWith(marker));
    const titleAt = findIndex("TITLE:");
    const summaryAt = findIndex("SUMMARY:");
    const after = (index, marker) =>
      index === -1 ? "" : lines[index].trimStart().slice(marker.length).trim();

    if (titleAt !== -1) title = after(titleAt, "TITLE:") || title;
    if (summaryAt !== -1) summary = after(summaryAt, "SUMMARY:") || summary;

    const lastMarker = Math.max(titleAt, summaryAt);
    const rawBody = (lastMarker === -1 ? lines : lines.slice(lastMarker + 1)).join("\n").trim();

    // front matter 바로 뒤의 구분선은 두 번째 front matter 로 읽혀 글머리를 깹니다.
    const cleaned = rawBody
      .replace(/^(\s*(-{3,}|\*{3,}|_{3,})\s*\n)+/, "")
      // 모델이 지어낸 앵커 링크. 문서 목록은 템플릿이 따로 렌더합니다.
      .replace(/(?:^|\n)[ \t]*(?:\[[^\]\n]*\]\(#[^)\n]*\)[ \t]*)+$/, "")
      .trim();

    if (cleaned) body = cleaned;
    if (titleAt === -1 || summaryAt === -1) {
      console.warn(`  ⚠️ ${day}: 출력에서 TITLE/SUMMARY 를 찾지 못해 기본값을 씁니다.`);
    }
  }

  const entries = [];
  for (const [vendor, list] of byVendor) {
    entries.push(`  - vendor: ${yamlString(vendor)}`);
    entries.push("    items:");
    for (const r of list) {
      entries.push(`      - title: ${yamlString(r.title)}`);
      entries.push(`        url: ${yamlString(r.url)}`);
      entries.push(`        date: ${yamlString(r.date)}`);
      entries.push(`        kind: ${yamlString(r.kind)}`);
      if (r.ref) entries.push(`        ref: ${yamlString(r.ref)}`);
      if (r.note) entries.push(`        note: ${yamlString(r.note)}`);
    }
  }

  const frontMatter = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${day}`,
    `summary: ${yamlString(summary)}`,
    `total: ${total}`,
    `aiGenerated: ${generated ? "true" : "false"}`,
    ...(failed.length
      ? ["failed:", ...failed.map((f) => `  - ${yamlString(`${f.vendor}: ${f.message}`)}`)]
      : []),
    "entries:",
    ...entries,
    "---",
    "",
    body,
    "",
  ].join("\n");

  if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });
  const file = freeFilename(day);
  writeFileSync(file, frontMatter, "utf8");
  return file;
}

/* ── 실행 ────────────────────────────────────────────────────────────────── */
const dryRun = process.argv.includes("--dry-run");
const seedOnly = process.argv.includes("--seed");
const noAi = process.argv.includes("--no-ai");

const state = loadState();
console.log(`벤더 문서 수집 중… (이미 본 항목 ${state.seen.length}개)`);

const { items, failed } = await collectAll();

if (items.length === 0) {
  console.log("수집된 항목이 없습니다. 모든 소스가 실패했는지 확인하세요.");
  process.exit(failed.length === SOURCES.length ? 1 : 0);
}

const seen = new Set(state.seen);
const fresh = [];
for (const item of items) {
  if (seen.has(item.fingerprint)) continue;
  seen.add(item.fingerprint);
  fresh.push(item);
}

console.log(`  새로 잡힌 항목 ${fresh.length}건 (전체 ${items.length}건)`);

if (seedOnly) {
  saveState(seen);
  console.log(`\n기준점을 잡았습니다. 지금 보이는 ${items.length}건은 글로 쓰지 않습니다.`);
  console.log("이제부터 새로 올라오는 문서만 기록됩니다.");
  process.exit(0);
}

if (fresh.length === 0) {
  console.log("새 문서가 없어 글을 만들지 않았습니다.");
  process.exit(0);
}

// 벤더별로 묶습니다. 날짜는 벤더가 밝힌 것 기준 최신순.
const byVendor = new Map();
for (const r of fresh.sort((a, b) => b.date.localeCompare(a.date))) {
  if (!byVendor.has(r.vendor)) byVendor.set(r.vendor, []);
  byVendor.get(r.vendor).push(r);
}

if (dryRun) {
  console.log("\n[dry-run] 새로 잡힌 항목:");
  for (const [vendor, list] of byVendor) {
    console.log(`\n  ${vendor} (${list.length}건)`);
    for (const r of list.slice(0, 10)) {
      console.log(`    [${r.date}] ${r.title.slice(0, 78)}`);
      if (r.note) console.log(`             변경: ${r.note.slice(0, 76)}`);
    }
    if (list.length > 10) console.log(`    … 외 ${list.length - 10}건`);
  }
  console.log("\n아무것도 저장하지 않았습니다.");
  process.exit(0);
}

const day = today();

let generated = null;
if (!noAi) {
  console.log(`요약 생성 중… (모델 ${process.env.CF_AI_MODEL || DEFAULT_MODEL})`);
  try {
    generated = await generate(buildPrompt(day, byVendor, fresh.length));
  } catch (error) {
    /*
     * 요약에 실패해도 수집 결과는 남겨야 합니다. 여기서 멈추면 롤링 창이
     * 넘어가는 사이 그날 갱신을 통째로 놓칩니다. 목록만 실린 글이라도
     * 기록으로서는 온전합니다.
     */
    console.warn(`  ⚠️ 요약을 만들지 못해 목록만 싣습니다: ${error.message}`);
  }
}

const archive = loadArchive();
const known = new Set(archive.map((r) => r.fingerprint));
for (const r of fresh) {
  if (known.has(r.fingerprint)) continue;
  // seenAt 은 우리가 관측한 날. 벤더 날짜(date)와 구분해서 남깁니다.
  archive.push({ ...r, seenAt: day });
}
saveArchive(archive);

const file = savePost(day, generated, byVendor, fresh.length, failed);
saveState(seen);

console.log(`\n${path.relative(process.cwd(), file)} 에 ${fresh.length}건을 기록했습니다.`);
console.log(`아카이브 누적 ${archive.length}건.`);
