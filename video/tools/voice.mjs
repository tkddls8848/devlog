// 장면마다 내레이션 음성(voice-<장면 id>.mp3)을 만든다. 이미 있는 파일은 건너뛴다(--force로 다시 만든다).
// 목소리: TTS_PROVIDER로 지정. 미지정이면 Gemini 키 → ElevenLabs → edge-tts(ko-KR).
// 영어 약어는 pronunciation.json의 읽는 법으로 바꿔 보낸다. 자막은 원래 표기를 그대로 쓴다.
// 사용: node tools/voice.mjs out/<slug> [--force] [--provider=gemini|edge|elevenlabs]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneOrder, speechText } from "./lib.mjs";
import { loadEnv } from "../../shared/env.mjs";
export { loadEnv } from "../../shared/env.mjs";

const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");


export const lexicon = () => JSON.parse(readFileSync(path.join(VIDEO_ROOT, "pronunciation.json"), "utf8")).terms || [];

export function pickProvider(env = process.env, requested) {
  const chosen = requested || env.TTS_PROVIDER || (env.GEMINI_API_KEY ? "gemini" : env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID ? "elevenlabs" : "edge");
  if (!["gemini", "elevenlabs", "edge"].includes(chosen)) throw new Error(`지원하지 않는 TTS provider: ${chosen}`);
  return chosen;
}

export const GEMINI_STYLE = "한국어로, 5년차 개발자가 동료에게 하루의 시행착오를 회고하듯 자연스럽게 말한다. 차분하고 친근한 대화체, 적당한 속도, 문장 사이 짧은 쉼. 과장된 광고 톤은 피한다.";

export async function geminiAudio(text, env = process.env, request = fetch) {
  if (!env.GEMINI_API_KEY) throw new Error("저장소 최상위 .env에 GEMINI_API_KEY를 설정하세요.");
  const model = env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text, speech_metadata: { style: env.GEMINI_TTS_STYLE || GEMINI_STYLE } }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: env.GEMINI_TTS_VOICE || "Charon" } } },
    }),
  });
  // Do not echo the API response: it can include submitted narration or credentials.
  if (!response.ok) throw new Error(`Gemini TTS HTTP ${response.status}: 키, 모델 접근 권한, 할당량을 확인하세요.`);
  const result = await response.json();
  const candidate = result.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new Error("Gemini TTS가 음성을 완성하지 못했습니다.");
  const parts = candidate?.content?.parts?.filter((part) => part.inlineData?.data) || [];
  if (parts.length !== 1) throw new Error("Gemini TTS 응답에 단일 WAV 음성이 없습니다.");
  const wav = Buffer.from(parts[0].inlineData.data, "base64");
  if (wav.length <= 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Gemini TTS 응답이 유효한 WAV 형식이 아닙니다.");
  }
  return wav;
}

async function gemini(text, file) {
  const wav = await geminiAudio(text);
  const result = spawnSync("ffmpeg", ["-v", "error", "-f", "wav", "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"], { input: wav, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout?.length) throw new Error("Gemini WAV → MP3 변환 실패: ffmpeg 설치와 오디오 형식을 확인하세요.");
  writeFileSync(file.replace(/\.mp3$/, ".wav"), wav);
  writeFileSync(file, result.stdout);
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
  mkdirSync(assets, { recursive: true });
  const terms = lexicon();
  const chosen = pickProvider(process.env, provider);
  const made = [];
  for (const scene of sceneOrder(episode)) {
    const file = path.join(assets, `voice-${scene.id}.mp3`);
    if (!force && existsSync(file)) continue;
    if (!scene.narration) throw new Error(`${scene.id}: narration이 비었습니다.`);
    const text = speechText(scene.narration, terms);
    if (chosen === "gemini") await gemini(text, file);
    else if (chosen === "elevenlabs") await elevenlabs(text, file);
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
  if (!dir) { console.error("사용법: node tools/voice.mjs out/<slug> [--force] [--provider=gemini|edge|elevenlabs]"); process.exit(1); }
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(path.resolve(dir), "assets"), { recursive: true });
  makeVoices(path.resolve(dir), { force: argv.includes("--force"), provider })
    .then(({ provider: used, made }) => console.log(`${used}: 음성 ${made.length}개 생성${made.length ? ` (${made.join(", ")})` : ", 모두 이미 있음"}`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
