// 장면마다 배경 이미지를 Cloudflare Workers AI로 그린다(Artlist 크레딧 없음, Workers AI 사용량만).
// stock_chatbot/shorts의 media.py와 같은 방식이다.
// - 그림: flux-2-klein-4b(VIDEO_IMAGE_MODEL로 변경), 1920x1088 가로. 왼쪽 절반은 제목이 앉도록 비워 달라고 요청한다.
// - 그림 모델은 "글자·사람 금지"를 가끔 무시한다. 비전 모델로 보고 걸리면 다시 그린다(최대 3번).
//   끝까지 걸리면 그 장면은 배경 없이(짙은 단색) 간다. 배경 때문에 제작을 멈추지 않는다.
// - 무엇을 그릴지: 장면의 visual(영문 한 문장)이 있으면 그대로, 없으면 원고로 gpt-oss-20b가 쓴다.
// 검사 모델: Llama 3.2 Vision(계정에서 라이선스 동의가 한 번 필요하다).
// 인증: CLOUDFLARE_API_TOKEN(Workers AI 권한)과 CLOUDFLARE_ACCOUNT_ID, 없으면 로컬 wrangler 로그인.
// 결과: assets/bg-<장면 id>.jpg, assets/backgrounds.json(프롬프트와 모델 기록). 있는 파일은 다시 그리지 않는다.
// 사용: node tools/backgrounds.mjs out/<slug> [--force]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneOrder } from "./lib.mjs";
import { loadEnv } from "./voice.mjs";

const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Price per 1920x1088 image (Workers AI pricing, 2026-09-28): klein-4b about 210-310 neurons,
// klein-9b about 1,560 (six of those nearly use up the 10,000 free daily neurons). 4b is the default;
// VIDEO_IMAGE_MODEL switches.
export const IMAGE_MODEL = process.env.VIDEO_IMAGE_MODEL || "@cf/black-forest-labs/flux-2-klein-4b";
// llava-1.5 (what stock_chatbot uses) answered 503 on every call on 2026-09-28; Llama 3.2 Vision
// answers in ~7 neurons a check. Its license was accepted on the account that day.
export const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
export const WRITER_MODEL = "@cf/openai/gpt-oss-20b";
export const ATTEMPTS = 3;

// 2026-09-28 compared on the 9/26 scenes: klein-9b was the sharpest; klein-4b a little softer at a
// fifth of the price; flux-1-schnell is square only and refused one prompt as NSFW.
export const STYLE = "Premium cinematic editorial 3D illustration, soft dusk lighting, charcoal navy #0c1116 with muted gold and slate blue accents, realistic materials, shallow depth of field. Place the main subject in the right third; the left side of the same scene falls off into natural deep shadow for titles added later, with no flat panel, border or split. No text, letters, numbers, labels, logos, screens with writing, watermark or people.";

export const CHECKS = [
  ["people", "Is there any person, human figure or human face in this image? Answer yes or no."],
  ["text", "Is there any written text, letters, numbers or words in this image? Answer yes or no."],
];

export const backgroundPrompt = (subject) => `${subject.trim()} ${STYLE}`;

// All scenes in one request so the model can keep them apart; asked one at a time it drew
// "a desk, a lamp and a steaming mug" for four of six scenes (2026-09-28).
export const subjectsPrompt = (episode, scenes) => `You pick background imagery for the scenes of a Korean developer video diary.
For EACH scene write ONE English sentence (max 35 words) describing a single symbolic, cinematic place
that shows the scene's meaning through a concrete visual metaphor (e.g. publishing = a parcel leaving
through an open door; sound and space = ripples of light spreading across a floor).
Rules:
- Every scene must use a different setting and different main objects. Never reuse a setting.
- Do not use desks, desk lamps, mugs, laptops, notebooks, potted plants or office rooms.
- Objects, places, light and weather only. No people, no text, no screens with writing, no logos or brand names.
Answer with a JSON array of strings, one per scene, in order, and nothing else.

Video title: ${episode.title || ""}
${scenes.map((scene, i) => `Scene ${i + 1}: title "${String(scene.text || "").replace(/\n/g, " ")}" · note "${scene.note || ""}" · narration "${scene.narration}"`).join("\n")}`;

export function parseSubjects(text, count) {
  const raw = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = raw.indexOf("["), end = raw.lastIndexOf("]");
  const list = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : [];
  if (!Array.isArray(list) || list.length !== count || !list.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`배경 묘사 ${count}개를 받지 못했습니다.`);
  }
  return list.map((item) => item.replace(/\s+/g, " ").trim());
}

// Workers AI over the REST API, with either an API token or the local wrangler login.
export function credentials(env = process.env) {
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) return { token: env.CLOUDFLARE_API_TOKEN, account: env.CLOUDFLARE_ACCOUNT_ID };
  const news = path.join(VIDEO_ROOT, "..", "news");
  const wrangler = path.join(news, "node_modules", "wrangler", "bin", "wrangler.js");
  // whoami refreshes an expired login and prints the account id.
  const who = spawnSync(process.execPath, [wrangler, "whoami"], { cwd: news, encoding: "utf8" });
  const account = env.CLOUDFLARE_ACCOUNT_ID || (who.stdout || "").match(/\b[0-9a-f]{32}\b/)?.[0];
  const config = path.join(env.APPDATA || path.join(os.homedir(), ".config"), "xdg.config", ".wrangler", "config", "default.toml");
  const alt = path.join(os.homedir(), ".wrangler", "config", "default.toml");
  const file = [config, alt].find((f) => existsSync(f));
  const token = file && readFileSync(file, "utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token || !account) throw new Error("Workers AI 인증이 없습니다. 최상위 .env에 CLOUDFLARE_API_TOKEN(Workers AI 권한)과 CLOUDFLARE_ACCOUNT_ID를 넣거나 news 폴더에서 npx wrangler login을 하세요.");
  return { token, account };
}

async function run(creds, model, { json, form, timeout = 120000 }) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${creds.account}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${creds.token}`, ...(json ? { "content-type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : form,
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(`${model} ${response.status}: ${JSON.stringify(body.errors || body).slice(0, 300)}`);
  return body.result;
}

export async function drawImage(creds, prompt, { model = IMAGE_MODEL, width = 1920, height = 1088, timeout } = {}) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(width));
  form.append("height", String(height));
  const result = await run(creds, model, { form, timeout });
  return Buffer.from(result.image, "base64");
}

// klein-4b usually answers in about 30 s but on 2026-09-28 it also sat for more than 4 minutes.
// Give it 90 s, then draw that picture with the fallback model so a slow queue cannot stall the video.
export const FALLBACK_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
export const PRIMARY_TIMEOUT = 90000;

export async function drawWithFallback(creds, prompt, { model = IMAGE_MODEL, fallback = FALLBACK_MODEL, log = () => {} } = {}) {
  try {
    return { image: await drawImage(creds, prompt, { model, timeout: fallback && fallback !== model ? PRIMARY_TIMEOUT : 180000 }), model };
  } catch (error) {
    if (!fallback || fallback === model) throw error;
    log(`${model.split("/").pop()} 실패(${error.name === "TimeoutError" ? "90초 초과" : error.message.slice(0, 80)}), ${fallback.split("/").pop()}로 그립니다`);
    return { image: await drawImage(creds, prompt, { model: fallback, timeout: 180000 }), model: fallback };
  }
}

// Downscale for the vision check; a full frame as a JSON byte array is needlessly large.
function thumbnail(image) {
  const out = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "scale=512:-2", "-q:v", "4", "-f", "mjpeg", "pipe:1"], { input: image, maxBuffer: 16 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`썸네일 실패: ${out.stderr}`);
  return out.stdout;
}

export async function flagged(creds, image, { model = VISION_MODEL } = {}) {
  const url = `data:image/jpeg;base64,${thumbnail(image).toString("base64")}`;
  const found = [];
  for (const [name, question] of CHECKS) {
    const content = [{ type: "text", text: question }, { type: "image_url", image_url: { url } }];
    const result = await run(creds, model, { json: { messages: [{ role: "user", content }], max_tokens: 8 } });
    // A check that does not clearly say "no" counts as flagged.
    if (!String(result.description || result.response || "").trim().toLowerCase().startsWith("no")) found.push(name);
  }
  return found;
}

export async function writeSubjects(creds, episode, scenes) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await run(creds, WRITER_MODEL, { json: { messages: [{ role: "user", content: subjectsPrompt(episode, scenes) }], max_tokens: 4000, temperature: 0.6 } });
      return parseSubjects(result.response ?? result.choices?.[0]?.message?.content, scenes.length);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

export async function makeBackgrounds(dir, { force = false, log = console.log, creds } = {}) {
  dir = path.resolve(dir);
  const episode = JSON.parse(readFileSync(path.join(dir, "episode.json"), "utf8"));
  const assets = path.join(dir, "assets");
  mkdirSync(assets, { recursive: true });
  const recordFile = path.join(assets, "backgrounds.json");
  const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")) : {};
  const todo = sceneOrder(episode).filter((scene) => !scene.background && (force || !["mp4", "png", "jpg"].some((ext) => existsSync(path.join(assets, `bg-${scene.id}.${ext}`)))));
  if (!todo.length) return { made: [], skipped: [] };
  creds ||= credentials();
  const made = [], skipped = [];
  const needed = todo.filter((scene) => !scene.visual);
  const written = needed.length ? await writeSubjects(creds, episode, needed) : [];
  for (const scene of todo) {
    const subject = scene.visual || written[needed.indexOf(scene)];
    const prompt = backgroundPrompt(subject);
    let saved = false;
    for (let attempt = 1; attempt <= ATTEMPTS && !saved; attempt++) {
      try {
        const { image, model } = await drawWithFallback(creds, prompt, { log: (message) => log(`${scene.id}: ${message}`) });
        const found = process.env.VIDEO_BACKGROUND_CHECK === "false" ? [] : await flagged(creds, image);
        if (found.length) { log(`${scene.id}: ${found.join("·")}이(가) 보여 다시 그립니다 (${attempt}/${ATTEMPTS})`); continue; }
        writeFileSync(path.join(assets, `bg-${scene.id}.jpg`), image);
        record[scene.id] = { model, subject, prompt, attempts: attempt, at: new Date().toISOString() };
        saved = true;
      } catch (error) {
        // One failed picture leaves that scene on a plain background; it does not stop the video.
        log(`${scene.id}: 배경을 그리지 못했습니다 (${error.message.slice(0, 120)})`);
        break;
      }
    }
    (saved ? made : skipped).push(scene.id);
  }
  writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { made, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const argv = process.argv.slice(2);
  const [dir] = argv.filter((arg) => !arg.startsWith("--"));
  if (!dir) { console.error("사용법: node tools/backgrounds.mjs out/<slug> [--force]"); process.exit(1); }
  makeBackgrounds(dir, { force: argv.includes("--force") })
    .then(({ made, skipped }) => console.log(`배경 ${made.length}장 생성${made.length ? ` (${made.join(", ")})` : ""}${skipped.length ? `, 3번 모두 글자·사람이 보여 단색으로 둔 장면: ${skipped.join(", ")}` : ""}`))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
