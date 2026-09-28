// 배경 영상 위에 얹는 투명 카드(PNG). stock_chatbot/shorts의 render_frame을 가로 화면으로 옮겼다.
// 순서: 어둠(스크림) → 헤더(DEVLOG 칩, 날짜) → 장 표시 → 큰 제목 → 쪽 번호와 칸 진행바 → 설명.
// 자막은 여기서 그리지 않는다. Blender VSE의 text 스트립이 외곽선·그림자와 함께 맨 위에 얹는다.
import { rasterizeText } from "./raster.mjs";
import { encodePng } from "./png.mjs";

export const COLORS = {
  ink: [245, 241, 232], muted: [189, 182, 168], track: [53, 67, 72], chipText: [16, 27, 32],
  gold: [212, 168, 79], blue: [94, 143, 201], red: [224, 100, 92], green: [111, 179, 138], violet: [157, 132, 214],
};
// Sessions cycle through these; gold is kept for the opening and the ending.
export const ACCENT_ORDER = ["blue", "red", "green", "violet"];
const SCRIM_RGB = [10, 19, 25];

export class RgbaCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
  }

  // Straight-alpha "over" of one pixel.
  blend(x, y, [r, g, b], a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = (y * this.width + x) * 4, p = this.pixels;
    const da = p[at + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    const k = da * (1 - a);
    p[at] = Math.round((r * a + p[at] * k) / oa);
    p[at + 1] = Math.round((g * a + p[at + 1] * k) / oa);
    p[at + 2] = Math.round((b * a + p[at + 2] * k) / oa);
    p[at + 3] = Math.round(oa * 255);
  }

  // Filled rectangle with optional rounded corners (anti-aliased at the corners).
  rect(x0, y0, x1, y1, color, { alpha = 1, radius = 0 } = {}) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.height, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.width, Math.ceil(x1)); x++) {
        let cover = 1;
        if (radius) {
          const cx = Math.min(Math.max(x + 0.5, x0 + radius), x1 - radius);
          const cy = Math.min(Math.max(y + 0.5, y0 + radius), y1 - radius);
          cover = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
        }
        this.blend(x, y, color, alpha * cover);
      }
    }
  }

  mask(m, left, top, color, alpha = 1) {
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      const a = m.alpha[y * m.width + x];
      if (a) this.blend(left + x, top + y, color, (a / 255) * alpha);
    }
  }

  png() { return encodePng(this.width, this.height, this.pixels); }
}

// Text helper: draws with the top-left at (x, top of em box) and returns the drawn width.
export function makeWriter(canvas, fonts) {
  const cache = new Map();
  const mask = (text, size, bold) => {
    const key = `${bold ? "b" : "r"}|${size}|${text}`;
    if (!cache.has(key)) cache.set(key, rasterizeText(bold ? fonts.bold : fonts.regular, text, size));
    return cache.get(key);
  };
  const measure = (text, size, bold = false) => {
    const font = bold ? fonts.bold : fonts.regular;
    return (font.measure(text) * size) / font.unitsPerEm;
  };
  const write = (text, x, top, size, color, { bold = false, align = "left", alpha = 1 } = {}) => {
    const m = mask(text, Math.round(size), bold);
    const left = align === "right" ? x - m.advance : align === "center" ? x - m.advance / 2 : x;
    canvas.mask(m, Math.round(left - 2), Math.round(top), color, alpha);
    return m.advance;
  };
  return { write, measure };
}

function wrapWords(text, measure, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next) <= width) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// Darken the left (text side) and bottom (caption side) so type reads over any footage,
// while the right side keeps the picture visible.
function scrim(canvas, s) {
  const { width: W, height: H } = canvas;
  const lerp = (points, v) => {
    for (let i = 1; i < points.length; i++) {
      const [p0, a0] = points[i - 1], [p1, a1] = points[i];
      if (v <= p1) return a0 + (a1 - a0) * Math.max(0, (v - p0) / (p1 - p0));
    }
    return points.at(-1)[1];
  };
  const horizontal = [[0, 0.82], [760 * s, 0.7], [1250 * s, 0.34], [W, 0.16]];
  const vertical = [[0, 0.38], [200 * s, 0], [640 * s, 0], [880 * s, 0.55], [H, 0.78]];
  for (let y = 0; y < H; y++) {
    const av = lerp(vertical, y);
    for (let x = 0; x < W; x++) {
      const a = 1 - (1 - lerp(horizontal, x)) * (1 - av);
      canvas.blend(x, y, SCRIM_RGB, a);
    }
  }
}

// card: { kicker, title, note, points, date, index (1-based), total, accent }
// beat "open" draws the frame without the note/points; "card" draws everything.
export function drawCard(canvas, fonts, card, beat = "card") {
  const s = canvas.width / 1920;
  const { write, measure } = makeWriter(canvas, fonts);
  const accent = COLORS[card.accent] || COLORS.gold;
  const left = 96 * s, textRight = 1250 * s;
  scrim(canvas, s);

  // Header: brand chip, series name, date on the right.
  const chipText = "DEVLOG";
  const chipW = measure(chipText, 26 * s, true) + 30 * s;
  canvas.rect(left, 78 * s, left + chipW, 122 * s, accent, { radius: 8 * s });
  write(chipText, left + 15 * s, 85 * s, 26 * s, COLORS.chipText, { bold: true });
  write("ENGINEERING NOTES", left + chipW + 20 * s, 85 * s, 26 * s, COLORS.ink);
  if (card.date) write(card.date, canvas.width - 96 * s, 85 * s, 26 * s, COLORS.muted, { align: "right" });

  if (card.kicker) write(card.kicker, left, 250 * s, 34 * s, accent, { bold: true });

  // Big title: explicit lines (\n), each shrunk to fit, centered in its box.
  const lines = String(card.title || "").split("\n").filter(Boolean);
  const boxTop = 300 * s, boxBottom = 600 * s;
  const sizes = lines.map((line) => Math.min(96 * s, (96 * s * (textRight - left)) / Math.max(1, measure(line, 96 * s, true))));
  const lineGap = 1.22;
  const blockH = sizes.reduce((sum, size) => sum + size * lineGap, 0);
  let y = boxTop + Math.max(0, (boxBottom - boxTop - blockH) / 2);
  lines.forEach((line, i) => {
    const color = lines.length > 1 && i === lines.length - 1 ? accent : COLORS.ink;
    write(line, left, y, sizes[i], color, { bold: true });
    y += sizes[i] * lineGap;
  });

  // Page number and one slot per scene; slots up to this scene are filled.
  write(`${String(card.index).padStart(2, "0")} / ${String(card.total).padStart(2, "0")}`, left, 628 * s, 30 * s, COLORS.ink, { bold: true });
  const barLeft = left + 150 * s, span = textRight - barLeft, slot = span / card.total;
  for (let i = 0; i < card.total; i++) {
    canvas.rect(barLeft + i * slot, 645 * s, barLeft + (i + 1) * slot - 10 * s, 651 * s, i < card.index ? accent : COLORS.track);
  }

  if (beat !== "card") return;
  let top = 700 * s;
  if (card.note) {
    for (const line of wrapWords(card.note, (t) => measure(t, 38 * s), textRight - left).slice(0, 2)) {
      write(line, left, top, 38 * s, COLORS.muted);
      top += 38 * s * 1.4;
    }
  }
  for (const point of (card.points || []).slice(0, 3)) {
    canvas.rect(left, top + 16 * s, left + 12 * s, top + 28 * s, accent, { radius: 6 * s });
    write(point, left + 30 * s, top, 34 * s, COLORS.ink);
    top += 34 * s * 1.45;
  }
}
