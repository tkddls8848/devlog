// Backfill only the requested published dates; never regenerate existing prose.
// Raw private messages remain in memory and never enter the plan, logs or AI.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateAlias, privateWorkSummary, publicationGroups } from "../../shared/devlog-privacy.mjs";
import { journalReference } from "../../shared/devlog-writing.mjs";
import { sqlString } from "./devlog-journal.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, ".wrangler", "private-backfill-2026-09-24-26");
const planFile = path.join(work, "plan.json");
const dates = ["2026-09-24", "2026-09-25", "2026-09-26"];
const dayOf = (at) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(at));
const excluded = /^merge\s|^revert\s|^(chore|ci)(\(deps\))?:|^bump\s|^(wip|test|tmp|temp|initial commit)$|\[skip ci\]/i;

function run(bin, args) {
  const result = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`${path.basename(bin)} failed; private response omitted`);
  return result.stdout;
}
function gh(endpoint) { return JSON.parse(run("gh", ["api", endpoint])); }
function d1(sql, file) {
  const output = run(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "devlog-news", "--remote", "--json", ...(file ? ["--file", file] : ["--command", sql])]);
  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  if (parsed.some((r) => !r.success)) throw Error("D1 query failed");
  return parsed.flatMap((r) => r.results || []);
}
function posts() { return d1(`SELECT * FROM devlog_posts WHERE status='published' AND post_date IN (${dates.map(sqlString).join(",")}) ORDER BY post_date`); }

async function prepare() {
  mkdirSync(work, { recursive: true });
  const originals = posts();
  if (originals.length !== dates.length || new Set(originals.map((p) => p.post_date)).size !== dates.length) throw Error("Expected one published post per date");
  const known = new Set(d1("SELECT sha FROM devlog_commits").map((c) => c.sha));
  const found = new Map();
  let checked = 0;
  for (let page = 1; page <= 10; page++) {
    const repos = gh(`/user/repos?visibility=private&affiliation=owner&per_page=100&page=${page}`);
    for (const repo of repos) {
      if (!repo.private || repo.owner?.login !== "tkddls8848" || repo.archived || repo.disabled) continue;
      const alias = await privateAlias(repo.id);
      checked++;
      for (let p = 1; p <= 10; p++) {
        const items = gh(`/repos/${repo.full_name}/commits?sha=${encodeURIComponent(repo.default_branch)}&since=2026-09-23T15:00:00Z&until=2026-09-26T15:00:00Z&per_page=100&page=${p}`);
        for (const item of items) {
          const date = dayOf(item.commit?.author?.date || item.commit?.committer?.date);
          const subject = String(item.commit?.message || "").split("\n")[0].trim();
          const author = item.commit?.author?.name || item.author?.login || "";
          if (!dates.includes(date) || !subject || excluded.test(subject) || item.parents?.length > 1 || /\[bot\]$|^dependabot|^github-actions/i.test(author) || known.has(item.sha)) continue;
          const message = privateWorkSummary(subject);
          found.set(item.sha, { repo: repo.full_name, sha: item.sha, day: date, visibility: "private", publicRepo: alias, publicSha: (await privateAlias(item.sha)).slice(-12), message, publicMessage: message });
        }
        if (items.length < 100) break;
        if (p === 10) throw Error("Commit page limit reached; no changes applied");
      }
    }
    console.log(`Private repository checks: ${checked}; eligible commits: ${found.size}`);
    if (repos.length < 100) break;
    if (page === 10) throw Error("Repository page limit reached; no changes applied");
  }
  const updates = [];
  for (const original of originals) {
    const commits = [...found.values()].filter((c) => c.day === original.post_date);
    if (!commits.length) { console.log(`${original.post_date}: no missing private commits`); continue; }
    if (/^## 비공개 작업\s*$/m.test(original.body_markdown)) throw Error("Private work section already exists; inspect before extending");
    const groups = new Map();
    for (const c of commits) { if (!groups.has(c.repo)) groups.set(c.repo, []); groups.get(c.repo).push(c); }
    const safe = publicationGroups(groups);
    const paragraphs = [...safe].map(([alias, items]) => {
      const known = [...new Set(items.map((c) => c.message).filter((m) => !m.includes("분류하지 못했다")))];
      const labels = [...new Set(known.flatMap((m) => m.replace(/ 관련 작업을 했다\.$/, "").split(", ")))];
      return `### ${alias}\n\n${labels.length ? `${labels.join(", ")} 관련 작업을 했다.` : "비공개 작업을 진행했다. 프로젝트를 식별할 수 있는 세부 내용은 생략했다."}`;
    });
    const addition = `\n\n## 비공개 작업\n\n${paragraphs.join("\n\n")}`;
    const reference = journalReference({ day: original.post_date, groups: safe, notes: "비공개 작업은 기술 유형만 요약했습니다.", collectedAt: new Date().toISOString() });
    const update = { original, commits, body: original.body_markdown + addition, reference: original.reference_markdown + "\n\n" + reference };
    updates.push(update);
    writeFileSync(path.join(work, `${original.post_date}-addition.md`), addition);
    console.log(`${original.post_date}: ${commits.length} commits / ${safe.size} aliases; addition ${addition.length} chars`);
  }
  writeFileSync(planFile, JSON.stringify({ preparedAt: new Date().toISOString(), updates }, null, 2));
  console.log("Prepared plan and original-post backup in ignored .wrangler directory; no remote changes yet");
}

function apply() {
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const current = posts();
  for (const u of plan.updates) {
    const live = current.find((p) => p.slug === u.original.slug);
    if (!live || live.body_markdown !== u.original.body_markdown || live.reference_markdown !== u.original.reference_markdown || live.updated_at !== u.original.updated_at) throw Error("Post changed since preparation; regenerate plan");
  }
  const sql = [];
  for (const u of plan.updates) {
    const slug = sqlString(u.original.slug);
    sql.push(`UPDATE devlog_posts SET body_markdown=body_markdown || ${sqlString(u.body.slice(u.original.body_markdown.length))}, reference_markdown=reference_markdown || ${sqlString(u.reference.slice(u.original.reference_markdown.length))}, updated_at=${sqlString(new Date().toISOString())} WHERE slug=${slug} AND body_markdown=${sqlString(u.original.body_markdown)} AND length(reference_markdown)=${[...u.original.reference_markdown].length} AND updated_at IS ${u.original.updated_at == null ? "NULL" : sqlString(u.original.updated_at)};`);
    for (const c of u.commits) sql.push(`INSERT INTO devlog_commits(sha,post_slug,repo,message,position,visibility,public_repo) SELECT ${sqlString(c.sha)},${slug},${sqlString(c.repo)},${sqlString(c.message)},COALESCE((SELECT MAX(position)+1 FROM devlog_commits WHERE post_slug=${slug}),0),'private',${sqlString(c.publicRepo)} WHERE EXISTS(SELECT 1 FROM devlog_posts WHERE slug=${slug} AND body_markdown=${sqlString(u.body)}) AND NOT EXISTS(SELECT 1 FROM devlog_commits WHERE sha=${sqlString(c.sha)});`);
  }
  if (!sql.length) return console.log("No updates needed");
  const file = path.join(work, "apply.sql");
  writeFileSync(file, sql.join("\n"));
  d1(null, file);
  for (const u of plan.updates) {
    const [saved] = d1(`SELECT body_markdown,reference_markdown,status,title,summary FROM devlog_posts WHERE slug=${sqlString(u.original.slug)}`);
    if (saved.body_markdown !== u.body || saved.reference_markdown !== u.reference || saved.status !== u.original.status || saved.title !== u.original.title || saved.summary !== u.original.summary) throw Error("Post verification failed");
    const [{ count }] = d1(`SELECT COUNT(*) AS count FROM devlog_commits WHERE post_slug=${sqlString(u.original.slug)} AND visibility='private' AND sha IN (${u.commits.map((c) => sqlString(c.sha)).join(",")})`);
    if (count !== u.commits.length) throw Error("Commit verification failed");
    console.log(`${u.original.post_date}: published post updated; ${count} private commits verified`);
  }
}

try { if (process.argv.includes("--apply")) apply(); else await prepare(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
