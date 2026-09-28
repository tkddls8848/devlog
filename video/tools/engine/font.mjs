// TrueType 글꼴을 직접 읽는다. 외부 라이브러리 없이 cmap(문자→글리프), hmtx(가로 폭),
// loca/glyf(윤곽선)만 해석한다. NanumGothic처럼 glyf 윤곽을 가진 .ttf가 대상이고,
// CFF 윤곽(.otf)은 다루지 않는다.
import { readFileSync } from "node:fs";

export function loadFont(file) {
  const data = readFileSync(file);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at) => view.getUint16(at);
  const i16 = (at) => view.getInt16(at);
  const u32 = (at) => view.getUint32(at);

  const tables = {};
  for (let i = 0, count = u16(4); i < count; i++) {
    const at = 12 + i * 16;
    tables[data.toString("latin1", at, at + 4)] = u32(at + 8);
  }
  for (const name of ["cmap", "head", "hhea", "hmtx", "loca", "glyf", "maxp"]) {
    if (tables[name] === undefined) throw new Error(`${file}: ${name} 표가 없습니다. glyf 윤곽의 TrueType 글꼴이 필요합니다.`);
  }

  const unitsPerEm = u16(tables.head + 18);
  const longLoca = i16(tables.head + 50) === 1;
  const ascender = i16(tables.hhea + 4);
  const descender = i16(tables.hhea + 6);
  const metricsCount = u16(tables.hhea + 34);
  const glyphCount = u16(tables.maxp + 4);

  // cmap: prefer the full-Unicode format 12 table, else the BMP format 4 table.
  let lookup = null;
  const subtables = [];
  for (let i = 0, count = u16(tables.cmap + 2); i < count; i++) {
    const at = tables.cmap + 4 + i * 8;
    const offset = tables.cmap + u32(at + 4);
    subtables.push({ platform: u16(at), encoding: u16(at + 2), offset, format: u16(offset) });
  }
  const format12 = subtables.find((t) => t.format === 12 && (t.platform === 3 || t.platform === 0));
  const format4 = subtables.find((t) => t.format === 4 && (t.platform === 3 || t.platform === 0));
  if (format12) {
    const at = format12.offset, groups = u32(at + 12);
    lookup = (code) => {
      let lo = 0, hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, g = at + 16 + mid * 12;
        const start = u32(g), end = u32(g + 4);
        if (code < start) hi = mid - 1; else if (code > end) lo = mid + 1; else return u32(g + 8) + code - start;
      }
      return 0;
    };
  } else if (format4) {
    const at = format4.offset, segments = u16(at + 6) / 2;
    const ends = at + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
    lookup = (code) => {
      if (code > 0xffff) return 0;
      for (let i = 0; i < segments; i++) {
        if (u16(ends + i * 2) < code) continue;
        const start = u16(starts + i * 2);
        if (start > code) return 0;
        const delta = i16(deltas + i * 2), range = u16(ranges + i * 2);
        if (!range) return (code + delta) & 0xffff;
        const glyph = u16(ranges + i * 2 + range + (code - start) * 2);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
      return 0;
    };
  } else throw new Error(`${file}: 읽을 수 있는 cmap(형식 4 또는 12)이 없습니다.`);

  const advance = (glyph) => u16(tables.hmtx + Math.min(glyph, metricsCount - 1) * 4);
  const glyphOffset = (glyph) => (longLoca ? u32(tables.loca + glyph * 4) : u16(tables.loca + glyph * 2) * 2);

  // Contours as arrays of {x, y, on}; composite glyphs are flattened with their transforms.
  const cache = new Map();
  function outline(glyph, depth = 0) {
    if (cache.has(glyph)) return cache.get(glyph);
    const result = [];
    if (glyph < glyphCount && depth < 8) {
      const start = glyphOffset(glyph), end = glyphOffset(glyph + 1);
      if (end > start) {
        const at = tables.glyf + start;
        const contours = i16(at);
        if (contours >= 0) result.push(...simpleGlyph(at, contours));
        else result.push(...compositeGlyph(at, depth));
      }
    }
    cache.set(glyph, result);
    return result;
  }

  function simpleGlyph(at, contourCount) {
    const endPoints = [];
    for (let i = 0; i < contourCount; i++) endPoints.push(u16(at + 10 + i * 2));
    const pointCount = contourCount ? endPoints[contourCount - 1] + 1 : 0;
    let p = at + 10 + contourCount * 2;
    p += 2 + u16(p); // skip hinting instructions
    const flags = [];
    while (flags.length < pointCount) {
      const flag = data[p++];
      flags.push(flag);
      if (flag & 8) for (let repeat = data[p++]; repeat > 0; repeat--) flags.push(flag);
    }
    const xs = new Array(pointCount), ys = new Array(pointCount);
    let value = 0;
    for (let i = 0; i < pointCount; i++) {
      const flag = flags[i];
      if (flag & 2) { const d = data[p++]; value += flag & 16 ? d : -d; } else if (!(flag & 16)) { value += i16(p); p += 2; }
      xs[i] = value;
    }
    value = 0;
    for (let i = 0; i < pointCount; i++) {
      const flag = flags[i];
      if (flag & 4) { const d = data[p++]; value += flag & 32 ? d : -d; } else if (!(flag & 32)) { value += i16(p); p += 2; }
      ys[i] = value;
    }
    const contours = [];
    let first = 0;
    for (const last of endPoints) {
      const contour = [];
      for (let i = first; i <= last; i++) contour.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      contours.push(contour);
      first = last + 1;
    }
    return contours;
  }

  function compositeGlyph(at, depth) {
    const contours = [];
    let p = at + 10, more = true;
    while (more) {
      const flags = u16(p), component = u16(p + 2);
      p += 4;
      let dx, dy;
      if (flags & 1) { dx = i16(p); dy = i16(p + 2); p += 4; } else { dx = (data[p] << 24) >> 24; dy = (data[p + 1] << 24) >> 24; p += 2; }
      let a = 1, b = 0, c = 0, d = 1;
      const f2dot14 = (at2) => i16(at2) / 16384;
      if (flags & 8) { a = d = f2dot14(p); p += 2; }
      else if (flags & 0x40) { a = f2dot14(p); d = f2dot14(p + 2); p += 4; }
      else if (flags & 0x80) { a = f2dot14(p); b = f2dot14(p + 2); c = f2dot14(p + 4); d = f2dot14(p + 6); p += 8; }
      // Only x/y offsets are supported (flag 2); point matching is rare in CJK fonts.
      if (!(flags & 2)) { dx = 0; dy = 0; }
      for (const contour of outline(component, depth + 1)) {
        contours.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      }
      more = (flags & 0x20) !== 0;
    }
    return contours;
  }

  const glyphOf = (char) => lookup(char.codePointAt(0));

  return {
    unitsPerEm, ascender, descender,
    glyphOf, advance, outline,
    // Width of a single-line string in font units.
    measure(text) {
      let width = 0;
      for (const char of text) width += advance(glyphOf(char));
      return width;
    },
  };
}
