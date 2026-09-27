import { journalReference, commitDetails, addRepoHeadings, evidenceFromReference } from "../../shared/devlog-writing.mjs";
import { writePost } from "./devlog-writer.mjs";
import { privateAlias, privateWorkSummary, publicationGroups } from "../../shared/devlog-privacy.mjs";

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
  return { repo: range.repo, sha, message, description: String(item.commit?.message || item.message || "").slice(0, 1800), day: DAY.format(new Date(at)) };
}

async function collect(env, published, now) {
  const token = env.GITHUB_TOKEN;
  const events = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await github(`/users/${USER}/events/public?per_page=100&page=${page}`, token);
    events.push(...batch); if (batch.length < 100) break;
  }
  const commits = new Map();
  let partial = false;
  const visibility = new Map();
  for (const range of rangesFrom(events)) {
    // A formerly public repository can now be private. Never infer current
    // visibility from an old event, and skip when metadata cannot be verified.
    let repo;
    try {
      if (!visibility.has(range.repo)) visibility.set(range.repo, await github(`/repos/${range.repo}`, token));
      repo = visibility.get(range.repo);
      if (typeof repo.private !== "boolean") throw new Error("Unknown visibility");
    } catch { partial = true; continue; }
    let items = range.commits;
    if (!items.length || items.length < range.size) {
      try { items = (await github(`/repos/${range.repo}/compare/${range.before}...${range.head}`, token)).commits || []; }
      catch { partial = true; }
    }
    for (const item of items) {
      const commit = normalize(item, range);
      if (commit && !published.has(commit.sha)) {
        commit.visibility = repo.private ? "private" : "public";
        if (repo.private) {
          commit.publicRepo = await privateAlias(repo.id);
          commit.publicSha = (await privateAlias(commit.sha)).slice(-12);
          commit.message = privateWorkSummary(commit.message);
          commit.publicMessage = commit.message;
          delete commit.description;
        }
        commits.set(commit.sha, commit);
      }
    }
  }
  // Public event feeds omit private pushes. Query owned private repositories with
  // the authenticated token and read their default branch over a bounded lookback.
  const lookback = Math.min(90, Math.max(1, Number(env.DEVLOG_PRIVATE_LOOKBACK_DAYS) || 7));
  const since = new Date(new Date(now).getTime() - lookback * 86400000).toISOString();
  try {
    for (let page = 1; page <= 10; page++) {
      const repos = await github(`/user/repos?visibility=private&affiliation=owner&per_page=100&page=${page}`, token);
      if (!Array.isArray(repos)) throw new Error("Invalid repository list");
      for (const repo of repos) {
        if (repo.private !== true || repo.owner?.login !== USER || repo.full_name === BLOG_REPO || repo.archived || repo.disabled) continue;
        const alias = await privateAlias(repo.id);
        try {
          for (let p = 1; p <= 10; p++) {
            const items = await github(`/repos/${repo.full_name}/commits?sha=${encodeURIComponent(repo.default_branch)}&since=${encodeURIComponent(since)}&per_page=100&page=${p}`, token);
            if (!Array.isArray(items)) throw new Error("Invalid commit list");
            for (const item of items) {
              const commit = normalize(item, { repo: repo.full_name, createdAt: now });
              if (!commit || published.has(commit.sha)) continue;
              commit.visibility = "private";
              commit.publicRepo = alias;
              commit.publicSha = (await privateAlias(item.sha)).slice(-12);
              commit.message = privateWorkSummary(commit.message);
              commit.publicMessage = commit.message;
              delete commit.description;
              commits.set(commit.sha, commit);
            }
            if (items.length < 100) break;
            if (p === 10) partial = true;
          }
        } catch { partial = true; }
      }
      if (repos.length < 100) break;
      if (page === 10) partial = true;
    }
  } catch { partial = true; }
  return { commits: [...commits.values()], partial };
}

export async function runDevlog({ env, store, now = new Date() }) {
  const startedAt = new Date(now).toISOString();
  try {
    const { commits, partial } = await collect(env, await store.publishedDevlogShas(), now);
    for (const commit of commits) {
      if (commit.visibility === "private") commit.publicRepo = await store.privateRepoAlias(commit.publicRepo);
    }
    if (!commits.length) {
      await store.saveDevlogRun({ startedAt, finishedAt: new Date().toISOString(), status: partial ? "partial" : "empty", collectedCount: 0, postCount: 0 });
      return { status: partial ? "partial" : "empty" };
    }
    // Bound extra GitHub requests per run; missing details never block the draft.
    for (const commit of [...commits].filter((c) => c.visibility !== "private").sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12)) {
      try { commit.details = commitDetails(await github(`/repos/${commit.repo}/commits/${commit.sha}`, env.GITHUB_TOKEN)); }
      catch (error) { console.warn(`커밋 상세 조회 생략: ${commit.repo}/${commit.sha}`, error.message); }
    }
    const days = new Map();
    for (const commit of commits) {
      if (!days.has(commit.day)) days.set(commit.day, new Map());
      const repos = days.get(commit.day); if (!repos.has(commit.repo)) repos.set(commit.repo, []); repos.get(commit.repo).push(commit);
    }
    let postCount = 0;
    const collectedAt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(now));
    const autoPublish = String(env.DEVLOG_AUTO_PUBLISH ?? "true") !== "false";
    for (const [day, groups] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      const safeGroups = publicationGroups(groups);
      const existing = await store.findDevlogDraft(day);
      // The AI writes the post unless the author already started writing this day's draft.
      const untouched = !existing || !String(existing.body_markdown || "").replace(/^##\s+.*$/gm, "").trim();
      let post = null;
      if (untouched) {
        const all = new Map(existing ? evidenceFromReference(existing.reference_markdown) : []);
        for (const [repo, commits] of safeGroups) all.set(repo, [...(all.get(repo) || []).filter((old) => !commits.some((c) => c.sha.startsWith(old.sha))), ...commits]);
        try { post = await writePost(env, day, all); } catch (error) { console.warn("개발 기록 자동 작성 실패, 소제목만 둔 초안으로 남깁니다", error); }
      }
      await store.saveDevlogDraft({
        slug: existing?.slug || await store.nextDevlogSlug(day), existing, postDate: day, createdAt: new Date(now).toISOString(),
        ...(post
          ? { title: post.title, summary: post.summary, bodyMarkdown: post.body, aiGenerated: true, status: autoPublish ? "published" : "draft" }
          // One "## <repo>" part per project; a later run only adds repos the body lacks.
          : { bodyMarkdown: addRepoHeadings(existing?.body_markdown || "", [...safeGroups.keys()]) }),
        referenceMarkdown: journalReference({ day, groups: safeGroups, notes: post ? null : "", collectedAt }), commits: [...groups.values()].flat(),
      });
      postCount++;
    }
    await store.saveDevlogRun({ startedAt, finishedAt: new Date().toISOString(), status: partial ? "partial" : "success", collectedCount: commits.length, postCount });
    return { status: partial ? "partial" : "success", postCount };
  } catch (error) {
    await store.saveDevlogRun({ startedAt, finishedAt: new Date().toISOString(), status: "failed", collectedCount: 0, postCount: 0, error: error.message });
    throw error;
  }
}
