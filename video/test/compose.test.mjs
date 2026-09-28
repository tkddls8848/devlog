import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { balancedLines, buildPhrases, sceneSpans, speechMap, SCENE_LEAD, CAPTION_LEAD } from "../tools/timeline.mjs";
import { RgbaCanvas } from "../tools/engine/cards.mjs";
import { encodePng } from "../tools/engine/png.mjs";
import { beats, findBackground, sceneCards, toneFor } from "../tools/compose.mjs";

const w = (start, end, text) => ({ start, end, text });

test("발음 사전으로 바꾼 음성 원고에서도 자막은 원래 표기를 쓴다", () => {
  const { speech, original } = speechMap("local RAG PoC를 고쳤다.", [["RAG", "래그"], ["local RAG", "로컬 래그"], ["PoC", "피오씨"]]);
  assert.equal(speech, "로컬 래그 피오씨를 고쳤다.");
  assert.equal(original(0), 0);
  assert.equal(original(speech.indexOf("피오씨")), "local RAG ".length);
  assert.equal(original(speech.indexOf("를")), "local RAG PoC".length);
});

test("자막은 문장으로 끊고, 긴 문장은 쉼표에서 균등하게 나누며 단어 시각보다 조금 먼저 뜬다", () => {
  const first = "첫 장면입니다.";
  const second = "시험용 페이지가 검색에 섞이지 않도록, 공개할 범위도 정리했습니다. 끝.";
  const scenes = [first, second].map((narration) => ({ narration, ...speechMap(narration) }));
  const words = [
    [w(0.1, 0.4, "첫"), w(0.4, 1.0, "장면입니다")],
    [w(1.6, 2.0, "시험용"), w(2.0, 2.4, "페이지가"), w(2.4, 2.8, "검색에"), w(2.8, 3.2, "섞이지"), w(3.2, 3.8, "않도록"),
      w(4.0, 4.4, "공개할"), w(4.4, 4.8, "범위도"), w(4.8, 5.6, "정리했습니다"), w(6.0, 6.4, "끝")],
  ];
  const phrases = buildPhrases(scenes, words, 7, { phraseChars: 24 });
  assert.deepEqual(phrases[1].map((p) => p.text), ["시험용 페이지가 검색에 섞이지 않도록,", "공개할 범위도 정리했습니다.", "끝."]);
  assert.equal(phrases[0][0].start, 0);
  assert.equal(phrases[1][0].start, 1.6 - SCENE_LEAD, "장면 첫 구절은 더 일찍 뜬다");
  assert.equal(phrases[1][1].start, 4.0 - CAPTION_LEAD);
  assert.equal(phrases[1][0].end, phrases[1][1].start, "빈틈도 겹침도 없다");
  assert.equal(phrases[1].at(-1).end, 7);
  assert.deepEqual(sceneSpans(phrases, 7), [{ start: 0, end: 1.6 - SCENE_LEAD }, { start: 1.6 - SCENE_LEAD, end: 7 }]);
});

test("자막 줄은 줄 수가 늘지 않는 선에서 고르게 나눈다", () => {
  const measure = (text) => text.length * 20;
  const lines = balancedLines("가나다 라마바 사아자 차카타 파하", measure, 300);
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 4, lines.join(" / "));
});

test("PNG 인코더는 읽을 수 있는 RGBA 이미지를 쓰고, 카드 캔버스는 알파를 겹친다", () => {
  const canvas = new RgbaCanvas(4, 2);
  canvas.rect(0, 0, 2, 2, [255, 0, 0], { alpha: 0.5 });
  canvas.rect(0, 0, 1, 1, [0, 0, 255], { alpha: 0.5 });
  assert.deepEqual([...canvas.pixels.subarray(4, 8)], [255, 0, 0, 128]);
  assert.equal(canvas.pixels[3], 192, "두 번 겹치면 더 불투명하다(0.5 위에 0.5 → 0.75)");
  const png = encodePng(4, 2, canvas.pixels);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  const idat = png.indexOf("IDAT");
  const length = png.readUInt32BE(idat - 4);
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
  assert.equal(raw.length, (4 * 4 + 1) * 2);
  assert.deepEqual([...raw.subarray(1 + 4, 1 + 8)], [255, 0, 0, 128]);
});

const episode = {
  date: "2026-09-26", title: "기능 다음의 일",
  opening: { id: "opening", kind: "title", label: "DEVLOG / 2026.09.26", text: "만들었다.\n이제?", narration: "a." },
  ending: { id: "ending", kind: "title", text: "끝", narration: "b." },
  sessions: [
    { repo: "o/convertors", subtitle: "첫 배포", thread: { name: "공개", episode: 1 }, commits: [], scenes: [{ id: "release", kind: "clip", label: "01 / 공개", text: "내 컴퓨터에서\n다른 사람에게.", note: "첫 공개 배포", narration: "c." }] },
    { repo: "o/game", subtitle: "공간감", thread: { name: "몰입", episode: 1 }, commits: [], scenes: [{ id: "space", kind: "clip", narration: "d." }] },
  ],
};

test("카드 내용은 회차 글에서 오고, 저장소마다 강조색이 다르며 처음과 끝은 금색이다", () => {
  const cards = sceneCards(episode);
  assert.deepEqual(cards.map((c) => c.accent), ["gold", "blue", "red", "gold"]);
  assert.equal(cards[1].kicker, "01 / 공개 · convertors");
  assert.equal(cards[1].title, "내 컴퓨터에서\n다른 사람에게.");
  assert.equal(cards[1].note, "첫 공개 배포");
  assert.equal(cards[2].title, "공간감", "편집 제목이 없으면 세션 부제");
  assert.equal(cards[3].kicker, "마무리");
  assert.deepEqual([cards[0].index, cards[0].total, cards[0].date], [1, 4, "2026.09.26"]);
});

test("긴 장면은 제목만 먼저 세운 뒤 설명을 얹고, 배경은 장면 강조색으로 물든다", () => {
  assert.deepEqual(beats(2), [{ beat: "card", hold: 2 }]);
  const [open, card] = beats(10);
  assert.equal(open.beat, "open");
  assert.equal(open.hold, 2.2);
  assert.equal(card.hold, 7.8);
  const tone = toneFor("blue", 1);
  assert.ok(tone.multiply[2] > tone.multiply[0], "파랑 쪽이 더 남는다");
});

test("배경은 장면 background, 없으면 assets/bg-<id>를 찾고, 그것도 없으면 단색이다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "compose-"));
  try {
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", "bg-release.mp4"), "");
    writeFileSync(path.join(dir, "cover.png"), "");
    assert.equal(findBackground(dir, { id: "release" }).kind, "movie");
    assert.equal(findBackground(dir, { id: "space", background: "cover.png" }).kind, "image");
    assert.deepEqual(findBackground(dir, { id: "ending" }), { path: null, kind: "color" });
    assert.ok(existsSync(findBackground(dir, { id: "release" }).path));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
