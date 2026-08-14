import { readFileSync, writeFileSync } from "node:fs";
import * as hpe from "./sources/hpe.mjs";
import * as ibm from "./sources/ibm.mjs";
import * as lenovo from "./sources/lenovo.mjs";

const ARCHIVE_FILE = "src/_data/vendorArchive.json";
const sources = [ibm, lenovo, hpe];
const DRY_RUN = process.argv.includes("--dry-run");
const keyOf = (item) => `${item.vendor}:${item.url}:${item.date}`;

function saveArchive(records) {
  records.sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
  writeFileSync(ARCHIVE_FILE, `[\n${records.map(JSON.stringify).join(",\n")}\n]\n`, "utf8");
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
    saveArchive([...archive, ...fresh]);
    console.log(`아카이브 ${archive.length + fresh.length}건 저장`);
  }
}

if (failed.length) process.exitCode = 1;
