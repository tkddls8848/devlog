// Cloudflare 밖에서 벤더 문서를 수집해 운영 D1에 넣는다.
// HPE 사이트는 Cloudflare Worker에서 오는 요청을 HTTP 520으로 막는다(2026-09-25부터 매일 0건).
// 그래서 HPE는 GitHub Actions나 로컬에서 이 스크립트로 수집한다.
//   CLOUDFLARE_API_TOKEN(D1 편집)과 CLOUDFLARE_ACCOUNT_ID가 있으면 D1 HTTP API로,
//   없으면 로컬 wrangler 로그인으로 넣는다.
// 사용: node tools/push-vendor-docs.mjs [--dry-run]
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectHpe } from "../../shared/vendor-hpe.mjs";

const NEWS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_ID = "49dde3a7-307c-463d-91bc-c2d44cf7a8e7";
const DATABASE_NAME = "devlog-news";

const q = (value) => (value === null || value === undefined ? "NULL" : `'${String(value).replace(/\u0000/g, "").replace(/'/g, "''")}'`);

export function insertSql(records) {
  return records
    .filter((item) => item?.vendor && item?.title && item?.url && /^\d{4}-\d{2}-\d{2}$/.test(item.date || ""))
    .map((item) => `INSERT OR IGNORE INTO vendor_documents (vendor, title, url, document_date, kind, tag, ref, note) VALUES (${[item.vendor, item.title, item.url, item.date, item.kind || "기술 문서", item.tag || null, item.ref || null, item.note || null].map(q).join(", ")});`);
}

export function runSql(report, now = new Date()) {
  return `INSERT INTO archive_runs (started_at, finished_at, status, collected_count, inserted_count, failed_sources, error) VALUES (${q(now.toISOString())}, ${q(new Date().toISOString())}, ${q(report.status === "failed" ? "failed" : report.status === "partial" ? "partial" : "success")}, ${report.counts.collected || 0}, 0, ${q(JSON.stringify(report.status === "success" ? [] : [{ ...report, via: "external" }]))}, NULL);`;
}

async function executeViaApi(statements) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  for (let i = 0; i < statements.length; i += 50) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE_ID}/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql: statements.slice(i, i + 50).join("\n") }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) throw new Error(`D1 API ${response.status}: ${JSON.stringify(result.errors || result).slice(0, 300)}`);
  }
}

function executeViaWrangler(statements) {
  const dir = mkdtempSync(path.join(tmpdir(), "vendor-docs-"));
  try {
    const file = path.join(dir, "insert.sql");
    writeFileSync(file, `${statements.join("\n")}\n`, "utf8");
    const wrangler = path.join(NEWS_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
    const result = spawnSync(process.execPath, [wrangler, "d1", "execute", DATABASE_NAME, "--remote", "--file", file], { cwd: NEWS_ROOT, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`wrangler d1 execute 실패\n${result.stderr || result.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const startedAt = new Date();
  const { records, report } = await collectHpe();
  console.log(`HPE: ${records.length}건 수집 (${report.status}), 최신 문서 ${records.map((r) => r.date).sort().at(-1) || "-"}`);
  if (report.status !== "success") console.warn(JSON.stringify(report));
  const statements = [...insertSql(records), runSql(report, startedAt)];
  if (process.argv.includes("--dry-run")) return console.log(`드라이런: SQL ${statements.length}문`);
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) await executeViaApi(statements);
  else executeViaWrangler(statements);
  console.log("운영 D1에 반영했습니다(이미 있는 문서는 건너뜀).");
  if (report.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
