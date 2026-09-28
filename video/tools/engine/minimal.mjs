// 미니멀 레이아웃(EDITORIAL.md)을 직접 그린다. Blender 없이 프레임마다 RGB 버퍼를 채운다.
// 화면 구성: 따뜻한 흰 배경, 위쪽 장 번호와 쪽 번호, 가는 선, 큰 두 줄 제목(마지막 줄 강조색),
// 작은 설명 한 줄, 아래 자막. 마지막 장면만 명도를 반전한다.
import { rasterizeText } from "./raster.mjs";

// sRGB colors matching the Blender minimal look (its linear values converted for display).
export const PALETTE = {
  normal: { paper: [248, 247, 243], ink: [29, 33, 39], muted: [118, 124, 132], accent: [33, 85, 211] },
  closing: { paper: [29, 33, 39], ink: [248, 247, 243], muted: [188, 191, 196], accent: [158, 191, 255] },
};

// Layout in a 16 x 9 unit grid, the same numbers the Blender script used.
const GRID = { margin: 1.35, labelY: 1.15, ruleY: 1.65, titleY: 3.35, titleStep: 1.48, noteY: 6.35, captionY: 7.85 };
const SIZE = { label: 0.23, title: 1.13, note: 0.29, caption: 0.34 };
const WIDTH = { title: 13.0, note: 12.8, caption: 13.2 };
const TITLE_IN = 8; // frames for a title line to settle
const CAPTION_IN = 3;

const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
  }

  fill([r, g, b]) {
    const row = Buffer.alloc(this.width * 3);
    for (let i = 0; i < row.length; i += 3) { row[i] = r; row[i + 1] = g; row[i + 2] = b; }
    for (let y = 0; y < this.height; y++) row.copy(this.pixels, y * row.length);
  }

  rect(x, y, w, h, [r, g, b]) {
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.width, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.height, Math.max(Math.round(y) + 1, Math.round(y + h)));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const at = (yy * this.width + xx) * 3;
      this.pixels[at] = r; this.pixels[at + 1] = g; this.pixels[at + 2] = b;
    }
  }

  // Composite an alpha mask in a solid color.
  mask(m, left, top, [r, g, b], opacity = 1) {
    if (opacity <= 0) return;
    const { width: W, height: H, pixels } = this;
    for (let y = 0; y < m.height; y++) {
      const py = top + y;
      if (py < 0 || py >= H) continue;
      for (let x = 0; x < m.width; x++) {
        const a = m.alpha[y * m.width + x];
        if (!a) continue;
        const px = left + x;
        if (px < 0 || px >= W) continue;
        const k = (a / 255) * opacity, at = (py * W + px) * 3;
        pixels[at] += (r - pixels[at]) * k;
        pixels[at + 1] += (g - pixels[at + 1]) * k;
        pixels[at + 2] += (b - pixels[at + 2]) * k;
      }
    }
  }
}

// Text masks are rendered once per (font, size, string) and reused for every frame.
export class TextCache {
  constructor(fonts) { this.fonts = fonts; this.masks = new Map(); }

  get(text, sizePx, bold = false) {
    const key = `${bold ? "b" : "r"}|${sizePx.toFixed(2)}|${text}`;
    if (!this.masks.has(key)) this.masks.set(key, rasterizeText(bold ? this.fonts.bold : this.fonts.regular, text, sizePx));
    return this.masks.get(key);
  }

  // Shrink a one-line text until it fits, as the Blender layout did.
  fit(text, sizePx, maxWidth, bold = false) {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const natural = (font.measure(text) * sizePx) / font.unitsPerEm;
    return this.get(text, natural > maxWidth ? (sizePx * maxWidth) / natural : sizePx, bold);
  }
}

// Place a mask so the middle of its em box sits on `centerY`.
function draw(canvas, m, x, centerY, color, { align = "left", opacity = 1, font }) {
  const mid = ((font.ascender + font.descender) / 2) * (m.sizePx / font.unitsPerEm);
  const baseline = centerY + mid;
  const left = align === "center" ? x - m.advance / 2 - 2 : align === "right" ? x - m.advance - 2 : x - 2;
  canvas.mask(m, Math.round(left), Math.round(baseline - m.ascent), color, opacity);
}

// What changes on screen at this frame; equal keys mean an identical picture.
export function frameKey(scene, local) {
  const cue = scene.cues.findIndex((c) => local >= c.start && local < c.end);
  const cueAge = cue >= 0 ? Math.min(CAPTION_IN, local - scene.cues[cue].start) : 0;
  return `${scene.start}|${Math.min(local, TITLE_IN + 6)}|${cue}|${cueAge}`;
}

export function drawMinimal(canvas, texts, scene, index, total, local) {
  const u = canvas.width / 16;
  const colors = index === total - 1 ? PALETTE.closing : PALETTE.normal;
  const { regular, bold } = texts.fonts;
  canvas.fill(colors.paper);

  const left = GRID.margin * u, right = (16 - GRID.margin) * u;
  const labelPx = SIZE.label * u;
  const label = scene.label || `${String(index + 1).padStart(2, "0")} / DEVLOG`;
  draw(canvas, texts.get(label, labelPx), left, GRID.labelY * u, colors.muted, { font: regular });
  const page = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  draw(canvas, texts.get(page, labelPx), right, GRID.labelY * u, colors.muted, { align: "right", font: regular });
  canvas.rect(left, GRID.ruleY * u, right - left, Math.max(1, 0.012 * u), colors.muted);

  // Title lines rise a few pixels and fade in; the last line carries the accent color.
  const lines = String(scene.title || "").split("\n");
  const titlePx = SIZE.title * u;
  const t = easeOut(clamp01(local / TITLE_IN));
  lines.forEach((line, i) => {
    const m = texts.fit(line, titlePx, WIDTH.title * u, true);
    const y = (GRID.titleY + i * GRID.titleStep) * u + (1 - t) * 0.1 * u;
    draw(canvas, m, left, y, i === lines.length - 1 && lines.length > 1 ? colors.accent : colors.ink, { opacity: t, font: bold });
  });

  if (scene.note) {
    const notePx = SIZE.note * u;
    const m = texts.fit(scene.note, notePx, WIDTH.note * u);
    draw(canvas, m, left, GRID.noteY * u, colors.muted, { opacity: easeOut(clamp01((local - 4) / TITLE_IN)), font: regular });
  }

  // Captions sit on the canvas itself: no band, box or shadow.
  const cue = scene.cues.find((c) => local >= c.start && local < c.end);
  if (cue) {
    const capPx = SIZE.caption * u;
    const rows = cue.text.split("\n");
    const opacity = clamp01((local - cue.start + 1) / CAPTION_IN);
    rows.forEach((row, r) => {
      const m = texts.fit(row, capPx, WIDTH.caption * u);
      const y = GRID.captionY * u + (r - (rows.length - 1) / 2) * capPx * 1.4;
      draw(canvas, m, canvas.width / 2, y, colors.ink, { align: "center", opacity, font: regular });
    });
  }
}
