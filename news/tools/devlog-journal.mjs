// 개발 기록을 직접 쓰는 도구. Cron이 D1에 남긴 초안과 참고 자료를 Markdown
// 파일로 받아(pull) 그날의 회고를 쓰고, 참고 자료를 뺀 본문만 발행(publish)한다.
// D1 접근은 로컬 wrangler 로그인을 그대로 쓴다. Worker에는 쓰기 경로가 없다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEWS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const JOURNAL_DIR = path.resolve(NEWS_ROOT, "..", "devlog", "journal");
const DATABASE = "devlog-news";
export const REFERENCE_MARKER = "<!-- devlog:reference 이 줄 아래는 참고 자료이며 발행되지 않습니다. -->";
const GUIDE = `<!-- 이 아래에 그날의 작업 회고를 줄글로 쓰세요. ## 소제목, 목록, **강조**, \`코드\`, 코드 블록을 쓸 수 있습니다.
     아래 참고 자료는 발행되지 않습니다. title과 summary를 채운 뒤
     npm run journal -- publish <이 파일>  로 발행합니다. -->`;

export const sqlString = (value) => `'${String(value ?? "").replace(/\u0000/g, "").replace(/'/g, "''")}'`;
const assertSlug = (slug) => {
  if (!/^[a-z0-9-]+$/i.test(String(slug || ""))) throw new Error(`올바르지 않은 slug입니다: ${slug}`);
  return slug;
};

export function formatJournal(post) {
  const meta = { slug: post.slug, date: post.post_date, status: post.status, title: post.title, summary: post.summary || "" };
  const front = Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(String(value ?? ""))}`).join("\n");
  const body = String(post.body_markdown || "").trim();
  const reference = String(post.reference_markdown || "").trim() || "_이 글에는 저장된 참고 자료가 없습니다._";
  return `---\n${front}\n---\n\n${GUIDE}\n\n${body ? `${body}\n` : "\n"}\n${REFERENCE_MARKER}\n\n${reference}\n`;
}

export function parseJournal(text) {
  const source = String(text).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const front = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!front) throw new Error("파일 맨 앞의 --- 머리말을 찾지 못했습니다.");
  const meta = {};
  for (const line of front[1].split("\n")) {
    const match = line.match(/^([a-z]+):\s*(.*)$/i);
    if (!match) continue;
    const raw = match[2].trim();
    try { meta[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw; }
    catch { throw new Error(`머리말 ${match[1]} 값의 따옴표가 맞지 않습니다.`); }
  }
  const rest = source.slice(front[0].length);
  const markerAt = rest.indexOf(REFERENCE_MARKER);
  // HTML은 화면에서 escape되므로 주석은 안내문으로만 쓰고 발행 본문에서는 뺀다.
  const body = (markerAt >= 0 ? rest.slice(0, markerAt) : rest).replace(/<!--[\s\S]*?-->/g, "").trim();
  return { slug: meta.slug, date: meta.date, status: meta.status, title: String(meta.title || "").trim(), summary: String(meta.summary || "").trim(), body };
}

export function validateJournal(entry) {
  const problems = [];
  if (!entry.slug) problems.push("머리말에 slug가 없습니다.");
  if (!entry.title) problems.push("title을 채워 주세요.");
  if (!entry.summary) problems.push("summary를 한두 문장으로 채워 주세요.");
  if (entry.body.length < 200) problems.push(`본문이 ${entry.body.length}자입니다. 200자 이상 써 주세요.`);
  return problems;
}

export function publishSql(entry, now = new Date()) {
  const at = sqlString(now.toISOString());
  return `UPDATE devlog_posts SET
  title = ${sqlString(entry.title)},
  summary = ${sqlString(entry.summary)},
  body_markdown = ${sqlString(entry.body)},
  ai_generated = 0,
  published_at = CASE WHEN status = 'draft' THEN ${at} ELSE published_at END,
  updated_at = ${at},
  status = 'published'
WHERE slug = ${sqlString(assertSlug(entry.slug))};
`;
}

function d1({ sql, file, remote }) {
  const wrangler = path.join(NEWS_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wrangler)) throw new Error("news 폴더에서 npm ci로 wrangler를 먼저 설치하세요.");
  const args = [wrangler, "d1", "execute", DATABASE, remote ? "--remote" : "--local", "--json", ...(file ? ["--file", file] : ["--command", sql])];
  const result = spawnSync(process.execPath, args, { cwd: NEWS_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`wrangler d1 execute 실패\n${result.stderr || result.stdout}`);
  const start = result.stdout.indexOf("[");
  return start >= 0 ? JSON.parse(result.stdout.slice(start)) : [];
}
const rows = (output) => output.flatMap((item) => item.results || []);

async function list({ remote }) {
  const found = rows(d1({ remote, sql: `SELECT p.slug, p.post_date, p.status, p.title, (SELECT COUNT(*) FROM devlog_commits c WHERE c.post_slug = p.slug) AS commits
    FROM devlog_posts p WHERE p.status = 'draft' ORDER BY p.post_date DESC, p.slug` }));
  if (!found.length) return console.log("쓰지 않은 초안이 없습니다.");
  console.log(`쓰지 않은 초안 ${found.length}편`);
  for (const post of found) {
    const file = path.join(JOURNAL_DIR, `${post.slug}.md`);
    console.log(`  ${post.post_date}  ${post.slug}  커밋 ${post.commits}건${existsSync(file) ? "  (파일 있음)" : ""}`);
  }
}

async function pull(target, { remote, force }) {
  if (!target) throw new Error("사용법: npm run journal -- pull <slug 또는 YYYY-MM-DD>");
  const where = /^\d{4}-\d{2}-\d{2}$/.test(target) ? `post_date = ${sqlString(target)}` : `slug = ${sqlString(assertSlug(target))}`;
  const found = rows(d1({ remote, sql: `SELECT slug, post_date, status, title, summary, body_markdown, reference_markdown
    FROM devlog_posts WHERE ${where} ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, slug` }));
  if (!found.length) throw new Error(`${target}에 해당하는 글이 없습니다.`);
  if (found.length > 1) {
    console.log(`${target}에 글이 ${found.length}편 있습니다. slug로 골라 주세요.`);
    for (const post of found) console.log(`  ${post.slug}  ${post.status}  ${post.title}`);
    return;
  }
  const [post] = found;
  const file = path.join(JOURNAL_DIR, `${post.slug}.md`);
  // 이미 쓰고 있는 파일을 덮어쓰면 작성한 글을 잃는다.
  if (existsSync(file) && !force) throw new Error(`${file}이 이미 있습니다. 덮어쓰려면 --force를 붙이세요.`);
  mkdirSync(JOURNAL_DIR, { recursive: true });
  writeFileSync(file, formatJournal(post), "utf8");
  console.log(`${file}\n위 파일에 회고를 쓰고 발행하세요: npm run journal -- publish ${path.relative(NEWS_ROOT, file)}`);
}

async function publish(file, { remote, dryRun }) {
  if (!file) throw new Error("사용법: npm run journal -- publish <파일>");
  const source = readFileSync(path.resolve(file), "utf8");
  const entry = parseJournal(source);
  const problems = validateJournal(entry);
  if (problems.length) throw new Error(`발행하지 않았습니다.\n- ${problems.join("\n- ")}`);
  const sql = publishSql(entry);
  if (dryRun) return console.log(`드라이런: ${entry.slug} (${entry.body.length}자)\n\n${sql}`);
  const dir = mkdtempSync(path.join(tmpdir(), "devlog-journal-"));
  try {
    writeFileSync(path.join(dir, "publish.sql"), sql, "utf8");
    d1({ remote, file: path.join(dir, "publish.sql") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const [saved] = rows(d1({ remote, sql: `SELECT status, length(body_markdown) AS length FROM devlog_posts WHERE slug = ${sqlString(entry.slug)}` }));
  if (saved?.status !== "published") throw new Error(`${entry.slug}이 D1에 없거나 발행되지 않았습니다.`);
  writeFileSync(path.resolve(file), source.replace(/^status:\s*.*$/m, 'status: "published"'), "utf8");
  console.log(`${entry.slug} 발행 완료 (${saved.length}자). 화면 캐시 때문에 반영까지 최대 1시간 걸릴 수 있습니다.`);
}

export async function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const [command, target] = argv.filter((arg) => !arg.startsWith("--"));
  const options = { remote: !flags.has("--local"), force: flags.has("--force"), dryRun: flags.has("--dry-run") };
  if (command === "list") return list(options);
  if (command === "pull") return pull(target, options);
  if (command === "publish") return publish(target, options);
  console.log(`사용법 (news 폴더에서):
  npm run journal -- list                     쓰지 않은 초안 보기
  npm run journal -- pull <slug|YYYY-MM-DD>   초안을 devlog/journal/<slug>.md로 받기 (--force로 덮어쓰기)
  npm run journal -- publish <파일>           참고 자료를 뺀 본문을 발행 (--dry-run으로 SQL만 확인)
  모든 명령은 기본으로 운영 D1(--remote)을 쓰고, --local이면 로컬 D1을 씁니다.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
