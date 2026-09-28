// 생성형 영상 클립 없이 회차 한 편을 만든다. 크레딧이 드는 Artlist 경로(assemble.mjs)를 대신한다.
//   1. 장면마다 음성을 만든다(voice.mjs: ElevenLabs, 키가 없으면 edge-tts). 있는 파일은 다시 쓰지 않는다.
//   2. 음성 길이로 장면 길이를 정해 화면과 자막을 그린다. 기본은 이 저장소의 자체 렌더러
//      (tools/engine: 글꼴 해석, 래스터화, 합성)이고, VIDEO_ENGINE=blender면 Blender가 그린다.
//   3. ffmpeg가 프레임, 장면별 음성, 배경 음악(assets/music-1.mp3 또는 music.mp3, 없으면 생략)을 합친다.
// 사용: node tools/render.mjs out/<slug> [--frames=N 앞부분만 미리 보기] [--resume 끊긴 렌더 이어 하기]
// 환경 변수: VIDEO_ENGINE(native|blender), BLENDER(실행 파일), VIDEO_SIZE(기본 1280x720), VIDEO_FPS(기본 24), VIDEO_FONT, VIDEO_FONT_BOLD
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeSeconds } from "./assemble.mjs";
import { rawVideoInput, renderToFfmpeg } from "./engine/index.mjs";
import { buildChapters, buildMetadata, buildSpec, sceneOrder, validateEpisode } from "./lib.mjs";
import { loadEnv, makeVoices } from "./voice.mjs";

const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A short pause after each line so scenes do not run into each other.
export const TAIL_SECONDS = 0.4;

const firstExisting = (...files) => files.find((file) => file && existsSync(file));

export function blenderPath(env = process.env) {
  return env.BLENDER || firstExisting("C:/Program Files/Blender Foundation/Blender 5.2/blender.exe", "/Applications/Blender.app/Contents/MacOS/Blender") || "blender";
}

export function fonts(env = process.env) {
  const regular = env.VIDEO_FONT || firstExisting("C:/Windows/Fonts/NanumGothic.ttf", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "C:/Windows/Fonts/malgun.ttf");
  const bold = env.VIDEO_FONT_BOLD || firstExisting("C:/Windows/Fonts/NanumGothicBold.ttf", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf", "C:/Windows/Fonts/malgunbd.ttf") || regular;
  if (!regular) throw new Error("한글 글꼴을 찾지 못했습니다. VIDEO_FONT에 NanumGothic.ttf 경로를 지정하세요.");
  return { font: regular.replace(/\\/g, "/"), fontBold: bold.replace(/\\/g, "/") };
}

// VIDEO_ENGINE wins, then the episode's own style.engine. The native renderer draws the
// minimal layout; the older card layout always needs Blender.
export function pickEngine(spec, env = process.env, style = {}) {
  const chosen = [env.VIDEO_ENGINE, style.engine].find((value) => value === "blender" || value === "native");
  if (chosen) return chosen;
  return (spec.layout || "minimal") === "minimal" ? "native" : "blender";
}

// The Artlist fields (clip prompts, music descriptions) are not needed here.
export const renderProblems = (episode) => validateEpisode(episode).filter((problem) => !/prompt가 비었|thread\.music/.test(problem));

// Every scene's voice padded to the scene length, in order, with optional music underneath.
// `video` replaces the PNG frame folder input (the native renderer streams raw frames).
export function muxArgs({ frames, fps, video, voices, music, musicVolume = "0.12", seconds, output }) {
  const inputs = video ? [...video] : ["-framerate", String(fps), "-i", path.join(frames, "f%04d.png")];
  const filters = [];
  voices.forEach((voice, i) => {
    inputs.push("-i", voice.file);
    filters.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${voice.seconds.toFixed(3)}[v${i}]`);
  });
  filters.push(`${voices.map((_, i) => `[v${i}]`).join("")}concat=n=${voices.length}:v=0:a=1[voice]`);
  let audio = "[voice]";
  if (music) {
    inputs.push("-stream_loop", "-1", "-i", music);
    filters.push(`[${voices.length + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${musicVolume}[m]`, "[voice][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]");
    audio = "[mix]";
  }
  return [...inputs, "-filter_complex", filters.join(";"), "-map", "0:v", "-map", audio,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
    "-t", seconds.toFixed(3), "-movflags", "+faststart", "-y", output];
}

function run(bin, args, label) {
  const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} 실패\n${(result.stderr || result.stdout || "").slice(-3000)}`);
  return result.stdout;
}

export async function render(dir, { previewFrames = 0, resume = false, log = console.log } = {}) {
  dir = path.resolve(dir);
  const episode = JSON.parse(readFileSync(path.join(dir, "episode.json"), "utf8"));
  const problems = renderProblems(episode);
  if (problems.length) throw new Error(`episode.json에 빈칸이 있습니다.\n- ${problems.join("\n- ")}`);
  const assets = path.join(dir, "assets");
  const work = path.join(dir, "work");
  mkdirSync(assets, { recursive: true });
  mkdirSync(work, { recursive: true });

  const { provider, made } = await makeVoices(dir);
  if (made.length) log(`음성 ${made.length}개를 ${provider}로 만들었습니다.`);

  const seconds = new Map();
  const voices = [];
  for (const scene of sceneOrder(episode)) {
    const file = path.join(assets, `voice-${scene.id}.mp3`);
    const length = probeSeconds(file) + TAIL_SECONDS;
    seconds.set(scene.id, length);
    voices.push({ file, seconds: length });
  }
  const [width, height] = (/^\d+x\d+$/.test(process.env.VIDEO_SIZE || "") ? process.env.VIDEO_SIZE : "1280x720").split("x").map(Number);
  const fps = Number(process.env.VIDEO_FPS) || 24;
  const spec = buildSpec(episode, seconds, { width, height, fps, ...fonts() });
  const specFile = path.join(work, "spec.json");
  writeFileSync(specFile, `${JSON.stringify(spec, null, 1)}\n`, "utf8");

  const total = previewFrames ? Math.min(previewFrames, spec.frames) : spec.frames;
  const music = firstExisting(path.join(assets, "music-1.mp3"), path.join(assets, "music.mp3")) || null;
  const output = path.join(dir, previewFrames ? "preview.mp4" : "final.mp4");
  const mux = { fps, voices, music, musicVolume: process.env.VIDEO_MUSIC_VOLUME, seconds: total / fps, output };
  const engine = pickEngine(spec, process.env, episode.style);
  log(`${engine === "native" ? "자체 렌더러" : "Blender"}: ${total}프레임 (${(total / fps).toFixed(1)}초, ${width}x${height} ${fps}fps)`);
  const started = Date.now();
  if (engine === "native") {
    // Frames go straight into ffmpeg's stdin; nothing is written to disk but the result.
    await renderToFfmpeg(spec, { total, args: muxArgs({ ...mux, video: rawVideoInput(spec) }) });
  } else {
    const frames = path.join(work, "frames");
    if (!resume) rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    run(blenderPath(), ["-b", "--factory-startup", "--python-exit-code", "1", "--python", path.join(VIDEO_ROOT, "blender", "episode.py"), "--", specFile, frames, String(total), ...(resume ? ["--resume"] : [])], "Blender 렌더링");
    run("ffmpeg", muxArgs({ ...mux, frames }), "ffmpeg 합치기");
  }
  log(`렌더링 ${((Date.now() - started) / 1000).toFixed(0)}초`);

  const { chapters, total: length } = buildChapters(episode, seconds);
  const metadata = buildMetadata(episode, chapters, { file: output, seconds: previewFrames ? total / fps : length });
  if (!previewFrames) {
    writeFileSync(path.join(dir, "chapters.json"), `${JSON.stringify(chapters, null, 2)}\n`, "utf8");
    writeFileSync(path.join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const argv = process.argv.slice(2);
  const [dir] = argv.filter((arg) => !arg.startsWith("--"));
  const previewFrames = Number(argv.find((arg) => arg.startsWith("--frames="))?.split("=")[1]) || 0;
  if (!dir) { console.error("사용법: node tools/render.mjs out/<slug> [--frames=N] [--resume]"); process.exit(1); }
  render(path.resolve(dir), { previewFrames, resume: argv.includes("--resume") })
    .then((metadata) => console.log(`${metadata.file} (${metadata.seconds}초)\n제목: ${metadata.title}\n챕터:\n${metadata.chapters.map((c) => `  ${Math.round(c.start)}s ${c.title}`).join("\n")}`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
