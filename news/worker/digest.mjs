import { feeds } from "../tools/feeds.mjs";
import { feedSource, normalizeUrl } from "../tools/rss.mjs";
import * as hackernews from "../tools/sources/hackernews.mjs";

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const integer = (value, fallback, { min = 1, max = 1000 } = {}) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export function configFromEnv(env = {}) {
  return {
    model: env.CF_AI_MODEL || DEFAULT_MODEL,
    windowHours: integer(env.NEWS_WINDOW_HOURS, 24, { max: 168 }),
    perSource: integer(env.NEWS_PER_SOURCE, 3, { max: 20 }),
    maxItems: integer(env.NEWS_MAX_ITEMS, 30, { max: 90 }),
    hnMinPoints: integer(env.HN_MIN_POINTS, 100, { min: 0, max: 100000 }),
  };
}

export function configuredSources(config) {
  return [
    {
      source: hackernews.source,
      kind: hackernews.kind,
      collect: (since) => hackernews.collect(since, { minPoints: config.hnMinPoints }),
    },
    ...feeds.map((feed) => ({
      source: feed.source,
      kind: feed.kind,
      collect: feedSource({ ...feed, limit: config.perSource }),
    })),
  ];
}

export async function collectAll(sources, since, logger = console) {
  const settled = await Promise.allSettled(sources.map((source) => source.collect(since)));
  const items = [];
  const failed = [];
  settled.forEach((result, index) => {
    const name = sources[index].source;
    if (result.status === "fulfilled") {
      logger.log(`${name}: ${result.value.length}건 수집`);
      if (!result.value.length) logger.warn(`${name}가 글을 하나도 돌려주지 않았습니다.`);
      items.push(...result.value);
    } else {
      const message = result.reason?.message || String(result.reason);
      logger.warn(`${name} 수집 실패, 다른 소스는 계속 처리합니다: ${message}`);
      failed.push({ source: name, message });
    }
  });
  return { items, failed };
}

export function selectCandidates(items, since) {
  const seen = new Set();
  const fresh = [];
  for (const item of items) {
    const at = new Date(item.at);
    if (Number.isNaN(at.getTime()) || at < since) continue;
    const normalizedUrl = normalizeUrl(item.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    fresh.push({ ...item, at: at.toISOString(), normalizedUrl });
  }
  return fresh.sort((a, b) => b.at.localeCompare(a.at));
}

export function groupBySource(fresh, sources, config) {
  const groups = new Map();
  for (const item of fresh) {
    if (!groups.has(item.source)) groups.set(item.source, []);
    const entries = groups.get(item.source);
    if (entries.length < config.perSource) entries.push(item);
  }

  const kept = new Set(
    [...groups.values()]
      .flat()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, config.maxItems)
      .map((item) => item.normalizedUrl)
  );

  return sources.flatMap((source) => {
    const entries = (groups.get(source.source) || [])
      .filter((item) => kept.has(item.normalizedUrl))
      .map(({ normalizedUrl: _, ...item }) => item);
    return entries.length ? [{ source: source.source, kind: source.kind, entries }] : [];
  });
}

export const countEntries = (sources) =>
  sources.reduce((sum, source) => sum + source.entries.length, 0);

export function buildPrompt(day, grouped) {
  const headlines = grouped
    .map(
      (group) =>
        `## ${group.source} (${group.kind})\n${group.entries.map((entry) => `- ${entry.title}`).join("\n")}`
    )
    .join("\n\n");
  return (
    `다음은 ${day}에 모은 IT 업계 뉴스와 블로그 headline입니다. 비슷한 주제끼리 3~5개 갈래로 묶어 ` +
    `한국어 뉴스레터 본문을 쓰세요. headline에 없는 사실, 추측, 홍보 표현, 단순 나열은 넣지 말고 ` +
    `400~800자로 작성하세요. 각 갈래는 "## 소제목"으로 시작합니다.\n\n${headlines}\n\n` +
    `정확히 다음 형식으로 답하세요.\nTITLE: 제목\nSUMMARY: 한 줄 요약\n\nMarkdown 본문`
  );
}

export function fallbackDraft(day, grouped) {
  const body = grouped
    .map(
      (group) =>
        `## ${group.source}\n\n${group.entries.map((entry) => `- [${entry.title}](${entry.url})`).join("\n")}`
    )
    .join("\n\n");
  return {
    title: `${day} IT 뉴스 다이제스트`,
    summary: `출처 ${grouped.length}곳에서 소식 ${countEntries(grouped)}건을 모았습니다.`,
    body,
  };
}

export function parseDraft(text, fallback = {}) {
  const clean = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const lines = clean.split(/\r?\n/);
  const titleAt = lines.findIndex((line) => /^TITLE\s*:/i.test(line.trimStart()));
  const summaryAt = lines.findIndex((line) => /^SUMMARY\s*:/i.test(line.trimStart()));
  const valueAt = (index) => lines[index]?.replace(/^[^:]+:\s*/, "").trim();
  const markerAt = Math.max(titleAt, summaryAt);
  const parsedBody = (markerAt >= 0 ? lines.slice(markerAt + 1) : lines)
    .join("\n")
    .replace(/^(?:\s*(?:-{3,}|\*{3,}|_{3,})\s*\n)+/, "")
    .trim();
  const draft = {
    title: valueAt(titleAt) || fallback.title,
    summary: valueAt(summaryAt) || fallback.summary,
    body: (markerAt >= 0 ? parsedBody : fallback.body || parsedBody) || fallback.body,
  };
  if (!draft.title || !draft.summary || !draft.body) {
    throw new Error("AI 응답에서 제목, 요약 또는 본문을 찾지 못했습니다.");
  }
  return draft;
}

async function generate(ai, model, prompt) {
  const result = await ai.run(model, {
    messages: [
      {
        role: "system",
        content:
          "자료에 없는 내용을 만들지 않는 한국어 기술 뉴스레터 편집자입니다. 받은 headline 밖의 사실을 덧붙이지 않습니다.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 1200,
    temperature: 0.3,
  });
  const text = String(
    result?.response ??
      result?.choices?.[0]?.message?.content ??
      result?.choices?.[0]?.text ??
      result?.output_text ??
      ""
  ).trim();
  if (!text) throw new Error("Workers AI가 빈 응답을 반환했습니다.");
  return text;
}

export async function runDigest({ env, store, now = new Date(), sources, logger = console }) {
  const startedAt = new Date(now).toISOString();
  const config = configFromEnv(env);
  const sourceList = sources || configuredSources(config);
  const since = new Date(new Date(now).getTime() - config.windowHours * 3600 * 1000);
  const day = DAY.format(new Date(now));

  await store.ensureLegacyIssues();
  logger.log(`IT 뉴스 수집 중 (최근 ${config.windowHours}시간, ${since.toISOString()} 이후)`);
  const { items, failed } = await collectAll(sourceList, since, logger);
  const baseRun = {
    startedAt,
    sinceAt: since.toISOString(),
    collectedCount: items.length,
    failedSources: failed.map((item) => item.source),
  };

  if (failed.length === sourceList.length) {
    const error = "모든 뉴스 소스 수집에 실패했습니다.";
    await store.saveRun({ ...baseRun, finishedAt: new Date().toISOString(), status: "failed", error });
    throw new Error(error);
  }

  const candidates = selectCandidates(items, since);
  const published = await store.publishedLinks(candidates.map((item) => item.normalizedUrl));
  const fresh = candidates.filter((item) => !published.has(item.normalizedUrl));
  const grouped = groupBySource(fresh, sourceList, config);
  const selectedCount = countEntries(grouped);
  logger.log(`수집 ${items.length}건, 창 안의 미발행 소식 ${fresh.length}건, 뉴스레터에 담을 ${selectedCount}건`);

  if (!grouped.length) {
    await store.saveRun({
      ...baseRun,
      finishedAt: new Date().toISOString(),
      status: failed.length ? "partial" : "empty",
      selectedCount: 0,
      error: failed.length ? failed.map((item) => `${item.source}: ${item.message}`).join(" | ") : null,
    });
    return { status: failed.length ? "partial" : "empty", issue: null, failed };
  }

  const fallback = fallbackDraft(day, grouped);
  let draft = fallback;
  let aiGenerated = false;
  try {
    draft = parseDraft(await generate(env.AI, config.model, buildPrompt(day, grouped)), fallback);
    aiGenerated = true;
  } catch (error) {
    logger.warn(`AI 요약 실패, 링크 목록으로 발행합니다: ${error.message}`);
  }

  const slug = await store.nextSlug(day);
  const issue = {
    slug,
    issueDate: day,
    title: draft.title,
    summary: draft.summary,
    bodyMarkdown: draft.body,
    aiGenerated,
    sources: grouped,
    publishedAt: new Date(now).toISOString(),
  };
  const status = failed.length ? "partial" : "success";
  await store.saveIssue(issue, {
    ...baseRun,
    finishedAt: new Date().toISOString(),
    status,
    error: failed.length ? failed.map((item) => `${item.source}: ${item.message}`).join(" | ") : null,
  });
  logger.log(`${slug} 발행 완료 (${selectedCount}건, ${aiGenerated ? config.model : "fallback"})`);
  return { status, issue, failed };
}
