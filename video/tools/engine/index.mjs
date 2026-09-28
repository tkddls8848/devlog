// 자체 렌더러. 사양(buildSpec)의 장면을 프레임마다 그려 raw RGB로 ffmpeg 표준 입력에 흘려보낸다.
// 중간 이미지 파일을 만들지 않고, 화면이 바뀌지 않는 프레임은 직전 그림을 그대로 다시 보낸다.
// ffmpeg는 H.264/AAC 인코딩과 음성 합성만 맡는다.
import { spawn } from "node:child_process";
import { loadFont } from "./font.mjs";
import { Canvas, TextCache, drawMinimal, frameKey } from "./minimal.mjs";

export function* frames(spec, { total = spec.frames, fonts }) {
  const texts = new TextCache(fonts);
  const count = spec.scenes.length;
  let index = 0, lastKey = null, last = null;
  for (let f = 0; f < total; f++) {
    while (index < count - 1 && f >= spec.scenes[index].start + spec.scenes[index].frames) index++;
    const scene = spec.scenes[index];
    const local = f - scene.start;
    const key = `${index}|${frameKey(scene, local)}`;
    if (key !== lastKey) {
      const canvas = new Canvas(spec.width, spec.height);
      drawMinimal(canvas, texts, scene, index, count, local);
      last = canvas.pixels;
      lastKey = key;
    }
    yield last;
  }
}

export const rawVideoInput = (spec) => ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${spec.width}x${spec.height}`, "-framerate", String(spec.fps), "-i", "pipe:0"];

// Draw every frame and pipe it into an ffmpeg process started with `args` (which reads pipe:0).
export async function renderToFfmpeg(spec, { total = spec.frames, args, ffmpeg = "ffmpeg", onProgress }) {
  if (spec.layout && spec.layout !== "minimal") throw new Error(`자체 렌더러는 minimal 레이아웃만 그립니다(현재 ${spec.layout}). VIDEO_ENGINE=blender로 렌더링하세요.`);
  const fonts = { regular: loadFont(spec.font), bold: loadFont(spec.fontBold) };
  const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 실패 (${code})\n${stderr}`))));
  });
  const stdin = child.stdin;
  let broken = null;
  stdin.on("error", (error) => { broken = error; });
  let n = 0;
  for (const frame of frames(spec, { total, fonts })) {
    if (broken) break;
    if (!stdin.write(frame)) await new Promise((resolve) => { stdin.once("drain", resolve); stdin.once("close", resolve); });
    if (onProgress && ++n % (spec.fps * 10) === 0) onProgress(n, total);
  }
  stdin.end();
  await done;
}
