// stock_chatbot/shorts의 제작 방식으로 회차 한 편을 만든다.
//   1. 원고 전체를 edge-tts로 한 번에 합성하고 단어 시각을 받아 쉼을 자리마다 조정한다(speech.py).
//   2. 단어 시각으로 자막 구절과 장면 전환 시각을 정한다(timeline.mjs).
//   3. 장면마다 투명 카드 PNG를 그린다(engine/cards.mjs). 제목만 먼저 세우고 설명을 얹는다.
//   4. Blender VSE가 배경(영상·사진, 장면 강조색 색조) + 카드 + 외곽선 자막 + 음성을 합성·인코딩한다.
// 배경: episode.json 장면의 background(회차 폴더 기준 경로) 또는 assets/bg-<장면 id>.mp4|png|jpg.
//       없으면 Workers AI로 그린다(backgrounds.mjs). --no-generate면 짙은 단색.
//       사진 배경은 천천히 밀고 흐르며, 장면 사이 배경은 0.5초 겹쳐 서서히 넘어간다.
// 사용: node tools/compose.mjs out/<slug> [--seconds=N 앞부분만 preview.mp4] [--scene=<장면 id> 그 장면만 preview-<id>.mp4]
//       [--force-voice] [--no-generate]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeSeconds } from "./assemble.mjs";
import { makeBackgrounds } from "./backgrounds.mjs";
import { loadFont } from "./engine/font.mjs";
import { ACCENT_ORDER, COLORS, RgbaCanvas, drawCard } from "./engine/cards.mjs";
import { buildMetadata, sceneOrder, shortRepo } from "./lib.mjs";
import { blenderPath, fonts as findFonts, renderProblems } from "./render.mjs";
import { balancedLines, buildPhrases, sceneSpans, speechMap } from "./timeline.mjs";
import { EDGE_RATE, lexicon, loadEnv } from "./voice.mjs";

const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
export const TAIL = 0.6; // after the last word
export const PACING = "2026-09-28b";
export const CROSSFADE = 0.5; // seconds a new background dissolves over the previous one
export const CAPTION = { size: 54, bottom: 64, width: 1500 };
const TONE_STRENGTH = 0.5;
const BRIGHTNESS = [0.02, -0.03, 0.01, 0];

// What each scene shows: accent, kicker, title, note and points, all from the episode text.
export function sceneCards(episode) {
  const owner = new Map();
  episode.sessions.forEach((session, index) => session.scenes.forEach((scene) => owner.set(scene.id, { session, index })));
  const scenes = sceneOrder(episode);
  const date = String(episode.date || "").replaceAll("-", ".");
  return scenes.map((scene, i) => {
    const found = owner.get(scene.id);
    const session = found?.session;
    const accent = found ? ACCENT_ORDER[found.index % ACCENT_ORDER.length] : "gold";
    const repo = session ? shortRepo(session.repo) : "";
    const kicker = scene.label ? (repo && !scene.label.includes(repo) ? `${scene.label} · ${repo}` : scene.label) : repo || (scene.id === "ending" ? "마무리" : "오늘의 개발 일지");
    const title = scene.text || (session ? (scene.kind === "title" ? repo : session.subtitle || repo) : episode.title);
    const note = scene.note || (scene.id === "opening" ? scene.subtitle || "" : scene.kind === "title" && session ? session.subtitle || "" : "");
    return { id: scene.id, accent, kicker, title, note, points: Array.isArray(scene.points) ? scene.points : [], date, index: i + 1, total: scenes.length };
  });
}

// Title first, then the note: a still card held for 20 seconds looks frozen.
export function beats(seconds) {
  if (seconds < 2.8) return [{ beat: "card", hold: seconds }];
  const open = Math.min(2.2, seconds * 0.3);
  return [{ beat: "open", hold: open }, { beat: "card", hold: seconds - open }];
}

export function toneFor(accent, index) {
  const rgb = COLORS[accent] || COLORS.gold;
  return { multiply: rgb.map((c) => 1 - TONE_STRENGTH + (TONE_STRENGTH * c) / 255), brightness: BRIGHTNESS[index % BRIGHTNESS.length] };
}

export function findBackground(dir, scene) {
  const candidates = [scene.background && path.resolve(dir, scene.background), ...["mp4", "png", "jpg"].map((ext) => path.join(dir, "assets", `bg-${scene.id}.${ext}`))];
  const file = candidates.find((candidate) => candidate && existsSync(candidate));
  return file ? { path: file, kind: /\.mp4$/i.test(file) ? "movie" : "image" } : { path: null, kind: "color" };
}

function run(bin, args, label) {
  const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} 실패\n${(result.stderr || result.stdout || "").slice(-3000)}`);
  return result.stdout;
}

export async function compose(dir, { previewSeconds = 0, onlyScene = "", forceVoice = false, generate = true, log = console.log } = {}) {
  dir = path.resolve(dir);
  const episode = JSON.parse(readFileSync(path.join(dir, "episode.json"), "utf8"));
  const problems = renderProblems(episode);
  if (problems.length) throw new Error(`episode.json에 빈칸이 있습니다.\n- ${problems.join("\n- ")}`);
  const work = path.join(dir, "work");
  mkdirSync(work, { recursive: true });
  const scenes = sceneOrder(episode);
  // Backgrounds a scene does not have yet are drawn with Workers AI (no Artlist credits).
  if (generate) {
    const { made, skipped } = await makeBackgrounds(dir, { log });
    if (made.length) log(`배경 ${made.length}장을 Workers AI로 그렸습니다.`);
    if (skipped.length) log(`글자·사람이 계속 보여 단색 배경으로 둔 장면: ${skipped.join(", ")}`);
  }
  const terms = lexicon();
  const mapped = scenes.map((scene) => ({ narration: scene.narration, ...speechMap(scene.narration, terms) }));

  // 1. One synthesis for the whole script; reuse it while the script and voice settings stay the same.
  const voice = process.env.EDGE_TTS_VOICE || "ko-KR-InJoonNeural";
  const rate = process.env.EDGE_TTS_RATE || EDGE_RATE;
  const audio = path.join(work, "narration.mp3"), wordsFile = path.join(work, "words.json"), stamp = path.join(work, "narration.key");
  // Bump PACING when speech.py pause values change so cached narration is redone.
  const key = createHash("sha256").update(JSON.stringify([mapped.map((m) => m.speech), voice, rate, PACING])).digest("hex");
  if (forceVoice || !existsSync(audio) || !existsSync(wordsFile) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== key) {
    const request = path.join(work, "speech-request.json");
    writeFileSync(request, JSON.stringify({ narrations: mapped.map((m) => m.speech), audio, words: wordsFile, voice, rate, ffmpeg: "ffmpeg" }), "utf8");
    run(process.env.PYTHON || "python", [path.join(VIDEO_ROOT, "tools", "speech.py"), request], "edge-tts 합성");
    writeFileSync(stamp, key, "utf8");
    log(`음성: edge-tts ${voice} ${rate}, 한 번에 합성`);
  }
  const words = JSON.parse(readFileSync(wordsFile, "utf8"));
  const duration = probeSeconds(audio) + TAIL;

  // 2. Captions and scene spans from word timings.
  const phrases = buildPhrases(mapped, words, duration);
  const spans = sceneSpans(phrases, duration);

  // 3. Cards.
  const fontFiles = findFonts();
  const fonts = { regular: loadFont(fontFiles.font), bold: loadFont(fontFiles.fontBold) };
  const cards = [], backgrounds = [];
  sceneCards(episode).forEach((card, i) => {
    const { start, end } = spans[i];
    const bg = findBackground(dir, scenes[i]);
    backgrounds.push({ ...bg, start, duration: end - start, ...toneFor(card.accent, i) });
    let cursor = start;
    for (const { beat, hold } of beats(end - start)) {
      const file = path.join(work, `card-${String(i + 1).padStart(2, "0")}-${beat}.png`);
      const canvas = new RgbaCanvas(WIDTH, HEIGHT);
      drawCard(canvas, fonts, card, beat);
      writeFileSync(file, canvas.png());
      cards.push({ path: file, start: cursor, duration: hold });
      cursor += hold;
    }
  });

  // 4. Captions as Blender text strips, wrapped evenly at spaces.
  const bold = fonts.bold;
  const measure = (text) => (bold.measure(text) * CAPTION.size) / bold.unitsPerEm;
  const subtitles = phrases.flat().map((p) => ({ start: p.start, end: p.end, text: balancedLines(p.text, measure, CAPTION.width).join("\n") }));
  writeFileSync(path.join(work, "phrases.json"), JSON.stringify(subtitles, null, 1), "utf8");

  const onlyIndex = onlyScene ? scenes.findIndex((scene) => scene.id === onlyScene) : -1;
  if (onlyScene && onlyIndex < 0) throw new Error(`장면 ${onlyScene}이 없습니다. 장면 id: ${scenes.map((s) => s.id).join(", ")}`);
  const partial = previewSeconds || onlyIndex >= 0;
  const output = path.join(dir, onlyIndex >= 0 ? `preview-${onlyScene}.mp4` : previewSeconds ? "preview.mp4" : "final.mp4");
  const manifest = path.join(work, "vse-manifest.json");
  writeFileSync(manifest, JSON.stringify({
    width: WIDTH, height: HEIGHT, fps: FPS, duration, audio, output, crossfade: CROSSFADE,
    max_frames: previewSeconds ? Math.round(previewSeconds * FPS) : 0,
    range: onlyIndex >= 0 ? [spans[onlyIndex].start, spans[onlyIndex].end] : null,
    backgrounds, cards, subtitles,
    // Blender text size is the em size; match the caption's visible height.
    caption: { font: fontFiles.fontBold, em_size: (CAPTION.size * bold.unitsPerEm) / (bold.ascender - bold.descender), bottom: CAPTION.bottom, color: COLORS.ink },
  }, null, 1), "utf8");
  log(`Blender VSE 합성: ${duration.toFixed(1)}초, 장면 ${scenes.length}개, 자막 ${subtitles.length}개`);
  const started = Date.now();
  run(blenderPath(), ["-b", "--factory-startup", "--python-exit-code", "1", "--python", path.join(VIDEO_ROOT, "blender", "vse.py"), "--", manifest], "Blender VSE 합성");
  if (!existsSync(output)) throw new Error(`Blender가 ${output}을 만들지 않았습니다.`);
  log(`합성 ${((Date.now() - started) / 1000).toFixed(0)}초`);

  // Chapters: opening, each session's first scene, ending.
  const owner = new Map();
  episode.sessions.forEach((session) => session.scenes.forEach((scene, n) => n === 0 && owner.set(scene.id, session)));
  const chapters = [];
  scenes.forEach((scene, i) => {
    const session = owner.get(scene.id);
    if (scene.id === "opening") chapters.push({ title: "오프닝", start: 0 });
    else if (session) chapters.push({ title: scene.label || `${shortRepo(session.repo)} · ${session.thread.name}`, start: Math.round(spans[i].start), repo: session.repo });
    else if (scene.id === "ending") chapters.push({ title: "마무리", start: Math.round(spans[i].start) });
  });
  const metadata = buildMetadata(episode, chapters, { file: output, seconds: onlyIndex >= 0 ? spans[onlyIndex].end - spans[onlyIndex].start : previewSeconds || duration });
  if (!partial) {
    writeFileSync(path.join(dir, "chapters.json"), `${JSON.stringify(chapters, null, 2)}\n`, "utf8");
    writeFileSync(path.join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const argv = process.argv.slice(2);
  const [dir] = argv.filter((arg) => !arg.startsWith("--"));
  const previewSeconds = Number(argv.find((arg) => arg.startsWith("--seconds="))?.split("=")[1]) || 0;
  const onlyScene = argv.find((arg) => arg.startsWith("--scene="))?.split("=")[1] || "";
  if (!dir) { console.error("사용법: node tools/compose.mjs out/<slug> [--seconds=N] [--force-voice]"); process.exit(1); }
  compose(dir, { previewSeconds, onlyScene, forceVoice: argv.includes("--force-voice"), generate: !argv.includes("--no-generate") })
    .then((m) => console.log(`${m.file} (${Math.round(m.seconds)}초)\n챕터:\n${m.chapters.map((c) => `  ${c.start}s ${c.title}`).join("\n")}`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
