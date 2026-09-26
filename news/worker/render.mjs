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
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let output = "";
  let offset = 0;
  for (const match of raw.matchAll(pattern)) {
    output += escapeHtml(raw.slice(offset, match.index));
    if (match[1] !== undefined) output += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2] !== undefined) output += `<strong>${escapeHtml(match[2])}</strong>`;
    else output += `<a href="${escapeHtml(match[4])}" rel="noopener">${escapeHtml(match[3])}</a>`;
    offset = match.index + match[0].length;
  }
  return output + escapeHtml(raw.slice(offset));
};

export function markdownToHtml(markdown, { headingIds = false } = {}) {
  const output = [];
  let paragraph = [];
  let list = [];
  let quote = [];
  let code = null;
  let fence = "";
  let headingIndex = 0;
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) output.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushQuote = () => {
    if (quote.length) output.push(`<blockquote>${quote.join("\n").split(/\n{2,}/).map((part) => `<p>${inlineMarkdown(part.replace(/\n/g, " "))}</p>`).join("")}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (const line of String(markdown || "").split(/\r?\n/)) {
    // A fence closes only on a run at least as long as the one that opened it,
    // so a ```` block can quote ``` inside (diff excerpts in journal references).
    const marks = line.match(/^(`{3,})/)?.[1];
    if (code !== null) {
      if (marks && marks.length >= fence.length && !line.slice(marks.length).trim()) { output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (marks) { flushAll(); code = []; fence = marks; continue; }
    const heading = line.match(/^(#{2,6})\s+(.+)$/);
    const item = line.match(/^\s*-\s+(.+)$/);
    const quoted = line.match(/^>\s?(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      // Only h2/h3 feed the table of contents.
      output.push(`<h${level}${headingIds && level <= 3 ? ` id="section-${++headingIndex}"` : ""}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
    } else if (item) {
      flushParagraph();
      flushQuote();
      list.push(item[1]);
    } else if (!line.trim()) {
      flushAll();
    } else {
      flushList();
      flushQuote();
      paragraph.push(line.trim());
    }
  }
  flushAll();
  if (code !== null) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
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

export function layout({ env, title, summary, current = "", content, canonical = "", wide = false, scripts = [], robots = "" }) {
  const site = siteFromEnv(env);
  const isDevlog = current === "devlog";
  if (isDevlog) { site.title = "devlog"; site.tagline = "코드의 변화에서 설계의 이유를 찾는 개발 기록"; }
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title ? `${escapeHtml(title)} · ` : ""}${site.title}</title>
    <meta name="description" content="${escapeHtml(summary || site.tagline)}" />
    <meta name="color-scheme" content="light dark" />
    ${robots ? `<meta name="robots" content="${escapeHtml(robots)}" />` : ""}
    ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : ""}
    <link rel="alternate" type="application/rss+xml" title="${site.title}" href="/feed.xml" />
    <link rel="stylesheet" href="/assets/css/theme.css" />
    <link rel="stylesheet" href="/assets/css/main.css" />
    ${isDevlog ? '<link rel="stylesheet" href="/assets/css/devlog.css" />' : ""}
    <script src="/assets/js/theme-init.js"></script>
  </head>
  <body${isDevlog ? ' class="devlog-page"' : wide ? ' class="wide"' : ""}>
    ${isDevlog ? '<a class="skip-link" href="#main-content">본문으로 건너뛰기</a>' : ""}
    <header class="site-header">
      <div class="site-header-inner">
        <a class="site-title" href="${isDevlog ? '/devlog/' : '/'}"><span class="site-mark" aria-hidden="true"></span>${site.title}</a>
        <nav class="site-nav" aria-label="주요">
          <a href="${escapeHtml(site.devlogUrl)}"${current === "devlog" ? ' aria-current="page"' : ""}>개발 일지</a>
          <a href="${escapeHtml(site.archiveUrl)}"${current === "archive" ? ' aria-current="page"' : ""}>아카이브</a>
          <a href="/"${current === "home" ? ' aria-current="page"' : ""}>뉴스레터</a>
        </nav>
        ${themeToggle}
      </div>
    </header>
    <main id="main-content">${content}</main>
    <footer class="site-footer">
      <div class="site-footer-inner">
        <p class="site-tagline">${site.tagline}</p>
        <p>© ${new Date().getFullYear()} ${site.githubUser} · <a href="https://github.com/${site.githubUser}">GitHub</a> · <a href="/feed.xml">RSS</a></p>
      </div>
    </footer>
    <script src="/assets/js/theme-toggle.js"></script>
    ${isDevlog ? '<script src="/assets/js/devlog.js" defer></script>' : ""}
    ${scripts.map((src) => `<script src="${escapeHtml(src)}" defer></script>`).join("")}
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

export function renderArchive(records, env, origin) {
  const vendors = ["IBM", "Lenovo", "HPE", "Dell", "NetApp", "Oracle"];
  const counts = Object.fromEntries(vendors.map((vendor) => [vendor, records.filter((record) => record.vendor === vendor).length]));
  // Every collected vendor keeps its chip, even before its first document lands.
  const vendorButtons = vendors.map((vendor) => `<button type="button" class="archive-chip" data-vendor="${escapeHtml(vendor)}" aria-pressed="false"><span class="vendor-icon vendor-icon-${vendor.toLowerCase()}" aria-hidden="true">${escapeHtml(vendor)}</span><span>${escapeHtml(vendor)}</span><strong>${counts[vendor]}</strong></button>`).join("");
  const rows = records.map((record) => `<tr data-vendor="${escapeHtml(record.vendor)}">
    <td class="col-date"><time datetime="${escapeHtml(record.document_date)}">${escapeHtml(record.document_date)}</time></td>
    <td class="col-vendor"><span class="vendor-icon vendor-icon-${escapeHtml(record.vendor.toLowerCase())}" role="img" aria-label="${escapeHtml(record.vendor)}">${escapeHtml(record.vendor)}</span></td>
    <td class="col-doc"><a href="${escapeHtml(record.url)}" rel="noopener">${escapeHtml(record.title)}</a>
      <span class="meta">${escapeHtml(record.kind)}${record.tag ? ` · ${escapeHtml(record.tag)}` : ""}${record.ref ? ` · <code>${escapeHtml(record.ref)}</code>` : ""}</span>
      ${record.note ? `<p class="archive-note">${escapeHtml(record.note)}</p>` : ""}</td>
  </tr>`).join("");
  const content = `<p class="page-intro">IBM · Lenovo · HPE · Dell · NetApp · Oracle 제품 문서에서 관측한 갱신입니다. Cloudflare Cron이 매일 09:25 KST에 수집하고 D1에 저장합니다.</p>
  <div class="archive-filters"><input type="search" id="archive-query" placeholder="제목 · 문서번호 검색" aria-label="문서 검색" /><div class="archive-chips" role="group" aria-label="벤더 선택"><button type="button" class="archive-chip is-on" data-vendor="" aria-pressed="true"><span class="vendor-icon vendor-icon-all" aria-hidden="true">ALL</span><span>전체</span><strong>${records.length}</strong></button>${vendorButtons}</div></div>
  <p class="archive-count" id="archive-count">${records.length}건</p>
  <div class="archive-table-wrap"><table class="archive-table"><thead><tr><th class="col-date">날짜</th><th class="col-vendor">벤더</th><th class="col-doc">문서</th></tr></thead><tbody id="archive-rows">${rows || '<tr><td colspan="3">아직 수집된 문서가 없습니다.</td></tr>'}</tbody></table></div>
  <p class="archive-empty" id="archive-empty" hidden>조건에 맞는 문서가 없습니다. 새로 추가한 벤더는 다음 수집(매일 09:25 KST)부터 채워집니다.</p>
  <script>(()=>{const q=document.getElementById('archive-query'),rows=[...document.querySelectorAll('#archive-rows tr[data-vendor]')],count=document.getElementById('archive-count'),empty=document.getElementById('archive-empty'),chips=[...document.querySelectorAll('.archive-chip')];let vendor='';const apply=()=>{const term=q.value.trim().toLowerCase();let n=0;for(const row of rows){const show=(!vendor||row.dataset.vendor===vendor)&&(!term||row.textContent.toLowerCase().includes(term));row.hidden=!show;if(show)n++}count.textContent=n+'건';if(empty)empty.hidden=n!==0||!rows.length};q?.addEventListener('input',apply);for(const chip of chips)chip.addEventListener('click',()=>{vendor=chip.dataset.vendor;for(const item of chips){const active=item===chip;item.classList.toggle('is-on',active);item.setAttribute('aria-pressed',String(active))}apply()});apply()})()</script>`;
  return layout({ env, title: "벤더 문서 아카이브", summary: "IBM, Lenovo, HPE, Dell, NetApp, Oracle 제품 문서 아카이브", current: "archive", content, canonical: `${origin}/archive/`, wide: true });
}

export function renderDevlogHome(posts, env, origin, { admin = false } = {}) {
  const rows = posts.map((post, index) => `<li class="journal-card${index === 0 ? ' journal-featured' : ''}" data-journal-entry>
    <div class="journal-card-meta"><span>${index === 0 ? 'LATEST ENTRY' : 'DEVELOPMENT LOG'}</span><time datetime="${escapeHtml(post.post_date)}">${DAY.format(new Date(post.post_date))}</time></div>
    <h3><a href="/devlog/posts/${encodeURIComponent(post.slug)}/">${escapeHtml(post.title)}</a></h3>
    ${post.summary ? `<p>${escapeHtml(post.summary)}</p>` : ""}
    <div class="journal-card-bottom"><span>${post.ai_generated ? '이전 AI 자동 기록' : '작업 회고'}</span><span class="journal-read">글 읽기 <span aria-hidden="true">↗</span></span></div>
  </li>`).join("");
  const content = `<section class="journal-hero" aria-labelledby="journal-title">
    <p class="journal-eyebrow">ENGINEERING JOURNAL <span> / </span> @tkddls8848</p>
    <h1 id="journal-title">코드를 바꾸고,<br /><span>생각을 남깁니다.</span></h1>
    <p class="journal-description">무엇을 만들었는지에서 한 걸음 더.<br />커밋에 담긴 구현과 설계의 선택, 다음에 확인할 것들을 기록합니다.</p>
    <a class="journal-github" href="https://github.com/tkddls8848">GitHub에서 코드 보기 <span aria-hidden="true">↗</span></a>
    ${admin ? '<p class="journal-owner"><a class="journal-owner-link" href="/devlog/admin/">글 관리 · 새 글 쓰기</a></p>' : ""}
  </section>
  <div class="journal-layout"><section aria-labelledby="entries-title">
    <div class="journal-toolbar"><h2 id="entries-title">개발 기록 <span>${posts.length}</span></h2><label class="journal-search"><span class="visually-hidden">글 제목과 요약 검색</span><input id="journal-query" type="search" placeholder="제목과 요약 검색" /></label></div>
    <p class="visually-hidden" id="journal-count" role="status" aria-live="polite">${posts.length}편의 기록</p>
    <ul class="journal-list">${rows}</ul>
    <div class="journal-empty" id="journal-empty"${posts.length ? ' hidden' : ''}><h3>${posts.length ? '검색 결과가 없습니다.' : '첫 번째 기록을 기다리고 있습니다.'}</h3><p>${posts.length ? '다른 키워드로 제목과 요약을 검색해 보세요.' : '공개 저장소의 새로운 커밋이 모이면 이곳에 개발 기록이 쌓입니다.'}</p></div>
  </section>
  <aside class="journal-sidebar"><div class="journal-about"><span class="journal-avatar" aria-hidden="true">&lt;/&gt;</span><p class="journal-eyebrow">BEHIND THE CODE</p><h2>변경 너머의 맥락</h2><p>작동하는 코드를 만드는 일과 그 이유를 설명하는 일. 이곳에는 두 가지를 함께 남깁니다.</p><dl><dt>01 / 구현</dt><dd>실제 코드에서 확인한 변화</dd><dt>02 / 판단</dt><dd>설계의 의미와 유지보수 비용</dd><dt>03 / 회고</dt><dd>남은 질문과 다음 검증</dd></dl></div><p class="journal-note">그날의 커밋을 옆에 두고 직접 쓴 작업 회고입니다. 각 글 하단에서 근거가 된 커밋을 함께 확인할 수 있습니다.</p></aside></div>`;
  return layout({ env, title: "개발 기록", summary: "커밋에 담긴 구현, 설계 판단과 다음 검증을 기록하는 기술 블로그", current: "devlog", content, canonical: `${origin}/devlog/` });
}

export function renderDevlogPost(post, env, origin, { admin = false } = {}) {
  const groups = new Map();
  for (const commit of post.commits || []) {
    if (!groups.has(commit.repo)) groups.set(commit.repo, []);
    groups.get(commit.repo).push(commit);
  }
  const sources = [...groups].map(([repo, commits]) => `<h3><a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a></h3><ul>${commits.map((commit) => `<li><a href="https://github.com/${escapeHtml(repo)}/commit/${escapeHtml(commit.sha)}"><code>${escapeHtml(commit.sha.slice(0, 7))}</code></a> ${escapeHtml(commit.message)}</li>`).join("")}</ul>`).join("");
  const body = markdownToHtml(post.body_markdown, { headingIds: true });
  const headings = [...body.matchAll(/<h([23]) id="(section-\d+)">([\s\S]*?)<\/h\1>/g)];
  const toc = headings.map((heading) => `<li class="toc-level-${heading[1]}"><a href="#${heading[2]}">${heading[3].replace(/<[^>]*>/g, "")}</a></li>`).join("");
  const readingMinutes = Math.max(1, Math.ceil(String(post.body_markdown || "").length / 500));
  const content = `<a class="journal-back" href="/devlog/">← 모든 개발 기록</a><div class="journal-article-layout"><article class="post journal-post"><header class="post-header"><p class="journal-eyebrow">ENGINEERING JOURNAL${admin ? ` · <a class="journal-owner-link" href="/devlog/admin/posts/${encodeURIComponent(post.slug)}/">이 글 수정</a>` : ""}</p><h1>${escapeHtml(post.title)}</h1><p class="post-meta"><time datetime="${escapeHtml(post.post_date)}">${DAY.format(new Date(post.post_date))}</time><span>약 ${readingMinutes}분 읽기</span><span>커밋 ${(post.commits || []).length}개 · 저장소 ${groups.size}개</span>${post.ai_generated ? '<span class="badge">이전 AI 자동 기록</span>' : '<span class="badge">작업 회고</span>'}</p>${post.summary ? `<p class="post-summary">${escapeHtml(post.summary)}</p>` : ""}</header><div class="journal-prose">${body}</div>${post.ai_generated ? '<p class="journal-disclosure">직접 쓰는 작업 회고로 바꾸기 전에 AI가 공개 커밋을 바탕으로 자동 작성한 글입니다. 설계 해석과 다음 확인 사항은 실제 구현·검증 결과와 구분해 읽어 주세요.</p>' : ''}${sources ? `<section class="sources journal-sources" id="references"><h2>이 글의 근거</h2><details><summary>참고한 커밋 ${(post.commits || []).length}개 펼쳐 보기</summary>${sources}</details></section>` : ""}<p class="back"><a href="/devlog/">← 개발 기록 목록</a></p></article>${toc ? `<aside class="journal-toc"><nav aria-label="글 목차"><p class="journal-eyebrow">ON THIS PAGE</p><ol>${toc}${sources ? '<li><a href="#references">이 글의 근거</a></li>' : ''}</ol></nav></aside>` : ''}</div>`;
  return layout({ env, title: post.title, summary: post.summary, current: "devlog", content, canonical: `${origin}/devlog/posts/${encodeURIComponent(post.slug)}/` });
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
