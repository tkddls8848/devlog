import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "worker", "generated");
const archive = JSON.parse(readFileSync(path.join(root, "..", "archive", "src", "_data", "vendorArchive.json"), "utf8")).map((item) => ({
  vendor: String(item.vendor || ""), title: String(item.title || ""), url: String(item.url || ""),
  date: String(item.date || "").slice(0, 10), kind: String(item.kind || "기술 문서"),
  ...(item.tag ? { tag: String(item.tag) } : {}), ...(item.ref ? { ref: String(item.ref) } : {}),
  ...(item.note ? { note: String(item.note) } : {}),
}));

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "legacy-archive.mjs"), `// npm run build가 기존 아카이브 JSON에서 생성합니다.\nexport default ${JSON.stringify(archive, null, 2)};\n`, "utf8");
console.log(`기존 벤더 문서 ${archive.length}건을 D1 초기 데이터로 준비했습니다.`);
