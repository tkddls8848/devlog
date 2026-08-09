import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as hpe from "./sources/hpe.mjs";
import * as ibm from "./sources/ibm.mjs";
import * as lenovo from "./sources/lenovo.mjs";
import { generate, model, parseDraft, yaml } from "./lib.mjs";

const ARCHIVE_FILE = "src/_data/vendorArchive.json";
const POSTS_DIR = "src/updates";
const sources = [ibm, lenovo, hpe];
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

function availableFile() {
  let file = path.join(POSTS_DIR, `${day}-updates.md`);
  for (let n = 2; existsSync(file); n++) file = path.join(POSTS_DIR, `${day}-updates-${n}.md`);
  return file;
}

function saveArchive(records) {
  records.sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
  writeFileSync(ARCHIVE_FILE, `[\n${records.map(JSON.stringify).join(",\n")}\n]\n`, "utf8");
}

function savePost(draft, total) {
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
      "---",
      "",
      draft.body,
      "",
    ].join("\n"),
    "utf8"
  );
  return file;
}

console.log("벤더 문서 수집 중");
const archive = JSON.parse(readFileSync(ARCHIVE_FILE, "utf8"));
const known = new Set(archive.map(keyOf));
const collected = (await Promise.all(sources.map((source) => source.collect()))).flat();
const fresh = collected.filter((item) => !known.has(keyOf(item)));

if (!fresh.length) {
  console.log("새 문서가 없습니다.");
  process.exit(0);
}

const groups = new Map();
for (const item of fresh.sort((a, b) => b.date.localeCompare(a.date))) {
  if (!groups.has(item.vendor)) groups.set(item.vendor, []);
  groups.get(item.vendor).push(item);
}

console.log(`갱신 일지 생성 중 (문서 ${fresh.length}건, ${model})`);
const draft = parseDraft(await generate(prompt(groups, fresh.length)));
const file = savePost(draft, fresh.length);
saveArchive([...archive, ...fresh]);
console.log(`${file} 저장, 아카이브 ${archive.length + fresh.length}건`);
