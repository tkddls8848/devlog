// 발행한 개발 일지(pull 받은 Markdown)를 회차 계획(episode.json)으로 바꾼다.
// 내레이션, Seedance 프롬프트, 스레드 이름처럼 편집 판단이 필요한 칸은 비워 두며,
// 스킬(.claude/skills/devlog-video)이 그 칸을 채운 뒤 assemble.mjs로 넘어간다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJournal, planEpisode, sceneOrder, shortRepo } from "./lib.mjs";

export const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SERIES_FILE = path.join(VIDEO_ROOT, "series.json");

export function scriptMarkdown(episode) {
  const lines = [`# ${episode.title}`, "", `날짜 ${episode.date} · 글 ${episode.postUrl}`, "", "## 오프닝", "", episode.opening.narration || "_(채울 것)_"];
  for (const session of episode.sessions) {
    const { thread } = session;
    lines.push("", `## ${shortRepo(session.repo)} · ${thread.name || "_(스레드 이름)_"} ${thread.episode}화${thread.isNew ? " (새 스레드)" : ""}`, "");
    if (thread.previousSummary) lines.push(`지난 이야기: ${thread.previousSummary}`, "");
    for (const item of session.scenes) lines.push(`### ${item.id} (${item.kind})`, "", item.narration || "_(채울 것)_", "");
  }
  lines.push("## 엔딩", "", episode.ending.narration || "_(채울 것)_", "");
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const [file] = argv.filter((arg) => !arg.startsWith("--"));
  const force = argv.includes("--force");
  if (!file) throw new Error("사용법: npm run plan -- <devlog/journal/<slug>.md> [--force]");
  const journal = parseJournal(readFileSync(path.resolve(file), "utf8"));
  if (journal.status !== "published") throw new Error(`${journal.slug}은 아직 발행되지 않았습니다(status: ${journal.status || "없음"}). 발행한 글만 영상으로 만듭니다.`);
  const series = JSON.parse(readFileSync(SERIES_FILE, "utf8"));
  const alreadyDone = Object.values(series.threads || {}).flat().some((thread) => thread.episodes.some((episode) => episode.slug === journal.slug));
  if (alreadyDone && !force) throw new Error(`${journal.slug}은 이미 영상으로 만든 글입니다. 다시 만들려면 --force를 붙이세요.`);
  const episode = planEpisode(journal, series);
  const dir = path.join(VIDEO_ROOT, "out", journal.slug);
  const target = path.join(dir, "episode.json");
  if (existsSync(target) && !force) throw new Error(`${target}이 이미 있습니다. 채운 내용을 잃지 않도록 멈춥니다. 다시 만들려면 --force를 붙이세요.`);
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(target, `${JSON.stringify(episode, null, 2)}\n`, "utf8");
  writeFileSync(path.join(dir, "script.md"), scriptMarkdown(episode), "utf8");
  console.log(`${target}`);
  console.log(`저장소 세션 ${episode.sessions.length}개, 장면 ${sceneOrder(episode).length}개, 클립 생성 ${episode.estimate.clips}회, 보이스오버 ${episode.estimate.voiceovers}회, 예상 길이 약 ${episode.estimate.seconds}초`);
  for (const session of episode.sessions) {
    const { thread } = session;
    console.log(`  ${session.repo}: ${thread.isNew ? "새 스레드" : `${thread.name} ${thread.episode}화로 이어짐`} · 커밋 ${session.commits.length}건 · 본문 소제목 ${session.sections.length}개`);
  }
  if (episode.unassigned.length) console.log(`  배정되지 않은 소제목 ${episode.unassigned.length}개: ${episode.unassigned.map((s) => s.heading || "(도입부)").join(", ")}`);
  return episode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
