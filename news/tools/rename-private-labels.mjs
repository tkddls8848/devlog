import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { privateProjectLabel, privateDisplayName } from "../../shared/devlog-privacy.mjs";
import { sqlString } from "./devlog-journal.mjs";

function query(sql, file) {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "devlog-news", "--remote", "--json", ...(file ? ["--file", file] : ["--command", sql])], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status) throw Error("D1 label update failed");
  const response = JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  if (response.some((r) => !r.success)) throw Error("D1 returned an error");
  return response.flatMap((r) => r.results || []);
}
const aliases = query("SELECT alias_key,ordinal FROM devlog_private_aliases ORDER BY ordinal");
const statements = [];
for (const { alias_key, ordinal } of aliases) {
  const internal = privateProjectLabel(ordinal);
  const display = privateDisplayName(internal);
  const key = sqlString(alias_key);
  statements.push(`UPDATE devlog_posts SET
    body_markdown=replace(body_markdown,${key},${sqlString(display)}),
    title=replace(title,${key},${sqlString(display)}),
    summary=replace(summary,${key},${sqlString(display)}),
    reference_markdown=replace(reference_markdown,${key},${sqlString(internal)}),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE instr(body_markdown,${key})>0 OR instr(reference_markdown,${key})>0 OR instr(title,${key})>0 OR instr(summary,${key})>0;`);
  statements.push(`UPDATE devlog_commits SET public_repo=${sqlString(internal)} WHERE visibility='private' AND public_repo=${key};`);
  console.log(display);
}
if (statements.length) {
  mkdirSync(".wrangler/private-labels", { recursive: true });
  const file = ".wrangler/private-labels/update.sql";
  writeFileSync(file, statements.join("\n"));
  if (process.argv.includes("--apply")) {
    query(null, file);
    const [row] = query("SELECT COUNT(*) AS remaining FROM devlog_posts WHERE body_markdown LIKE '%비공개-작업-%' OR title LIKE '%비공개-작업-%' OR summary LIKE '%비공개-작업-%'");
    if (row.remaining) throw Error("Old public labels remain");
    console.log("Published labels updated and verified");
  } else console.log("Prepared; use --apply to update stored labels");
}
