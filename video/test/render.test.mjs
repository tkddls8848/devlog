import assert from "node:assert/strict";
import test from "node:test";
import { buildChapters, buildSpec, parseEnv } from "../tools/lib.mjs";
import { muxArgs, renderProblems } from "../tools/render.mjs";
import { pickProvider } from "../tools/voice.mjs";

const commit = (sha, subject) => ({ sha: sha.padEnd(40, "0"), subject, body: "", files: [] });
const episode = {
  date: "2026-09-26", title: "2026-09-26 작업 회고",
  opening: { id: "opening", kind: "title", narration: "오늘은 두 저장소입니다.", text: "2026-09-26 작업 회고" },
  ending: { id: "ending", kind: "title", narration: "다음에 확인할 예정입니다.", text: "다음 회차에 계속" },
  unassigned: [],
  sessions: [
    {
      repo: "o/app", subtitle: "첫 배포", summary: "배포했다.", thread: { id: "app-release", name: "공개 배포", episode: 1, isNew: true, music: "" },
      commits: [commit("aaaaaaa", "처음 공개 배포한다"), commit("bbbbbbb", "저작권자를 바로잡는다"), commit("ccccccc", "기본 포트를 옮긴다")],
      scenes: [
        { id: "s1-title", kind: "title", narration: "첫 번째는 app입니다." },
        { id: "s1-clip1", kind: "clip", narration: "처음 배포했습니다. 저작권자 표기도 바로잡았습니다.", prompt: null },
        { id: "s1-clip2", kind: "clip", narration: "기본 포트를 옮겼습니다.", prompt: null },
      ],
    },
    {
      repo: "o/game", subtitle: "분위기", summary: "소리를 넣었다.", thread: { id: "game-mood", name: "분위기", episode: 2, isNew: false, music: "" },
      commits: [commit("ddddddd", "빗소리를 넣는다")],
      scenes: [{ id: "s2-title", kind: "title", narration: "두 번째는 game입니다." }, { id: "s2-clip1", kind: "clip", narration: "빗소리를 넣었습니다.", prompt: null }],
    },
  ],
};
const seconds = new Map([["opening", 3], ["s1-title", 2], ["s1-clip1", 6], ["s1-clip2", 4], ["s2-title", 2], ["s2-clip1", 5], ["ending", 3]]);

test("Blender 사양은 음성 길이로 장면 프레임을 정하고, 화면 글자는 커밋과 글에서만 가져온다", () => {
  const spec = buildSpec(episode, seconds, { fps: 24, font: "f.ttf", fontBold: "b.ttf" });
  assert.equal(spec.frames, 25 * 24);
  assert.deepEqual(spec.scenes.map((s) => [s.start, s.frames]), [[0, 72], [72, 48], [120, 144], [264, 96], [360, 48], [408, 120], [528, 72]]);
  const [opening, title, clip1, clip2, , clip3, ending] = spec.scenes;
  assert.equal(opening.subtitle, "app · game");
  assert.equal(title.kicker, "app · 공개 배포 1화");
  assert.equal(title.subtitle, "첫 배포");
  // Three commits over two content scenes: two chips, then one.
  assert.deepEqual(clip1.chips.map((c) => c.text), ["처음 공개 배포한다", "저작권자를 바로잡는다"]);
  assert.deepEqual(clip2.chips.map((c) => c.text), ["기본 포트를 옮긴다"]);
  assert.equal(clip1.panel, undefined, "커밋 해시는 화면에 두지 않는다");
  assert.ok(clip1.chips.every((c) => c.at >= 0 && c.at < clip1.frames));
  assert.notDeepEqual(clip1.accent, clip3.accent, "저장소마다 강조색이 다르다");
  assert.equal(ending.kicker, "마무리");
  // Cues are in scene-local frames and cover the scene.
  assert.equal(clip1.cues.length, 2);
  assert.equal(clip1.cues[0].start, 0);
  assert.equal(clip1.cues.at(-1).end, 144);
});

test("긴 자막은 띄어쓰기에서 줄을 나눈다", () => {
  const long = { ...episode, opening: { ...episode.opening, narration: "스테이징 환경은 검색 엔진이 색인하지 않도록 막았고 저작권자 표기도 바로잡았습니다." } };
  const [opening] = buildSpec(long, seconds, { maxLine: 20 }).scenes;
  assert.match(opening.cues[0].text, /\n/);
  assert.ok(opening.cues[0].text.split("\n").every((line) => line.length <= 20));
});

test("쉬운 설명용 제목과 요약은 커밋 제목보다 우선하고 자막은 새 내레이션을 따른다", () => {
  const edited = structuredClone(episode);
  edited.opening.subtitle = "처음 보는 사람을 위한 요약";
  edited.sessions[0].scenes[0].text = "다른 사람도 쓸 수 있도록";
  Object.assign(edited.sessions[0].scenes[1], { text: "공개할 때 챙길 것", points: ["첫 버전 공개", "시험 페이지 검색 제외"], narration: "첫 버전을 공개했습니다." });
  const [opening, title, clip] = buildSpec(edited, seconds).scenes;
  assert.equal(opening.subtitle, "처음 보는 사람을 위한 요약");
  assert.equal(title.title, "다른 사람도 쓸 수 있도록");
  assert.equal(clip.title, "공개할 때 챙길 것");
  assert.deepEqual(clip.chips.map((c) => c.text), ["첫 버전 공개", "시험 페이지 검색 제외"]);
  assert.equal(clip.cues[0].text, "첫 버전을 공개했습니다.");
});

test("장은 저장소 제목 장면에서 시작하고 총 길이를 돌려준다", () => {
  const { chapters, total } = buildChapters(episode, seconds);
  assert.equal(total, 25);
  assert.deepEqual(chapters.map((c) => [c.title, c.start]), [["오프닝", 0], ["app · 공개 배포 1화", 3], ["game · 분위기 2화", 15], ["다음 회차", 22]]);
});

test("미니멀 회차는 제목 장면 없이도 첫 내용 장면에서 챕터가 시작한다", () => {
  const edited = structuredClone(episode);
  edited.style = { layout: "minimal" };
  edited.sessions[0].scenes[0].kind = "clip";
  edited.sessions[0].scenes[0].label = "01 / 공개";
  const { chapters } = buildChapters(edited, seconds);
  assert.equal(chapters[1].title, "01 / 공개");
  assert.equal(chapters[1].start, 3);
  assert.equal(chapters.at(-1).title, "마무리");
  assert.equal(buildSpec(edited, seconds).layout, "minimal");
});

test("ffmpeg는 장면 음성을 장면 길이만큼 늘여 잇고, 음악이 있으면 낮게 섞는다", () => {
  const voices = [{ file: "a.mp3", seconds: 2.5 }, { file: "b.mp3", seconds: 4 }];
  const plain = muxArgs({ frames: "fr", fps: 24, voices, seconds: 6.5, output: "o.mp4" });
  const graph = plain[plain.indexOf("-filter_complex") + 1];
  assert.match(graph, /\[1:a\][^;]*apad=whole_dur=2\.500\[v0\]/);
  assert.match(graph, /\[v0\]\[v1\]concat=n=2:v=0:a=1\[voice\]/);
  assert.equal(plain[plain.indexOf("-map", plain.indexOf("-filter_complex")) + 3], "[voice]");
  const mixed = muxArgs({ frames: "fr", fps: 24, voices, music: "m.mp3", musicVolume: "0.1", seconds: 6.5, output: "o.mp4" });
  assert.match(mixed[mixed.indexOf("-filter_complex") + 1], /\[3:a\].*volume=0\.1\[m\];\[voice\]\[m\]amix=inputs=2:duration=first/);
  assert.equal(mixed[mixed.indexOf("-t") + 1], "6.500");
});

test("Blender 경로는 Artlist용 칸(클립 프롬프트, 음악 설명)을 요구하지 않는다", () => {
  assert.deepEqual(renderProblems(episode), []);
  assert.match(renderProblems({ ...episode, ending: { ...episode.ending, narration: "" } }).join(), /ending: narration/);
});

test("목소리는 ElevenLabs 키와 목소리 ID가 모두 있을 때만 ElevenLabs를 쓴다", () => {
  assert.equal(pickProvider({}), "edge");
  assert.equal(pickProvider({ ELEVENLABS_API_KEY: "k" }), "edge");
  assert.equal(pickProvider({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" }), "elevenlabs");
  assert.equal(pickProvider({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" }, "edge"), "edge");
  assert.deepEqual(parseEnv('A=1\n# c\nB = "two"\r\n'), { A: "1", B: "two" });
});
