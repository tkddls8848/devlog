// 단어 발화 시각(speech.py)으로 자막 구절과 장면 전환 시각을 정한다. stock_chatbot/shorts의
// render._phrases와 같은 규칙이다.
// - 먼저 문장으로 끊고, 한 화면에 안 들어가는 문장만 균등하게 나눈다(꼬리에 한 조각만 남지 않게).
// - 쉼표·연결어미 자리에서 끊기를 선호하고, "…와·과·의" 뒤와 한 어절 안에서는 끊지 않는다.
// - 구절은 첫 단어보다 조금 먼저(장면 첫 구절은 더 일찍) 떠서 다음 구절이 뜰 때까지 남는다.
// - 장면은 자기 첫 구절이 뜨는 순간 바뀐다. 화면이 먼저 자리를 잡고 말이 시작된다.

export const CAPTION_LEAD = 0.05;
export const SCENE_LEAD = 0.55;
export const PHRASE_CHARS = 30;
const SENTENCE_END = /[.?!]$/;
const CLAUSE_END = /(?:니|고|며|면|서|는데|지만)$/;
const BINDING_END = /[와과의]$/;

// Speech text with every lexicon term replaced, plus a map from speech offsets back to the
// original text, so captions keep the written form ("RAG") while timing comes from "래그".
export function speechMap(text, lexicon = []) {
  const terms = [...lexicon].sort((a, b) => b[0].length - a[0].length);
  if (!terms.length) return { speech: text, original: (i) => i };
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(terms.map(([term]) => `${/^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9])" : ""}${escape(term)}${/[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9])" : ""}`).join("|"), "gi");
  const map = [];
  let speech = "", last = 0;
  for (const match of text.matchAll(pattern)) {
    for (let i = last; i < match.index; i++) { map.push(i); speech += text[i]; }
    const reading = terms.find(([term]) => term.toLowerCase() === match[0].toLowerCase())[1];
    for (let k = 0; k < reading.length; k++) map.push(match.index);
    speech += reading;
    last = match.index + match[0].length;
  }
  for (let i = last; i < text.length; i++) { map.push(i); speech += text[i]; }
  map.push(text.length);
  return { speech, original: (i) => map[Math.min(i, map.length - 1)] };
}

export function locate(text, words) {
  const positions = [];
  let cursor = 0;
  for (const word of words) {
    const at = text.indexOf(word.text, cursor);
    if (at < 0) throw new Error(`합성된 단어를 원고에서 찾지 못했습니다: ${word.text}`);
    positions.push(at);
    cursor = at + word.text.length;
  }
  return positions;
}

// scenes: [{ narration (written), speech (spoken), original(i) }]; words: per-scene word lists.
export function buildPhrases(scenes, words, duration, { phraseChars = PHRASE_CHARS } = {}) {
  const marked = [];
  const counts = [];
  scenes.forEach((scene, sceneIndex) => {
    const list = words[sceneIndex];
    const starts = locate(scene.speech, list);
    const ends = [...starts.slice(1), scene.speech.length];
    // Word i covers the written text from its start up to the next word's start.
    const textOf = (first, last) => scene.narration.slice(scene.original(starts[first]), scene.original(ends[last])).replace(/\s+/g, " ").trim();
    const breakable = (i) => /\s/.test(scene.speech.slice(starts[i] + list[i].text.length, starts[i + 1]));
    const sentences = [];
    let sentence = [];
    list.forEach((_, i) => { sentence.push(i); if (SENTENCE_END.test(textOf(i, i))) { sentences.push(sentence); sentence = []; } });
    if (sentence.length) sentences.push(sentence);
    const groups = [];
    for (const s of sentences) {
      const length = textOf(s[0], s.at(-1)).length;
      const parts = Math.max(1, Math.ceil(length / phraseChars));
      if (parts === 1 || s.length < parts) { groups.push(s); continue; }
      const budget = length / parts;
      let group = [], cut = budget;
      for (const i of s) {
        group.push(i);
        if (i === s.at(-1) || !breakable(i)) continue;
        const soFar = textOf(s[0], i).length;
        const tail = textOf(group[0], i);
        if (BINDING_END.test(tail)) continue;
        const atPause = (tail.endsWith(",") || CLAUSE_END.test(tail)) && soFar >= cut - budget * 0.4;
        if (soFar >= cut || atPause) { groups.push(group); group = []; cut = Math.max(cut, soFar) + budget; }
      }
      if (group.length) groups.push(group);
    }
    counts.push(groups.length);
    groups.forEach((group, position) => {
      const lead = position === 0 ? SCENE_LEAD : CAPTION_LEAD;
      marked.push({ start: Math.max(0, list[group[0]].start - lead), text: textOf(group[0], group.at(-1)) });
    });
  });
  for (let i = 1; i < marked.length; i++) if (marked[i].start <= marked[i - 1].start) throw new Error("자막 시작 시각이 겹칩니다");
  const phrases = [];
  let at = 0;
  for (const count of counts) {
    phrases.push(marked.slice(at, at + count).map((p, n) => ({ ...p, end: at + n + 1 < marked.length ? marked[at + n + 1].start : duration })));
    at += count;
  }
  return phrases;
}

// A scene lasts from its first caption to the next scene's first caption.
export function sceneSpans(phrases, duration) {
  const starts = [0, ...phrases.slice(1).map((scene) => scene[0].start)];
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : duration }));
}

// Wrap at spaces, then narrow the width while the line count holds so lines come out even
// (no single word left alone on the last line).
export function balancedLines(text, measure, width) {
  const wrap = (limit) => {
    const lines = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || measure(candidate) <= limit) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  };
  let lines = wrap(width);
  for (let narrow = width - 20; lines.length > 1 && narrow > 160; narrow -= 20) {
    const candidate = wrap(narrow);
    if (candidate.length !== lines.length) break;
    lines = candidate;
  }
  return lines;
}
