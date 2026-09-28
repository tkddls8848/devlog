import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { loadFont } from "../tools/engine/font.mjs";
import { Coverage, rasterizeText } from "../tools/engine/raster.mjs";
import { Canvas, PALETTE, TextCache, drawMinimal, frameKey } from "../tools/engine/minimal.mjs";
import { frames, rawVideoInput } from "../tools/engine/index.mjs";
import { muxArgs, pickEngine } from "../tools/render.mjs";

test("사각형 윤곽은 안쪽을 가득, 가장자리는 덮인 비율만큼 칠한다", () => {
  const cov = new Coverage(8, 4);
  // A 3.5 x 2 box from (1.5, 1) to (5, 3), drawn as a closed outline.
  const box = [[1.5, 1], [5, 1], [5, 3], [1.5, 3]];
  box.forEach(([x0, y0], i) => { const [x1, y1] = box[(i + 1) % box.length]; cov.line(x0, y0, x1, y1); });
  const alpha = cov.toAlpha();
  const at = (x, y) => alpha[y * 8 + x];
  assert.equal(at(3, 1), 255);
  assert.equal(at(4, 2), 255);
  assert.equal(at(1, 1), 128, "반만 덮인 픽셀");
  assert.equal(at(0, 1), 0);
  assert.equal(at(5, 1), 0);
  assert.equal(at(3, 0), 0);
  assert.equal(at(3, 3), 0);
});

const FONT = "C:/Windows/Fonts/NanumGothic.ttf";
const hasFont = existsSync(FONT);

test("TrueType 글꼴에서 한글·영문 글리프를 찾아 폭을 재고 그린다", { skip: !hasFont && "NanumGothic 없음" }, () => {
  const font = loadFont(FONT);
  assert.equal(font.unitsPerEm, 1000);
  assert.ok(font.glyphOf("가") > 0 && font.glyphOf("A") > 0);
  assert.equal(font.glyphOf("\u{10FFFF}"), 0, "없는 문자는 0번 글리프");
  assert.ok(font.measure("가나") > font.measure("가"));
  const mask = rasterizeText(font, "가", 40);
  const inked = mask.alpha.filter((a) => a > 128).length;
  assert.ok(inked > 150 && inked < mask.width * mask.height / 2, `잉크 픽셀 ${inked}`);
});

const scene = (over = {}) => ({ start: 0, frames: 48, title: "첫 줄\n둘째 줄", label: "01 / 공개", note: "설명", cues: [{ text: "자막입니다.", start: 0, end: 24 }, { text: "다음 자막.", start: 24, end: 48 }], ...over });

test("같은 그림이 이어지는 프레임은 같은 키를 받아 다시 그리지 않는다", () => {
  const s = scene();
  assert.notEqual(frameKey(s, 0), frameKey(s, 1), "등장 애니메이션 중에는 매 프레임 다르다");
  assert.equal(frameKey(s, 16), frameKey(s, 20), "움직임이 끝나면 자막이 바뀔 때까지 같다");
  assert.notEqual(frameKey(s, 20), frameKey(s, 30), "자막이 바뀌면 다시 그린다");
});

test("미니멀 화면: 배경색으로 칠하고, 마지막 장면만 명도를 반전한다", { skip: !hasFont && "NanumGothic 없음" }, () => {
  const texts = new TextCache({ regular: loadFont(FONT), bold: loadFont(FONT) });
  const pixel = (canvas, x, y) => [...canvas.pixels.subarray((y * canvas.width + x) * 3, (y * canvas.width + x) * 3 + 3)];
  const first = new Canvas(320, 180);
  drawMinimal(first, texts, scene(), 0, 3, 20);
  assert.deepEqual(pixel(first, 2, 2), PALETTE.normal.paper);
  const last = new Canvas(320, 180);
  drawMinimal(last, texts, scene(), 2, 3, 20);
  assert.deepEqual(pixel(last, 2, 2), PALETTE.closing.paper);
  // The title's last line is drawn in the accent color somewhere in the frame.
  const accent = PALETTE.normal.accent;
  let found = false;
  for (let i = 0; i < first.pixels.length && !found; i += 3) found = first.pixels[i] === accent[0] && first.pixels[i + 1] === accent[1] && first.pixels[i + 2] === accent[2];
  assert.ok(found, "강조색 글자");
});

test("프레임 생성기는 장면 경계를 따라가고 바뀌지 않은 프레임은 같은 버퍼를 돌려준다", { skip: !hasFont && "NanumGothic 없음" }, () => {
  const spec = { width: 160, height: 90, fps: 24, frames: 96, layout: "minimal", scenes: [scene(), scene({ start: 48, title: "끝" })] };
  const fonts = { regular: loadFont(FONT), bold: loadFont(FONT) };
  const list = [...frames(spec, { fonts })];
  assert.equal(list.length, 96);
  assert.equal(list[0].length, 160 * 90 * 3);
  assert.equal(list[16], list[20]);
  assert.notEqual(list[47], list[48]);
});

test("자체 렌더러는 raw RGB를 표준 입력으로 넘기고, 음성 합성 인자는 그대로 쓴다", () => {
  const spec = { width: 1280, height: 720, fps: 24 };
  const video = rawVideoInput(spec);
  assert.deepEqual(video, ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720", "-framerate", "24", "-i", "pipe:0"]);
  const args = muxArgs({ fps: 24, video, voices: [{ file: "a.mp3", seconds: 2 }], seconds: 2, output: "o.mp4" });
  assert.deepEqual(args.slice(0, 10), video);
  assert.equal(args[args.indexOf("-i", 10) + 1], "a.mp3");
  assert.equal(pickEngine({ layout: "minimal" }, {}), "native");
  assert.equal(pickEngine({ layout: "classic" }, {}), "blender");
  assert.equal(pickEngine({ layout: "minimal" }, { VIDEO_ENGINE: "blender" }), "blender");
  assert.equal(pickEngine({ layout: "minimal" }, {}, { engine: "blender" }), "blender", "회차 style.engine");
  assert.equal(pickEngine({ layout: "minimal" }, { VIDEO_ENGINE: "native" }, { engine: "blender" }), "native", "환경 변수가 우선");
});
