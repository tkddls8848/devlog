const DAY = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Seoul",
});
const CLOCK = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const inlineMarkdown = (value) => {
  const raw = String(value || "");
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let output = "";
  let offset = 0;
  for (const match of raw.matchAll(pattern)) {
    output += escapeHtml(raw.slice(offset, match.index));
    output += `<a href="${escapeHtml(match[2])}" rel="noopener">${escapeHtml(match[1])}</a>`;
    offset = match.index + match[0].length;
  }
  return output + escapeHtml(raw.slice(offset));
};

export function markdownToHtml(markdown) {
  const output = [];
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) output.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    const item = line.match(/^\s*-\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (item) {
      flushParagraph();
      list.push(item[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return output.join("\n");
}

const themeToggle = `<button type="button" class="theme-toggle" id="theme-toggle" aria-label="라이트/다크 모드 전환">
  <svg class="icon icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
  <svg class="icon icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
</button>`;

const siteFromEnv = (env) => ({
  title: "devlog news",
  tagline: "IT 업계 뉴스와 엔지니어링 블로그를 하루 한 편으로 묶는 뉴스레터",
  githubUser: "tkddls8848",
  devlogUrl: env.DEVLOG_URL || "https://tkddls8848.github.io/devlog/",
  archiveUrl: env.ARCHIVE_URL || "https://tkddls8848.github.io/devlog/archive/",
});

function layout({ env, title, summary, current = "", content, canonical = "" }) {
  const site = siteFromEnv(env);
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title ? `${escapeHtml(title)} · ` : ""}${site.title}</title>
    <meta name="description" content="${escapeHtml(summary || site.tagline)}" />
    <meta name="color-scheme" content="light dark" />
    ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : ""}
    <link rel="alternate" type="application/rss+xml" title="${site.title}" href="/feed.xml" />
    <link rel="stylesheet" href="/assets/css/theme.css" />
    <link rel="stylesheet" href="/assets/css/main.css" />
    <script src="/assets/js/theme-init.js"></script>
  </head>
  <body>
    <header class="site-header">
      <div class="site-brand"><a class="site-title" href="/">${site.title}</a><p class="site-tagline">${site.tagline}</p></div>
      <div class="site-controls">
        <nav class="site-nav" aria-label="주요">
          <a href="${escapeHtml(site.devlogUrl)}">개발 일지</a>
          <a href="${escapeHtml(site.archiveUrl)}">아카이브</a>
          <a href="/"${current === "home" ? ' aria-current="page"' : ""}>뉴스레터</a>
        </nav>
        ${themeToggle}
      </div>
    </header>
    <main>${content}</main>
    <footer class="site-footer"><p>© ${new Date().getFullYear()} ${site.githubUser} · <a href="https://github.com/${site.githubUser}">GitHub</a> · <a href="/feed.xml">RSS</a></p></footer>
    <script src="/assets/js/theme-toggle.js"></script>
  </body>
</html>`;
}

export function renderHome(issues, env, origin) {
  const rows = issues.length
    ? issues
        .map(
          (issue) => `<li>
      <time datetime="${escapeHtml(issue.published_at)}">${DAY.format(new Date(issue.published_at))}</time>
      <a href="/issues/${encodeURIComponent(issue.slug)}/">${escapeHtml(issue.title)}</a>
      ${issue.summary ? `<p>${escapeHtml(issue.summary)}</p>` : ""}
      <p class="meta">소식 ${Number(issue.entry_count)}건 · ${Number(issue.source_count)}곳</p>
    </li>`
        )
        .join("\n")
    : '<li class="empty">아직 발행된 뉴스레터가 없습니다.</li>';
  const content = `<p class="page-intro">IT 업계 뉴스와 엔지니어링 블로그에서 하루치 소식을 모아 한 편으로 묶은 뉴스레터입니다. 수집·생성·저장·서비스는 Cloudflare에서 실행됩니다.</p>
<ul class="post-list">${rows}</ul>`;
  return layout({ env, summary: "매일 발행되는 IT 뉴스 다이제스트", current: "home", content, canonical: `${origin}/` });
}

export function renderIssue(issue, env, origin) {
  const sources = issue.sources
    .map(
      (group) => `<h3>${escapeHtml(group.source)}${group.kind ? ` <span class="meta">${escapeHtml(group.kind)}</span>` : ""}</h3>
      <ul class="links">${group.entries
        .map(
          (entry) => `<li><a href="${escapeHtml(entry.url)}" rel="noopener">${escapeHtml(entry.title)}</a><span class="meta"><time datetime="${escapeHtml(entry.at)}">${CLOCK.format(new Date(entry.at))}</time>${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</span></li>`
        )
        .join("")}</ul>`
    )
    .join("\n");
  const content = `<article class="post">
  <header class="post-header">
    <h1>${escapeHtml(issue.title)}</h1>
    <p class="post-meta"><time datetime="${escapeHtml(issue.published_at)}">${DAY.format(new Date(issue.published_at))}</time><span>소식 ${Number(issue.entry_count)}건 · 출처 ${Number(issue.source_count)}곳</span>${issue.ai_generated ? '<span class="badge">AI 생성</span>' : ""}</p>
    ${issue.summary ? `<p class="post-summary">${escapeHtml(issue.summary)}</p>` : ""}
  </header>
  ${markdownToHtml(issue.body_markdown)}
  <section class="sources"><h2>오늘 읽은 소식</h2>${sources}</section>
  <p class="back"><a href="/">← 뉴스레터</a></p>
</article>`;
  return layout({
    env,
    title: issue.title,
    summary: issue.summary,
    content,
    canonical: `${origin}/issues/${encodeURIComponent(issue.slug)}/`,
  });
}

export function renderNotFound(env) {
  return layout({
    env,
    title: "찾을 수 없는 주소",
    content: '<p class="page-intro">이 주소에 해당하는 뉴스레터가 없습니다. <a href="/">발행된 이슈 목록</a>에서 찾아보세요.</p>',
  });
}

const escapeXml = escapeHtml;

export function renderFeed(issues, origin) {
  const items = issues
    .map(
      (issue) => `<item><title>${escapeXml(issue.title)}</title><link>${origin}/issues/${encodeURIComponent(issue.slug)}/</link><guid isPermaLink="true">${origin}/issues/${encodeURIComponent(issue.slug)}/</guid><pubDate>${new Date(issue.published_at).toUTCString()}</pubDate><description>${escapeXml(issue.summary)}</description></item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>devlog news</title><link>${origin}/</link><description>매일 발행되는 IT 뉴스 다이제스트</description><language>ko</language>${items}</channel></rss>`;
}
