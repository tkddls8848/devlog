import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const issuesDir = path.join(root, "src", "issues");
const outputDir = path.join(root, "worker", "generated");
const outputFile = path.join(outputDir, "legacy-issues.mjs");
const archiveOutputFile = path.join(outputDir, "legacy-archive.mjs");

const dateOnly = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
};

const issues = readdirSync(issuesDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => {
    const { data, content } = matter(readFileSync(path.join(issuesDir, name), "utf8"));
    const issueDate = dateOnly(data.date);
    return {
      slug: name.slice(0, -3),
      issueDate,
      title: String(data.title || `${issueDate} IT 뉴스 다이제스트`),
      summary: String(data.summary || ""),
      bodyMarkdown: content.trim(),
      aiGenerated: Boolean(data.aiGenerated),
      publishedAt: new Date(`${issueDate}T07:00:00+09:00`).toISOString(),
      sources: (data.sources || []).map((group) => ({
        source: String(group.source || ""),
        kind: String(group.kind || ""),
        entries: (group.entries || []).map((entry) => ({
          title: String(entry.title || ""),
          url: String(entry.url || ""),
          at: new Date(entry.at).toISOString(),
          ...(entry.note ? { note: String(entry.note) } : {}),
        })),
      })),
    };
  });

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  outputFile,
  `// npm run build가 기존 Markdown 이슈에서 생성합니다. 직접 수정하지 마세요.\nexport default ${JSON.stringify(issues, null, 2)};\n`,
  "utf8"
);

const archiveFile = path.join(root, "..", "archive", "src", "_data", "vendorArchive.json");
const legacyArchive = JSON.parse(readFileSync(archiveFile, "utf8")).map((item) => ({
  vendor: String(item.vendor || ""),
  title: String(item.title || ""),
  url: String(item.url || ""),
  date: String(item.date || "").slice(0, 10),
  kind: String(item.kind || "기술 문서"),
  ...(item.tag ? { tag: String(item.tag) } : {}),
  ...(item.ref ? { ref: String(item.ref) } : {}),
  ...(item.note ? { note: String(item.note) } : {}),
}));
writeFileSync(
  archiveOutputFile,
  `// npm run build가 기존 아카이브 JSON에서 생성합니다. 직접 수정하지 마세요.\nexport default ${JSON.stringify(legacyArchive, null, 2)};\n`,
  "utf8"
);
console.log(`기존 뉴스레터 ${issues.length}편을 D1 초기 데이터로 준비했습니다.`);
console.log(`기존 벤더 문서 ${legacyArchive.length}건을 D1 초기 데이터로 준비했습니다.`);
