// 장면마다 내레이션 음성(voice-<장면 id>.mp3)을 만든다. 이미 있는 파일은 건너뛴다(--force로 다시 만든다).
// 목소리: ELEVENLABS_API_KEY와 ELEVENLABS_VOICE_ID가 있으면 ElevenLabs, 없으면 무료 edge-tts(ko-KR).
// 영어 약어는 pronunciation.json의 읽는 법으로 바꿔 보낸다. 자막은 원래 표기를 그대로 쓴다.
// 사용: node tools/voice.mjs out/<slug> [--force] [--provider=edge|elevenlabs]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, sceneOrder, speechText } from "./lib.mjs";

const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv() {
  const file = path.join(VIDEO_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (!(key in process.env)) process.env[key] = value;
}

export const lexicon = () => JSON.parse(readFileSync(path.join(VIDEO_ROOT, "pronunciation.json"), "utf8")).terms || [];

export function pickProvider(env = process.env, requested) {
  if (requested) return requested;
  return env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID ? "elevenlabs" : "edge";
}

async function elevenlabs(text, file, env = process.env) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      language_code: "ko",
      // Steady, plain delivery; high style exaggerates English words.
      voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
    }),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 300)}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

function edge(text, file, env = process.env) {
  const python = env.PYTHON || "python";
  const result = spawnSync(python, ["-m", "edge_tts", "--voice", env.EDGE_TTS_VOICE || "ko-KR-InJoonNeural", "--rate", env.EDGE_TTS_RATE || "+0%", "--text", text, "--write-media", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`edge-tts 실패 (pip install edge-tts)\n${result.stderr || result.stdout}`);
}

export async function makeVoices(dir, { force = false, provider } = {}) {
  const episode = JSON.parse(readFileSync(path.join(dir, "episode.json"), "utf8"));
  const assets = path.join(dir, "assets");
  const terms = lexicon();
  const chosen = pickProvider(process.env, provider);
  const made = [];
  for (const scene of sceneOrder(episode)) {
    const file = path.join(assets, `voice-${scene.id}.mp3`);
    if (!force && existsSync(file)) continue;
    if (!scene.narration) throw new Error(`${scene.id}: narration이 비었습니다.`);
    const text = speechText(scene.narration, terms);
    if (chosen === "elevenlabs") await elevenlabs(text, file);
    else edge(text, file);
    made.push(scene.id);
  }
  return { provider: chosen, made };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const argv = process.argv.slice(2);
  const [dir] = argv.filter((arg) => !arg.startsWith("--"));
  const provider = argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1];
  if (!dir) { console.error("사용법: node tools/voice.mjs out/<slug> [--force] [--provider=edge|elevenlabs]"); process.exit(1); }
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(path.resolve(dir), "assets"), { recursive: true });
  makeVoices(path.resolve(dir), { force: argv.includes("--force"), provider })
    .then(({ provider: used, made }) => console.log(`${used}: 음성 ${made.length}개 생성${made.length ? ` (${made.join(", ")})` : ", 모두 이미 있음"}`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
