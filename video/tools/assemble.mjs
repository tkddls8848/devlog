// out/<slug>/assets/의 클립·음성·음악을 ffmpeg로 한 편의 영상으로 조립하고 게시 정보를 만든다.
// 자산 이름 규칙: clip-<장면 id>.mp4, voice-<장면 id>.mp3, music-<세션 번호>.mp3 (없으면 music.mp3).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allocateCues, buildDescription, buildSrt, buildTags, buildTitle, playlistTitle, sceneOrder, shortRepo, validateEpisode } from "./lib.mjs";

const FONT = process.env.VIDEO_FONT || "/usr/share/fonts/truetype/nanum/NanumGothic.ttf";
const SIZE = "1920x1080";
const MUSIC_VOLUME = process.env.VIDEO_MUSIC_VOLUME || "0.12";

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${bin} 실패\n${result.stderr || result.stdout}`);
  return result.stdout;
}

export function probeSeconds(file) {
  const out = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`${file}의 길이를 읽지 못했습니다.`);
  return seconds;
}

// drawtext는 콜론과 따옴표를 특별하게 다루므로 텍스트는 파일로 넘긴다.
const escapeFilterPath = (file) => file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

// 장면 하나를 보이스오버 길이의 mp4 조각으로 만든다. 클립은 짧으면 반복하고 길면 자른다.
export function segmentArgs({ scene, seconds, clip, voice, textFile, output }) {
  const encode = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-t", String(seconds), "-y", output];
  if (scene.kind === "clip") {
    return ["-stream_loop", "-1", "-i", clip, "-i", voice,
      "-filter_complex", `[0:v]scale=${SIZE.replace("x", ":")}:force_original_aspect_ratio=increase,crop=${SIZE.replace("x", ":")},setsar=1,fps=30[v]`,
      "-map", "[v]", "-map", "1:a", ...encode];
  }
  const size = scene.kind === "diff" ? 30 : 56;
  const draw = `drawtext=fontfile='${escapeFilterPath(FONT)}':textfile='${escapeFilterPath(textFile)}':fontcolor=white:fontsize=${size}:line_spacing=10:x=${scene.kind === "diff" ? "120" : "(w-text_w)/2"}:y=${scene.kind === "diff" ? "120" : "(h-text_h)/2"}`;
  return ["-f", "lavfi", "-i", `color=c=0x0f172a:s=${SIZE}:r=30`, "-i", voice, "-vf", draw, "-map", "0:v", "-map", "1:a", ...encode];
}

export function concatArgs({ list, srt, music, output }) {
  const inputs = ["-f", "concat", "-safe", "0", "-i", list];
  const video = `[0:v]subtitles='${escapeFilterPath(srt)}':force_style='FontName=NanumGothic,FontSize=20,Outline=1,MarginV=40'[v]`;
  if (!music) return [...inputs, "-filter_complex", video, "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", "-y", output];
  return [...inputs, "-stream_loop", "-1", "-i", music,
    "-filter_complex", `${video};[1:a]volume=${MUSIC_VOLUME}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", "-y", output];
}

export function assemble(dir, { dryRun = false } = {}) {
  const episode = JSON.parse(readFileSync(path.join(dir, "episode.json"), "utf8"));
  const problems = validateEpisode(episode);
  if (problems.length) throw new Error(`episode.json에 빈칸이 있습니다.\n- ${problems.join("\n- ")}`);
  const assets = path.join(dir, "assets");
  const work = path.join(dir, "work");
  mkdirSync(work, { recursive: true });

  const sessionOf = new Map();
  episode.sessions.forEach((session, index) => session.scenes.forEach((scene) => sessionOf.set(scene.id, { session, index })));
  const missing = [];
  for (const scene of sceneOrder(episode)) {
    if (!existsSync(path.join(assets, `voice-${scene.id}.mp3`))) missing.push(`voice-${scene.id}.mp3`);
    if (scene.kind === "clip" && !existsSync(path.join(assets, `clip-${scene.id}.mp4`))) missing.push(`clip-${scene.id}.mp4`);
  }
  if (missing.length) throw new Error(`assets/에 없는 파일:\n- ${missing.join("\n- ")}`);

  let at = 0;
  const cues = [];
  const chapters = [];
  const segments = [];
  for (const scene of sceneOrder(episode)) {
    const voice = path.join(assets, `voice-${scene.id}.mp3`);
    const seconds = dryRun ? scene.seconds : probeSeconds(voice) + 0.4;
    const output = path.join(work, `seg-${scene.id}.mp4`);
    const textFile = path.join(work, `text-${scene.id}.txt`);
    if (scene.kind !== "clip") writeFileSync(textFile, scene.text || "", "utf8");
    const args = segmentArgs({ scene, seconds, clip: path.join(assets, `clip-${scene.id}.mp4`), voice, textFile, output });
    if (!dryRun) run("ffmpeg", args);
    const owner = sessionOf.get(scene.id);
    if (scene.id === "opening") chapters.push({ title: "오프닝", start: 0 });
    else if (scene.kind === "title" && owner) chapters.push({ title: `${shortRepo(owner.session.repo)} · ${owner.session.thread.name} ${owner.session.thread.episode}화`, start: at, repo: owner.session.repo });
    else if (scene.id === "ending") chapters.push({ title: "다음 회차", start: at });
    cues.push(...allocateCues(scene.narration, at, seconds));
    segments.push(output);
    at += seconds;
  }
  const srt = path.join(work, "subtitles.srt");
  writeFileSync(srt, buildSrt(cues), "utf8");
  const list = path.join(work, "concat.txt");
  writeFileSync(list, segments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n", "utf8");
  const music = [path.join(assets, "music-1.mp3"), path.join(assets, "music.mp3")].find((file) => existsSync(file)) || null;
  const output = path.join(dir, "final.mp4");
  if (!dryRun) run("ffmpeg", concatArgs({ list, srt, music, output }));

  const metadata = {
    title: buildTitle(episode), description: buildDescription(episode, chapters), tags: buildTags(episode),
    playlists: [...new Set(episode.sessions.map((session) => playlistTitle(session.repo)))],
    categoryId: "28", defaultLanguage: "ko", privacy: "private", file: output, seconds: Math.round(at), chapters,
  };
  writeFileSync(path.join(dir, "chapters.json"), `${JSON.stringify(chapters, null, 2)}\n`, "utf8");
  writeFileSync(path.join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const [dir] = argv.filter((arg) => !arg.startsWith("--"));
  try {
    if (!dir) throw new Error("사용법: npm run assemble -- out/<slug> [--dry-run]");
    const metadata = assemble(path.resolve(dir), { dryRun: argv.includes("--dry-run") });
    console.log(`${metadata.file} (${metadata.seconds}초)\n제목: ${metadata.title}\n챕터:\n${metadata.chapters.map((c) => `  ${c.start}s ${c.title}`).join("\n")}`);
  } catch (error) { console.error(error.message); process.exit(1); }
}
