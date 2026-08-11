import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as hpe from "./sources/hpe.mjs";
import * as ibm from "./sources/ibm.mjs";
import * as lenovo from "./sources/lenovo.mjs";
import { generate, model, parseDraft, yaml } from "./lib.mjs";

const ARCHIVE_FILE = "src/_data/vendorArchive.json";
const POSTS_DIR = "src/updates";
const sources = [ibm, lenovo, hpe];
const DRY_RUN = process.argv.includes("--dry-run");
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const keyOf = (item) => `${item.vendor}:${item.url}:${item.date}`;

function prompt(groups, total) {
  const limit = Math.ceil(30 / groups.size);
  const source = [...groups]
    .map(([vendor, items]) => {
      const lines = items.slice(0, limit).map((item) => {
        const note = item.note ? ` — ${item.note}` : "";
        return `- [${item.date}] ${item.title} (${item.kind})${note}`;
      });
      if (items.length > limit) lines.push(`- 그 외 ${items.length - limit}건`);
      return `## ${vendor} (${items.length}건)\n${lines.join("\n")}`;
    })
    .join("\n\n");
  return `다음은 ${day}에 새로 관측한 벤더 문서 ${total}건입니다. 벤더별 갱신 경향만 담담하게 250~600자로 정리하세요. 자료에 없는 사양, 중요도, 의견은 쓰지 마세요.\n\n${source}\n\n정확히 다음 형식으로 답하세요.\nTITLE: 제목\nSUMMARY: 한 줄 요약\n\nMarkdown 본문`;
}

function fallbackDraft(groups, total) {
  const summary = [...groups].map(([vendor, items]) => `${vendor} ${items.length}건`).join(" · ");
  const body = [...groups]
    .map(([vendor, items]) => {
      const dates = [...new Set(items.map((item) => item.date))].sort().join(", ");
      return `## ${vendor}\n\n새로 관측한 문서 ${items.length}건을 아카이브에 추가했습니다. 문서 날짜: ${dates}`;
    })
    .join("\n\n");
  return {
    title: `${day} 벤더 문서 갱신 ${total}건`,
    summary: summary || `벤더 문서 ${total}건을 기록했습니다.`,
    body,
  };
}

function availableFile() {
  let file = path.join(POSTS_DIR, `${day}-updates.md`);
  for (let n = 2; existsSync(file); n++) file = path.join(POSTS_DIR, `${day}-updates-${n}.md`);
  return file;
}

function saveArchive(records) {
  records.sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
  writeFileSync(ARCHIVE_FILE, `[\n${records.map(JSON.stringify).join(",\n")}\n]\n`, "utf8");
}

function savePost(draft, total, aiGenerated, failed) {
  mkdirSync(POSTS_DIR, { recursive: true });
  const file = availableFile();
  writeFileSync(
    file,
    [
      "---",
      `title: ${yaml(draft.title)}`,
      `date: ${day}`,
      `summary: ${yaml(draft.summary)}`,
      `total: ${total}`,
      `aiGenerated: ${aiGenerated}`,
      ...(failed.length
        ? ["failedSources:", ...failed.map((item) => `  - ${yaml(`${item.vendor}: ${item.message}`)}`)]
        : []),
      "---",
      "",
      draft.body,
      "",
    ].join("\n"),
    "utf8"
  );
  return file;
}

async function collectAll() {
  const settled = await Promise.allSettled(sources.map((source) => source.collect()));
  const records = [];
  const failed = [];
  settled.forEach((result, index) => {
    const vendor = sources[index].vendor;
    if (result.status === "fulfilled") {
      console.log(`  ${vendor}: ${result.value.length}건 수집`);
      records.push(...result.value);
    } else {
      const message = result.reason?.message || String(result.reason);
      console.warn(`  ⚠️ ${vendor} 수집 실패, 다른 소스는 계속 처리합니다: ${message}`);
      failed.push({ vendor, message });
    }
  });
  return { records, failed };
}

console.log("벤더 문서 수집 중");
const archive = JSON.parse(readFileSync(ARCHIVE_FILE, "utf8"));
const known = new Set(archive.map(keyOf));
const { records, failed } = await collectAll();

if (failed.length === sources.length) {
  throw new Error("모든 벤더 소스 수집에 실패했습니다.");
}

const freshByKey = new Map();
for (const item of records) {
  const key = keyOf(item);
  if (!known.has(key) && !freshByKey.has(key)) freshByKey.set(key, item);
}
const fresh = [...freshByKey.values()];

if (!fresh.length) {
  console.log("새 문서가 없습니다.");
  if (failed.length) process.exitCode = 1;
} else {
  const groups = new Map();
  for (const item of fresh.sort((a, b) => b.date.localeCompare(a.date))) {
    if (!groups.has(item.vendor)) groups.set(item.vendor, []);
    groups.get(item.vendor).push(item);
  }

  console.log(`새 문서 ${fresh.length}건 (${[...groups].map(([vendor, items]) => `${vendor} ${items.length}`).join(", ")})`);

  if (DRY_RUN) {
    for (const [vendor, items] of groups) {
      const dates = [...new Set(items.map((item) => item.date))].sort().join(", ");
      console.log(`  ${vendor}: ${items.length}건, 문서 날짜 ${dates}`);
    }
    console.log("드라이런이므로 파일을 저장하지 않았습니다.");
  } else {
    const fallback = fallbackDraft(groups, fresh.length);
    let draft = fallback;
    let aiGenerated = false;
    try {
      draft = parseDraft(await generate(prompt(groups, fresh.length)), fallback);
      aiGenerated = true;
    } catch (error) {
      console.warn(`  ⚠️ AI 요약 실패, 기본 본문을 저장합니다: ${error.message}`);
    }

    const file = savePost(draft, fresh.length, aiGenerated, failed);
    saveArchive([...archive, ...fresh]);
    console.log(`${file} 저장, 아카이브 ${archive.length + fresh.length}건`);
    if (failed.length) process.exitCode = 1;
  }
}
