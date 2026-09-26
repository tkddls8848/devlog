import assert from "node:assert/strict";
import test from "node:test";
import {
  REFERENCE_MARKER, allocateCues, assignSections, buildDescription, buildSrt, buildTitle, formatTimestamp, keywordsOf,
  matchThread, parseEvidence, parseJournal, pathsOf, planEpisode, recordEpisode, sceneOrder, splitBody, validateEpisode,
} from "../tools/lib.mjs";
import { segmentArgs, concatArgs } from "../tools/assemble.mjs";
import { scriptMarkdown } from "../tools/plan.mjs";

const journalText = `---
slug: "2026-09-24-devlog"
date: "2026-09-24"
status: "published"
title: "인물 목소리를 오디오 버스에 얹는다"
summary: "게임의 대사 재생을 기존 사운드 믹서에 통합했다."
---

<!-- 안내 주석은 발행되지 않는다 -->

이틀 전에 넣은 사운드 믹서 위에 대사를 얹었다.

## 대사 재생을 audio 믹서에 붙이기

\`voice.ts\`에서 대사를 큐로 관리하고 mixer의 버스를 하나 더 만들었다.

## 뉴스레터 수집 재시도

news 워커의 수집기가 실패하면 한 번 더 시도한다.

${REFERENCE_MARKER}

## 2026-09-24 참고 자료 (2026-09-25 09:10 수집 · 커밋 3건 · 저장소 2개)

### 1. 쓰기 전에 떠올려 볼 질문

- 질문

### 2. AI 참고 문구 (그대로 옮기지 말고 사실과 다르면 고쳐 쓰세요)

#### 제목 후보
- 후보

### 3. 커밋 근거

#### tkddls8848/game

##### \`abc1234\` 인물 대사 재생 큐를 추가한다

> 대사를 순서대로 재생하고 겹치지 않게 한다.

변경 파일 2개, +80 -3
- \`src/audio/voice.ts\` added +70 -0
- \`src/audio/mixer.ts\` modified +10 -3

\`src/audio/voice.ts\` diff 발췌:

\`\`\`diff
+export class VoiceQueue {
+  play(line) {}
+}
\`\`\`

##### \`def5678\` 믹서 버스에 voice 채널을 만든다

변경 파일 1개, +12 -1
- \`src/audio/mixer.ts\` modified +12 -1

#### tkddls8848/devlog

##### \`0a1b2c3\` 뉴스 수집기가 실패하면 한 번 재시도한다

변경 파일 1개, +9 -2
- \`news/worker/digest.mjs\` modified +9 -2
`;

const seriesWithAudioThread = {
  version: 1, staleDays: 30, style: { voice: "v", look: "l" },
  threads: {
    "tkddls8848/game": [{
      id: "game-audio", name: "오디오 시스템", status: "open", music: "lofi-1", paths: ["src", "src/audio", "src/audio/mixer.ts"], keywords: ["mixer", "사운드"],
      lastDate: "2026-09-22", lastSummary: "사운드 믹서를 넣었다.", episodes: [{ number: 1, date: "2026-09-22", slug: "2026-09-22-devlog", videoId: "vid1", summary: "사운드 믹서를 넣었다." }],
    }],
  },
};

test("글의 머리말, 본문, 참고 자료를 나눈다", () => {
  const journal = parseJournal(journalText);
  assert.equal(journal.slug, "2026-09-24-devlog");
  assert.equal(journal.status, "published");
  assert.ok(journal.body.startsWith("이틀 전에"));
  assert.ok(!journal.body.includes("안내 주석"));
  assert.ok(journal.reference.includes("### 3. 커밋 근거"));
});

test("커밋 근거를 저장소별 커밋, 파일, diff로 되돌린다", () => {
  const groups = parseEvidence(parseJournal(journalText).reference);
  assert.deepEqual(groups.map((g) => g.repo), ["tkddls8848/game", "tkddls8848/devlog"]);
  const [game] = groups;
  assert.equal(game.commits.length, 2);
  assert.equal(game.commits[0].sha, "abc1234");
  assert.equal(game.commits[0].body, "대사를 순서대로 재생하고 겹치지 않게 한다.");
  assert.deepEqual(game.commits[0].files.map((f) => f.path), ["src/audio/voice.ts", "src/audio/mixer.ts"]);
  assert.equal(game.commits[0].patch.path, "src/audio/voice.ts");
  assert.ok(game.commits[0].patch.text.includes("VoiceQueue"));
  assert.equal(game.commits[1].patch, null);
});

test("커밋 근거가 없으면 세션이 비고 조립을 거부한다", () => {
  assert.deepEqual(parseEvidence("### 1. 질문\n- 없음"), []);
  const journal = parseJournal(journalText.replace(/### 3\. 커밋 근거[\s\S]*$/, ""));
  const episode = planEpisode(journal, { threads: {} });
  assert.equal(episode.sessions.length, 0);
  assert.match(validateEpisode(episode).join("\n"), /저장소 세션이 없습니다/);
});

test("본문 소제목을 파일 이름과 저장소 이름으로 배정한다", () => {
  const journal = parseJournal(journalText);
  const { assigned, unassigned } = assignSections(splitBody(journal.body), parseEvidence(journal.reference));
  assert.deepEqual(assigned["tkddls8848/game"].map((s) => s.heading), ["대사 재생을 audio 믹서에 붙이기"]);
  assert.deepEqual(assigned["tkddls8848/devlog"].map((s) => s.heading), ["뉴스레터 수집 재시도"]);
  assert.deepEqual(unassigned.map((s) => s.heading), [""]);
});

test("경로가 겹치는 열린 스레드로 이어지고, 오래된 스레드는 새로 연다", () => {
  const paths = pathsOf([{ files: [{ path: "src/audio/voice.ts" }] }]);
  assert.deepEqual(paths, ["src", "src/audio", "src/audio/voice.ts"]);
  const hit = matchThread(seriesWithAudioThread, "tkddls8848/game", { paths, keywords: ["voice"], date: "2026-09-24" });
  assert.equal(hit.thread.id, "game-audio");
  assert.equal(matchThread(seriesWithAudioThread, "tkddls8848/game", { paths: ["docs"], keywords: [], date: "2026-09-24" }), null);
  assert.equal(matchThread(seriesWithAudioThread, "tkddls8848/game", { paths, keywords: [], date: "2026-11-30" }), null);
  assert.equal(matchThread(seriesWithAudioThread, "tkddls8848/other", { paths, keywords: [], date: "2026-09-24" }), null);
});

test("키워드는 코드 표기와 조사를 뗀 한국어 단어를 모은다", () => {
  const words = keywordsOf("`mixer`의 버스를 늘렸다. VoiceQueue를 만들었다.");
  assert.ok(words.includes("mixer"));
  assert.ok(words.includes("voicequeue"));
  assert.ok(words.includes("버스"));
});

test("회차 계획은 이어지는 스레드와 새 스레드를 구분하고 빈칸을 남긴다", () => {
  const episode = planEpisode(parseJournal(journalText), seriesWithAudioThread);
  assert.equal(episode.sessions.length, 2);
  const [game, devlog] = episode.sessions;
  assert.deepEqual({ ...game.thread }, { id: "game-audio", name: "오디오 시스템", episode: 2, isNew: false, previousSummary: "사운드 믹서를 넣었다.", previousVideoId: "vid1", music: "lofi-1" });
  assert.equal(devlog.thread.isNew, true);
  assert.equal(devlog.thread.episode, 1);
  assert.deepEqual(game.scenes.map((s) => s.kind), ["title", "clip", "diff"]);
  assert.deepEqual(devlog.scenes.map((s) => s.kind), ["title", "clip"]);
  assert.equal(episode.estimate.clips, 2);
  assert.equal(sceneOrder(episode).length, 7);
  const problems = validateEpisode(episode);
  assert.ok(problems.some((p) => p.includes("opening: narration")));
  assert.ok(problems.some((p) => p.includes("tkddls8848/devlog: thread.name")));
  assert.ok(problems.some((p) => p.includes("배정되지 않은 본문 소제목")));
  assert.match(scriptMarkdown(episode), /오디오 시스템 2화/);
});

function filled() {
  const episode = planEpisode(parseJournal(journalText), seriesWithAudioThread);
  episode.unassigned = [];
  for (const scene of sceneOrder(episode)) { scene.narration = `${scene.id} 내레이션이다. 두 번째 문장이다.`; if (scene.kind === "clip") scene.prompt = "prompt"; }
  Object.assign(episode.sessions[0], { subtitle: "인물 목소리", summary: "대사 큐를 믹서에 얹었다." });
  Object.assign(episode.sessions[1], { subtitle: "수집 재시도", summary: "수집기를 한 번 더 시도하게 했다." });
  episode.sessions[1].thread = { ...episode.sessions[1].thread, id: "devlog-news", name: "뉴스레터 수집기", music: "ambient-2" };
  return episode;
}

test("빈칸을 다 채우면 제목, 설명, 태그가 나온다", () => {
  const episode = filled();
  assert.deepEqual(validateEpisode(episode), []);
  assert.equal(buildTitle(episode), "[game] 오디오 시스템 #2 · [devlog] 뉴스레터 수집기 #1 · 인물 목소리를 오디오 버스에 얹는다");
  const description = buildDescription(episode, [{ title: "오프닝", start: 0 }, { title: "game · 오디오 시스템 2화", start: 12.6, repo: "tkddls8848/game" }]);
  assert.match(description, /^게임의 대사 재생을/);
  assert.match(description, /이전 회차 https:\/\/youtu\.be\/vid1/);
  assert.match(description, /\n0:00 오프닝\n0:12 game · 오디오 시스템 2화\n/);
  assert.match(description, /github\.com\/tkddls8848\/game\/commit\/abc1234/);
  assert.equal(formatTimestamp(3725), "1:02:05");
});

test("업로드 결과를 시리즈 상태에 기록하되 원본은 바꾸지 않는다", () => {
  const episode = filled();
  const before = JSON.stringify(seriesWithAudioThread);
  const next = recordEpisode(seriesWithAudioThread, episode, { videoId: "vid2", chapters: [{ repo: "tkddls8848/game", start: 12 }] });
  assert.equal(JSON.stringify(seriesWithAudioThread), before);
  const audio = next.threads["tkddls8848/game"][0];
  assert.equal(audio.episodes.length, 2);
  assert.deepEqual(audio.episodes[1], { number: 2, date: "2026-09-24", slug: "2026-09-24-devlog", videoId: "vid2", subtitle: "인물 목소리", summary: "대사 큐를 믹서에 얹었다.", start: 12, commits: ["abc1234", "def5678"] });
  assert.equal(audio.lastSummary, "대사 큐를 믹서에 얹었다.");
  assert.ok(audio.paths.includes("src/audio/voice.ts"));
  const news = next.threads["tkddls8848/devlog"][0];
  assert.equal(news.id, "devlog-news");
  assert.equal(news.music, "ambient-2");
  assert.equal(news.episodes[0].number, 1);
  const again = planEpisode(parseJournal(journalText), next);
  assert.equal(again.sessions[1].thread.isNew, false);
  assert.equal(again.sessions[1].thread.episode, 2);
});

test("자막은 문장 길이 비율로 시간을 나눈다", () => {
  const cues = allocateCues("짧다. 이 문장은 조금 더 길다.", 10, 6);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 10);
  assert.ok(cues[0].end < cues[1].end && Math.abs(cues[1].end - 16) < 1e-9);
  assert.match(buildSrt(cues), /^1\n00:00:10,000 --> 00:00:1\d,\d{3}\n짧다\.\n\n2\n/);
});

test("ffmpeg 인자는 클립은 반복하고 제목은 텍스트 파일로 그린다", () => {
  const clip = segmentArgs({ scene: { id: "a", kind: "clip" }, seconds: 7.5, clip: "c.mp4", voice: "v.mp3", textFile: "t.txt", output: "o.mp4" });
  assert.deepEqual(clip.slice(0, 5), ["-stream_loop", "-1", "-i", "c.mp4", "-i"]);
  assert.ok(clip.includes("-t") && clip[clip.indexOf("-t") + 1] === "7.5");
  const title = segmentArgs({ scene: { id: "b", kind: "title" }, seconds: 4, voice: "v.mp3", textFile: "/w/t:x.txt", output: "o.mp4" });
  assert.equal(title[0], "-f");
  assert.match(title[title.indexOf("-vf") + 1], /textfile='\/w\/t\\:x\.txt'/);
  const withMusic = concatArgs({ list: "l.txt", srt: "s.srt", music: "m.mp3", output: "f.mp4" });
  assert.ok(withMusic.join(" ").includes("amix=inputs=2"));
  const noMusic = concatArgs({ list: "l.txt", srt: "s.srt", music: null, output: "f.mp4" });
  assert.ok(!noMusic.join(" ").includes("amix"));
});
