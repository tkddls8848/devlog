// 윤곽선을 픽셀 덮임 비율(0~1)로 바꾼다. 선분마다 각 픽셀이 덮이는 부호 있는 면적을 누적한 뒤
// 행을 따라 더하는 방식이라 표본을 여러 번 찍지 않아도 가장자리가 부드럽다
// (Raph Levien의 font-rs와 같은 누적 면적 방식).

export class Coverage {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // One extra cell per row absorbs the carry past the right edge.
    this.acc = new Float32Array(width * height + 4);
  }

  line(x0, y0, x1, y1) {
    if (y0 === y1) return;
    let dir = 1;
    if (y0 > y1) { dir = -1; [x0, y0, x1, y1] = [x1, y1, x0, y0]; }
    const { width: w, height: h, acc } = this;
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = x0;
    if (y0 < 0) x -= y0 * dxdy;
    const yEnd = Math.min(h, Math.ceil(y1));
    for (let y = Math.max(0, Math.floor(y0)); y < yEnd; y++) {
      const row = y * w;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xNext = x + dxdy * dy;
      const d = dy * dir;
      const lo = Math.min(x, xNext), hi = Math.max(x, xNext);
      const loFloor = Math.floor(lo), loI = loFloor;
      const hiCeil = Math.ceil(hi), hiI = hiCeil;
      if (hiI <= loI + 1) {
        const xm = 0.5 * (x + xNext) - loFloor;
        const at = row + loI;
        if (at >= 0 && loI < w) {
          acc[at] += d - d * xm;
          acc[at + 1] += d * xm;
        }
      } else {
        const s = 1 / (hi - lo);
        const loF = lo - loFloor;
        const a0 = 0.5 * s * (1 - loF) * (1 - loF);
        const hiF = hi - hiCeil + 1;
        const am = 0.5 * s * hiF * hiF;
        const at = row + loI;
        if (at >= 0) {
          acc[at] += d * a0;
          if (hiI === loI + 2) acc[at + 1] += d * (1 - a0 - am);
          else {
            const a1 = s * (1.5 - loF);
            acc[at + 1] += d * (a1 - a0);
            for (let xi = loI + 2; xi < hiI - 1; xi++) acc[row + xi] += d * s;
            const a2 = a1 + (hiI - loI - 3) * s;
            acc[row + hiI - 1] += d * (1 - a2 - am);
          }
          acc[row + hiI] += d * am;
        }
      }
      x = xNext;
    }
  }

  // Prefix-sum into 8-bit alpha.
  toAlpha() {
    const { width: w, height: h, acc } = this;
    const alpha = new Uint8Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) {
      sum += acc[i];
      const a = Math.abs(sum);
      alpha[i] = a >= 1 ? 255 : Math.round(a * 255);
    }
    return alpha;
  }
}

// Walk a TrueType contour (on/off-curve points) as line segments, splitting each quadratic
// curve finely enough that the error stays well under a pixel.
export function flattenContour(contour, transform, emit) {
  const n = contour.length;
  if (n < 2) return;
  const pts = contour.map((p) => ({ ...transform(p.x, p.y), on: p.on }));
  // Start on an on-curve point, or on the midpoint of two off-curve points.
  let startIndex = pts.findIndex((p) => p.on);
  let start;
  if (startIndex < 0) {
    start = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    startIndex = 0;
  } else start = pts[startIndex];
  let cur = start, control = null;
  const quad = (c, to) => {
    const len = Math.hypot(c.x - cur.x, c.y - cur.y) + Math.hypot(to.x - c.x, to.y - c.y);
    const steps = Math.max(1, Math.min(32, Math.ceil(Math.sqrt(len) * 0.9)));
    let px = cur.x, py = cur.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      const x = mt * mt * cur.x + 2 * mt * t * c.x + t * t * to.x;
      const y = mt * mt * cur.y + 2 * mt * t * c.y + t * t * to.y;
      emit(px, py, x, y);
      px = x; py = y;
    }
    cur = to;
  };
  // When every point is off-curve the loop ends on pts[startIndex] itself as a control point.
  for (let k = 1; k <= n; k++) {
    const p = pts[(startIndex + k) % n];
    if (p.on) {
      if (control) { quad(control, p); control = null; }
      else { emit(cur.x, cur.y, p.x, p.y); cur = p; }
    } else if (control) {
      quad(control, { x: (control.x + p.x) / 2, y: (control.y + p.y) / 2 });
      control = p;
    } else control = p;
  }
  if (control) quad(control, start);
  else if (cur.x !== start.x || cur.y !== start.y) emit(cur.x, cur.y, start.x, start.y);
}

// Render one line of text into an alpha mask. The baseline sits at `ascent` pixels from the top.
export function rasterizeText(font, text, sizePx) {
  const scale = sizePx / font.unitsPerEm;
  const ascent = Math.ceil(font.ascender * scale);
  const height = Math.max(1, ascent + Math.ceil(-font.descender * scale) + 2);
  const width = Math.max(1, Math.ceil(font.measure(text) * scale) + 4);
  const cov = new Coverage(width, height);
  let penX = 2;
  for (const char of text) {
    const glyph = font.glyphOf(char);
    const ox = penX;
    const transform = (x, y) => ({ x: ox + x * scale, y: ascent - y * scale });
    for (const contour of font.outline(glyph)) flattenContour(contour, transform, (a, b, c, d) => cov.line(a, b, c, d));
    penX += font.advance(glyph) * scale;
  }
  return { width, height, ascent, sizePx, alpha: cov.toAlpha(), advance: penX - 2 };
}
