// 개발 일지 한 편을 유튜브 회차로 바꾸는 순수 함수 모음. 파일과 네트워크를 만지지 않으므로
// 테스트가 그대로 돈다. 글 파싱 형식은 news/tools/devlog-journal.mjs의 pull 결과와 같다.

import { isPrivateAlias, privateDisplayName } from "../../shared/devlog-privacy.mjs";

export const REFERENCE_MARKER = "<!-- devlog:reference 이 줄 아래는 참고 자료이며 발행되지 않습니다. -->";
export const SITE_URL = "https://devlog.tkddls8848.workers.dev";

// 장면 종류별 기본 길이(초). 실제 길이는 보이스오버 길이에 맞춰 조립 단계에서 정해진다.
export const SCENE_SECONDS = { title: 4, clip: 10, diff: 8 };

export const shortRepo = (repo) => privateDisplayName(String(repo || "").split("/").pop());
export const slugify = (text) => String(text || "").toLowerCase().normalize("NFKC")
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "thread";

// ---------------------------------------------------------------- 글 파싱

export function parseJournal(text) {
  const source = String(text).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const front = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!front) throw new Error("파일 맨 앞의 --- 머리말을 찾지 못했습니다.");
  const meta = {};
  for (const line of front[1].split("\n")) {
    const match = line.match(/^([a-z]+):\s*(.*)$/i);
    if (!match) continue;
    const raw = match[2].trim();
    meta[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  const rest = source.slice(front[0].length);
  const markerAt = rest.indexOf(REFERENCE_MARKER);
  const body = (markerAt >= 0 ? rest.slice(0, markerAt) : rest).replace(/<!--[\s\S]*?-->/g, "").trim();
  const reference = markerAt >= 0 ? rest.slice(markerAt + REFERENCE_MARKER.length).trim() : "";
  return {
    slug: String(meta.slug || "").trim(), date: String(meta.date || "").trim(), status: String(meta.status || "").trim(),
    title: String(meta.title || "").trim(), summary: String(meta.summary || "").trim(), body, reference,
  };
}

// 참고 자료의 '커밋 근거'를 저장소별로 되돌린다. 형식은 shared/devlog-writing.mjs journalEvidence.
// 같은 날 수집이 여러 번 이어 붙으면 '커밋 근거'도 여러 번 나오므로 모두 읽고 저장소별로 합친다.
export function parseEvidence(reference) {
  const text = String(reference || "");
  const sections = [...text.matchAll(/^### 3\. 커밋 근거\s*$/gm)].map((match) => {
    const rest = text.slice(match.index + match[0].length);
    const end = rest.search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end);
  });
  const groups = [];
  const byRepo = new Map();
  for (const block of sections.flatMap((section) => section.split(/\n(?=#### )/))) {
    const header = block.match(/^#### (\S+)/);
    if (!header) continue;
    const commits = [];
    for (const chunk of block.split(/\n(?=##### )/).slice(1)) {
      const head = chunk.match(/^##### `([0-9a-f]+)` (.*)$/m);
      if (!head) continue;
      const files = [...chunk.matchAll(/^- `([^`]+)` (\w+) \+(\d+) -(\d+)$/gm)]
        .map((m) => ({ path: m[1], status: m[2], additions: Number(m[3]), deletions: Number(m[4]) }));
      const fence = chunk.match(/`([^`]+)` diff 발췌:\n\n(`{3,})diff\n([\s\S]*?)\n\2/);
      const bodyMatch = chunk.match(/^> ([\s\S]*?)(?:\n\n|$)/m);
      commits.push({
        sha: head[1], subject: head[2].trim(),
        body: bodyMatch ? bodyMatch[1].split("\n").map((line) => line.replace(/^> ?/, "")).join("\n").trim() : "",
        files, patch: fence ? { path: fence[1], text: fence[3] } : null,
      });
    }
    if (!commits.length) continue;
    const existing = byRepo.get(header[1]);
    if (!existing) {
      const group = { repo: header[1], commits };
      byRepo.set(header[1], group);
      groups.push(group);
    } else {
      const known = new Set(existing.commits.map((commit) => commit.sha));
      existing.commits.push(...commits.filter((commit) => !known.has(commit.sha)));
    }
  }
  return groups;
}

export function splitBody(body) {
  const lines = String(body || "").split("\n");
  const sections = [];
  let current = { heading: "", text: [] };
  for (const line of lines) {
    const heading = line.match(/^## (.+)$/);
    if (heading) { sections.push(current); current = { heading: heading[1].trim(), text: [] }; }
    else current.text.push(line);
  }
  sections.push(current);
  return sections.map((section) => ({ heading: section.heading, text: section.text.join("\n").trim() })).filter((s) => s.heading || s.text);
}

// ---------------------------------------------------------------- 저장소 세션

const basename = (file) => String(file).split("/").pop().replace(/\.[^.]+$/, "");

export function repoTokens(group) {
  const tokens = new Set([shortRepo(group.repo).toLowerCase()]);
  for (const commit of group.commits) {
    for (const file of commit.files) {
      const name = basename(file.path).toLowerCase();
      if (name.length >= 4) tokens.add(name);
      for (const dir of file.path.split("/").slice(0, -1)) if (dir.length >= 4 && !/^(src|lib|test|tests|tools|docs)$/.test(dir)) tokens.add(dir.toLowerCase());
    }
  }
  return [...tokens];
}

// 본문 소제목을 커밋이 있는 저장소에 배정한다. 근거가 없으면 unassigned로 남겨 사람이 정한다.
export function assignSections(sections, groups) {
  const tokensByRepo = groups.map((group) => ({ repo: group.repo, tokens: repoTokens(group) }));
  const assigned = Object.fromEntries(groups.map((group) => [group.repo, []]));
  const unassigned = [];
  for (const section of sections) {
    // The editor writes one "## <repo>" part per project; that heading decides outright.
    const named = groups.find((group) => shortRepo(group.repo).toLowerCase() === section.heading.toLowerCase());
    if (named) { assigned[named.repo].push(section); continue; }
    const haystack = `${section.heading}\n${section.text}`.toLowerCase();
    let best = null;
    for (const { repo, tokens } of tokensByRepo) {
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      if (score > 0 && (!best || score > best.score)) best = { repo, score };
    }
    if (best) assigned[best.repo].push(section); else unassigned.push(section);
  }
  return { assigned, unassigned };
}

export function pathsOf(commits) {
  const paths = new Set();
  for (const commit of commits) for (const file of commit.files) {
    const parts = file.path.split("/");
    paths.add(file.path);
    if (parts.length > 1) paths.add(parts[0]);
    if (parts.length > 2) paths.add(parts.slice(0, 2).join("/"));
  }
  return [...paths].sort();
}

const STOP = new Set(["이번", "그날", "작업", "변경", "코드", "파일", "함수", "부분", "경우", "이후", "때문", "그리고", "하지만", "정리", "확인", "추가", "수정"]);

export function keywordsOf(text) {
  const found = new Map();
  const add = (word) => { const key = word.toLowerCase(); found.set(key, (found.get(key) || 0) + 1); };
  for (const match of String(text || "").matchAll(/`([^`\n]{2,60})`/g)) add(match[1].trim());
  for (const match of String(text || "").matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,}/g)) add(match[0]);
  for (const match of String(text || "").matchAll(/[가-힣]{2,}/g)) {
    const word = match[0].replace(/(을|를|이|가|은|는|의|에|로|와|과|도|만|에서|으로|했다|한다|하는|이다)$/, "");
    if (word.length >= 2 && !STOP.has(word)) add(word);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([word]) => word);
}

// ---------------------------------------------------------------- 시리즈 판정

export function isStale(thread, date, staleDays = 30) {
  if (!thread.lastDate) return false;
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${thread.lastDate}T00:00:00Z`)) / 86_400_000;
  return gap > staleDays;
}

// 경로가 겹치면 같은 작업 흐름일 가능성이 높고, 키워드는 보조 근거다. 점수 2 미만이면 새 스레드.
export function matchThread(series, repo, { paths, keywords, date }) {
  const threads = (series.threads?.[repo] || []).filter((thread) => thread.status !== "closed" && !isStale(thread, date, series.staleDays));
  let best = null;
  for (const thread of threads) {
    const pathHits = paths.filter((path) => (thread.paths || []).includes(path)).length;
    const keywordHits = keywords.filter((word) => (thread.keywords || []).includes(word)).length;
    const score = pathHits * 2 + keywordHits;
    if (score >= 2 && (!best || score > best.score)) best = { thread, score };
  }
  return best;
}

// ---------------------------------------------------------------- 회차 계획

const scene = (id, kind, extra = {}) => ({ id, kind, seconds: SCENE_SECONDS[kind], narration: null, prompt: kind === "clip" ? null : undefined, ...extra });

export function planEpisode(journal, series) {
  const groups = parseEvidence(journal.reference);
  const { assigned, unassigned } = assignSections(splitBody(journal.body), groups);
  const sessions = groups.map((group, index) => {
    const sections = assigned[group.repo];
    const paths = pathsOf(group.commits);
    const keywords = keywordsOf([...sections.map((s) => `${s.heading}\n${s.text}`), ...group.commits.map((c) => `${c.subject}\n${c.body}`)].join("\n"));
    const match = matchThread(series, group.repo, { paths, keywords, date: journal.date });
    const thread = match
      ? { id: match.thread.id, name: match.thread.name, episode: match.thread.episodes.length + 1, isNew: false, previousSummary: match.thread.lastSummary || "", previousVideoId: match.thread.episodes.at(-1)?.videoId || "", music: match.thread.music || null }
      : { id: null, name: null, episode: 1, isNew: true, previousSummary: "", previousVideoId: "", music: null };
    const prefix = `s${index + 1}`;
    const scenes = [scene(`${prefix}-title`, "title", { text: `${shortRepo(group.repo)}` })];
    const topics = sections.length ? sections : [{ heading: group.commits[0].subject, text: group.commits.map((c) => c.subject).join("\n") }];
    topics.slice(0, 3).forEach((topic, i) => scenes.push(scene(`${prefix}-clip${i + 1}`, "clip", { topic: topic.heading })));
    const patch = group.commits.find((commit) => commit.patch)?.patch;
    if (patch) scenes.push(scene(`${prefix}-diff`, "diff", { text: `${patch.path}\n\n${patch.text.split("\n").slice(0, 18).join("\n")}` }));
    return {
      repo: group.repo, thread, paths, keywords, sections,
      commits: group.commits.map(({ sha, subject, body, files }) => ({ sha, subject, body, files: files.map((f) => f.path) })),
      scenes,
    };
  });
  const seconds = [SCENE_SECONDS.title * 2, ...sessions.flatMap((s) => s.scenes.map((x) => x.seconds))].reduce((a, b) => a + b, 0);
  return {
    slug: journal.slug, date: journal.date, title: journal.title, summary: journal.summary,
    postUrl: `${SITE_URL}/devlog/posts/${journal.slug}/`,
    style: series.style || {},
    opening: scene("opening", "title", { text: journal.title }),
    ending: scene("ending", "title", { text: "다음 회차에 계속" }),
    sessions, unassigned,
    estimate: { clips: sessions.reduce((n, s) => n + s.scenes.filter((x) => x.kind === "clip").length, 0), voiceovers: 2 + sessions.reduce((n, s) => n + s.scenes.length, 0), seconds },
  };
}

export function sceneOrder(episode) {
  return [episode.opening, ...episode.sessions.flatMap((session) => session.scenes), episode.ending];
}

// 조립 전에 사람이나 Claude가 채워야 할 빈칸을 모두 찾는다.
export function validateEpisode(episode) {
  const problems = [];
  if (!episode.sessions?.length) problems.push("저장소 세션이 없습니다. 커밋 근거가 없는 글은 영상으로 만들지 않습니다.");
  if (episode.unassigned?.length) problems.push(`저장소에 배정되지 않은 본문 소제목 ${episode.unassigned.length}개가 있습니다. sessions[].sections로 옮기고 unassigned를 비우세요.`);
  for (const session of episode.sessions || []) {
    if (!session.thread?.name) problems.push(`${session.repo}: thread.name이 비었습니다.`);
    if (session.thread?.isNew && !session.thread.id) problems.push(`${session.repo}: 새 스레드의 thread.id가 비었습니다.`);
    if (!session.thread?.music) problems.push(`${session.repo}: thread.music(배경 음악 설명 또는 Artlist 자산 ID)이 비었습니다.`);
    if (!session.subtitle) problems.push(`${session.repo}: subtitle(회차 부제)이 비었습니다.`);
    if (!session.summary) problems.push(`${session.repo}: summary(다음 회차의 '지난 이야기'용 요약)가 비었습니다.`);
  }
  for (const item of sceneOrder(episode)) {
    if (!item.narration) problems.push(`${item.id}: narration이 비었습니다.`);
    if (item.kind === "clip" && !item.prompt) problems.push(`${item.id}: prompt가 비었습니다.`);
  }
  return problems;
}

// ---------------------------------------------------------------- 게시 정보

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function buildTitle(episode) {
  if (episode.style?.layout === "minimal") return episode.title.slice(0, 100);
  const parts = episode.sessions.map((session) => `[${shortRepo(session.repo)}] ${session.thread.name} #${session.thread.episode}`);
  const subtitle = episode.sessions.length === 1 ? episode.sessions[0].subtitle : episode.title;
  return `${parts.join(" · ")} · ${subtitle}`.slice(0, 100);
}

export function buildDescription(episode, chapters) {
  const lines = [episode.summary, "", `글: ${episode.postUrl}`, ""];
  for (const session of episode.sessions) {
    lines.push(`${shortRepo(session.repo)} · ${session.thread.name} ${session.thread.episode}화${session.thread.previousVideoId ? ` · 이전 회차 https://youtu.be/${session.thread.previousVideoId}` : ""}`);
  }
  lines.push("", "챕터");
  for (const chapter of chapters) lines.push(`${formatTimestamp(chapter.start)} ${chapter.title}`);
  lines.push("", "커밋");
  for (const session of episode.sessions.filter((s) => !isPrivateAlias(s.repo) && s.visibility !== "private")) for (const commit of session.commits) lines.push(`https://github.com/${session.repo}/commit/${commit.sha} ${commit.subject}`);
  return lines.join("\n").slice(0, 5000);
}

export function buildTags(episode) {
  const tags = new Set(["개발일지", "devlog", "포트폴리오"]);
  for (const session of episode.sessions) { tags.add(shortRepo(session.repo)); tags.add(session.thread.name); }
  return [...tags].filter(Boolean).slice(0, 30);
}

export const playlistTitle = (repo) => `${shortRepo(repo)} 개발 일지`;

// 업로드 결과를 시리즈 상태에 기록한다. 원본을 바꾸지 않고 새 객체를 돌려준다.
export function recordEpisode(series, episode, { videoId, chapters = [] }) {
  const next = structuredClone(series);
  next.threads ||= {};
  for (const session of episode.sessions) {
    const list = (next.threads[session.repo] ||= []);
    let thread = list.find((item) => item.id === session.thread.id);
    if (!thread) {
      thread = { id: session.thread.id || slugify(`${shortRepo(session.repo)}-${session.thread.name}`), name: session.thread.name, status: "open", music: session.thread.music, paths: [], keywords: [], episodes: [] };
      list.push(thread);
    }
    thread.name = session.thread.name;
    thread.music ||= session.thread.music;
    thread.paths = [...new Set([...thread.paths, ...session.paths])].sort();
    thread.keywords = [...new Set([...session.keywords, ...thread.keywords])].slice(0, 80);
    thread.lastDate = episode.date;
    thread.lastSummary = session.summary;
    const chapter = chapters.find((item) => item.repo === session.repo);
    thread.episodes.push({ number: thread.episodes.length + 1, date: episode.date, slug: episode.slug, videoId, subtitle: session.subtitle, summary: session.summary, start: chapter?.start ?? 0, commits: session.commits.map((c) => c.sha) });
  }
  return next;
}

// ---------------------------------------------------------------- 자막

export function splitSentences(text) {
  return String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?。])\s+/).filter(Boolean);
}

// 장면 하나의 내레이션을 문장 단위로 나눠 글자 수 비율로 시간을 배분한다.
export function allocateCues(narration, start, seconds) {
  const sentences = splitSentences(narration);
  const total = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
  let at = start;
  return sentences.map((sentence) => {
    const length = (sentence.length / total) * seconds;
    const cue = { start: at, end: at + length, text: sentence };
    at += length;
    return cue;
  });
}

const srtTime = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), rest = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rest).padStart(3, "0")}`;
};

// libass breaks Korean lines between any two syllables, so wrap at spaces ourselves.
export function wrapLine(text, max = 26) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function buildSrt(cues, { maxLine = 26 } = {}) {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${wrapLine(cue.text, maxLine)}\n`).join("\n");
}

// 내레이션(자막)은 원래 표기를 두고, 음성 합성에는 한국어 개발자가 읽는 발음으로 바꿔 보낸다.
// 영어 철자를 그대로 주면 TTS가 원어민 억양으로 굴리거나 약어를 글자 단위로 읽는다(RAG → 알에이지).
export function speechText(text, lexicon = []) {
  let speech = String(text || "");
  // Longer terms first so "local RAG" wins over "RAG".
  for (const [term, reading] of [...lexicon].sort((a, b) => b[0].length - a[0].length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundary = /^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9])" : "";
    const end = /[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9])" : "";
    speech = speech.replace(new RegExp(`${boundary}${escaped}${end}`, "gi"), reading);
  }
  return speech;
}

// ---------------------------------------------------------------- 장과 게시 정보

// seconds: 장면 id → 그 장면이 화면에 머무는 초. 조립기(ffmpeg)와 렌더러(Blender)가 함께 쓴다.
export function buildChapters(episode, seconds) {
  const owner = new Map();
  episode.sessions.forEach((session) => session.scenes.forEach((scene) => owner.set(scene.id, session)));
  const chapters = [];
  let at = 0;
  for (const scene of sceneOrder(episode)) {
    const session = owner.get(scene.id);
    if (scene.id === "opening") chapters.push({ title: "오프닝", start: 0 });
    else if (session && scene.id === session.scenes[0]?.id) chapters.push({ title: scene.label || `${shortRepo(session.repo)} · ${session.thread.name} ${session.thread.episode}화`, start: at, repo: session.repo });
    else if (scene.id === "ending") chapters.push({ title: episode.style?.layout === "minimal" ? "마무리" : "다음 회차", start: at });
    at += seconds.get(scene.id);
  }
  return { chapters, total: at };
}

export function buildMetadata(episode, chapters, { file, seconds }) {
  return {
    title: buildTitle(episode), description: buildDescription(episode, chapters), tags: buildTags(episode),
    playlists: [...new Set(episode.sessions.map((session) => playlistTitle(session.repo)))],
    categoryId: "28", defaultLanguage: "ko", privacy: "private", file, seconds: Math.round(seconds), chapters,
  };
}

// ---------------------------------------------------------------- Blender 사양

// 밝은 배경 위에서 저장소마다 구분되는 강조색(선형 RGB가 아니라 화면 sRGB 값).
export const ACCENTS = [[0.05, 0.55, 0.62], [0.39, 0.40, 0.95], [0.91, 0.45, 0.16], [0.13, 0.62, 0.36], [0.85, 0.24, 0.47], [0.2, 0.47, 0.85]];
export const THEME = { background: [0.965, 0.972, 0.984], ink: [0.06, 0.09, 0.16], muted: [0.28, 0.33, 0.41], paper: [1, 1, 1] };

const clipText = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// 장면별 화면 구성과 자막 시각. 편집한 제목·요약이 있으면 우선 사용하고,
// 이전 회차는 커밋 제목 표시를 유지한다. 내레이션 문장은 하단 자막으로 쓴다.
export function buildSpec(episode, seconds, { width = 1280, height = 720, fps = 24, font, fontBold, maxLine = 44 } = {}) {
  const owner = new Map();
  episode.sessions.forEach((session, index) => session.scenes.forEach((scene) => owner.set(scene.id, { session, index })));
  const scenes = [];
  let start = 0;
  for (const scene of sceneOrder(episode)) {
    const frames = Math.max(1, Math.round(seconds.get(scene.id) * fps));
    const found = owner.get(scene.id);
    const accent = ACCENTS[(found?.index ?? ACCENTS.length - 1) % ACCENTS.length];
    const cues = allocateCues(scene.narration, 0, frames).map((cue) => ({ text: wrapLine(cue.text, maxLine), start: Math.round(cue.start), end: Math.round(cue.end) }));
    const base = { start, frames, accent, cues, chips: [], subtitle: "", label: scene.label || "", note: scene.note || "" };
    if (!found) {
      const opening = scene.id === "opening";
      scenes.push({ ...base, kind: "title", kicker: opening ? episode.date : "마무리", title: scene.text || episode.title, subtitle: scene.subtitle ?? (opening ? episode.sessions.map((s) => shortRepo(s.repo)).join(" · ") : "") });
    } else {
      const { session } = found;
      const kicker = `${shortRepo(session.repo)} · ${session.thread.name} ${session.thread.episode}화`;
      if (scene.kind === "title") scenes.push({ ...base, kind: "title", kicker, title: scene.text || shortRepo(session.repo), subtitle: session.subtitle || "" });
      else {
        // Spread the session's commits over its content scenes, at most three chips each.
        const content = session.scenes.filter((item) => item.kind !== "title");
        const slot = content.indexOf(scene);
        const per = Math.ceil(session.commits.length / content.length);
        const mine = session.commits.slice(slot * per, slot * per + per).slice(0, 3);
        const points = Array.isArray(scene.points) ? scene.points.slice(0, 3) : mine.map((commit) => commit.subject);
        const chips = points.map((text, i) => ({ text: clipText(text, 30), at: Math.min(frames - 1, Math.max(0, Math.round(6 + (i * (frames - 12)) / Math.max(1, points.length)))) }));
        scenes.push({ ...base, kind: "clip", kicker, title: scene.text || session.subtitle || shortRepo(session.repo), chips });
      }
    }
    start += frames;
  }
  return { width, height, fps, frames: start, font, fontBold, layout: episode.style?.layout || "minimal", theme: THEME, scenes };
}

// video/.env의 KEY=VALUE를 읽어 셸에 없는 값만 채운다.
export function parseEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}
