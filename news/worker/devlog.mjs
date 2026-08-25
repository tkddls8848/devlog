import { parseDraft } from "./digest.mjs";

const USER = "tkddls8848";
const BLOG_REPO = `${USER}/devlog`;
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const ignored = [/^merge\s/i, /^revert\s/i, /^(chore|ci)(\(deps\))?:/i, /^bump\s/i, /^(wip|test|tmp|temp|initial commit)$/i, /\[skip ci\]/i];

async function github(path, token) {
  if (!token) throw new Error("Worker secret GITHUB_TOKEN이 등록되지 않았습니다.");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "devlog-worker",
  };
  const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${data.message || path}`);
  return data;
}

function rangesFrom(events) {
  const found = new Map();
  for (const event of events) {
    if (event.type !== "PushEvent" || event.repo?.name === BLOG_REPO || !/^refs\/heads\/(main|master|dev)$/.test(event.payload?.ref || "")) continue;
    const { before, head } = event.payload || {};
    if (!before || !head || /^0+$/.test(before)) continue;
    found.set(`${event.repo.name}:${before}:${head}`, { repo: event.repo.name, before, head, createdAt: event.created_at, commits: event.payload.commits || [], size: Number(event.payload.distinct_size ?? event.payload.size ?? 0) });
  }
  return [...found.values()];
}

function normalize(item, range) {
  const sha = item.sha || item.id;
  const message = String(item.commit?.message || item.message || "").split("\n")[0].trim();
  const author = item.commit?.author?.name || item.author?.login || item.author?.name || "";
  const at = item.commit?.author?.date || item.commit?.committer?.date || range.createdAt;
  if (!sha || item.parents?.length > 1 || !message || ignored.some((pattern) => pattern.test(message)) || /\[bot\]$|^dependabot|^github-actions/i.test(author)) return null;
  return { repo: range.repo, sha, message, day: DAY.format(new Date(at)) };
}

async function collect(env, published) {
  const token = env.GITHUB_TOKEN;
  const events = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await github(`/users/${USER}/events/public?per_page=100&page=${page}`, token);
    events.push(...batch); if (batch.length < 100) break;
  }
  const commits = new Map();
  let partial = false;
  for (const range of rangesFrom(events)) {
    let items = range.commits;
    if (!items.length || items.length < range.size) {
      try { items = (await github(`/repos/${range.repo}/compare/${range.before}...${range.head}`, token)).commits || []; }
      catch { partial = true; }
    }
    for (const item of items) {
      const commit = normalize(item, range);
      if (commit && !published.has(commit.sha)) commits.set(commit.sha, commit);
    }
  }
  return { commits: [...commits.values()], partial };
}

const fallbackDraft = (day, groups) => {
  const total = [...groups.values()].reduce((sum, values) => sum + values.length, 0);
  return { title: `${day} 개발 일지`, summary: `${groups.size}개 저장소의 커밋 ${total}건을 기록했습니다.`, body: [...groups].map(([repo, values]) => `## ${repo}\n\n${values.map((item) => `- ${item.message}`).join("\n")}`).join("\n\n") };
};

async function aiDraft(env, day, groups, fallback) {
  const source = [...groups].map(([repo, values]) => `## ${repo}\n${values.map((item) => `- ${item.message}`).join("\n")}`).join("\n\n");
  const prompt = `다음은 ${day}에 실제로 반영한 커밋입니다. 이를 재료로 개발자가 직접 회고하는 한국어 기술 블로그 글을 작성하세요.

${source}

작성 원칙:
- 커밋 목록을 문장으로 다시 나열하지 말고 서로 관련된 변경을 2~4개의 작업 흐름으로 묶습니다.
- 각 작업 흐름에서 왜 이 작업이 필요했는지, 어떤 문제나 목적이 있었는지 먼저 설명합니다.
- 이어서 무엇을 어떤 방식으로 바꿨는지 구체적으로 기술합니다.
- 커밋에서 결과나 검증이 확인되면 무엇이 잘되었고 어떤 상태가 개선됐는지 씁니다.
- 결과가 커밋에 드러나지 않으면 성공했다고 꾸미지 말고 의도·기대 효과 또는 다음 확인 사항으로 구분합니다.
- 독자가 설계 판단과 작업 맥락을 따라갈 수 있도록 자연스러운 1인칭 기술 블로그 문체를 사용합니다.
- 과장, 홍보 표현, 자료에 없는 원인·수치·장애·성능 개선은 만들지 않습니다.
- 본문은 600~1200자로 쓰고, 의미 있는 소제목은 \"## 소제목\" 형식으로 붙입니다.
- 커밋 링크나 SHA 목록은 본문에 쓰지 않습니다. 참고 커밋은 페이지 하단에서 별도로 표시됩니다.

정확히 다음 형식으로 답하세요.
TITLE: 작업의 핵심을 드러내는 제목
SUMMARY: 목적과 결과를 압축한 한 줄 요약

Markdown 본문`;
  const result = await env.AI.run(env.CF_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast", { messages: [{ role: "system", content: "당신은 구현 맥락과 설계 판단을 독자가 이해하도록 쓰는 시니어 소프트웨어 엔지니어입니다. 제공된 커밋만 근거로 목적, 구현, 확인된 결과를 구분해 1인칭 기술 블로그를 작성하며 사실을 추측하지 않습니다." }, { role: "user", content: prompt }], max_tokens: 1500, temperature: 0.45 });
  const text = String(result?.response ?? result?.choices?.[0]?.message?.content ?? result?.output_text ?? "").trim();
  if (!text) throw new Error("Workers AI가 빈 응답을 반환했습니다.");
  return parseDraft(text, fallback);
}

export async function runDevlog({ env, store, now = new Date() }) {
  const startedAt = new Date(now).toISOString();
  try {
    const { commits, partial } = await collect(env, await store.publishedDevlogShas());
    if (!commits.length) {
      await store.saveDevlogRun({ startedAt, finishedAt: new Date().toISOString(), status: partial ? "partial" : "empty", collectedCount: 0, postCount: 0 });
      return { status: partial ? "partial" : "empty" };
    }
    const days = new Map();
    for (const commit of commits) {
      if (!days.has(commit.day)) days.set(commit.day, new Map());
      const repos = days.get(commit.day); if (!repos.has(commit.repo)) repos.set(commit.repo, []); repos.get(commit.repo).push(commit);
    }
    let postCount = 0;
    for (const [day, groups] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      const fallback = fallbackDraft(day, groups); let draft = fallback; let aiGenerated = false;
      try { draft = await aiDraft(env, day, groups, fallback); aiGenerated = true; } catch (error) { console.warn("개발일지 AI 요약 실패", error); }
      await store.saveDevlogPost({ slug: await store.nextDevlogSlug(day), postDate: day, title: draft.title, summary: draft.summary, bodyMarkdown: draft.body, aiGenerated, publishedAt: new Date(now).toISOString(), commits: [...groups.values()].flat() });
      postCount++;
    }
    await store.saveDevlogRun({ startedAt, finishedAt: new Date().toISOString(), status: partial ? "partial" : "success", collectedCount: commits.length, postCount });
    return { status: partial ? "partial" : "success", postCount };
  } catch (error) {
    await store.saveDevlogRun({ startedAt, finishedAt: new Date().toISOString(), status: "failed", collectedCount: 0, postCount: 0, error: error.message });
    throw error;
  }
}
