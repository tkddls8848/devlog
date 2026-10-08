// 뉴스와 아카이브는 2026-10에 specsheet Worker로 옮겼다. 옛 링크와 RSS 구독이
// 끊기지 않게 같은 경로·쿼리로 영구 이동시킨다.
export const SPECSHEET_ORIGIN = "https://specsheet.tkddls8848.workers.dev";

const MOVED = [/^\/feed\.xml$/, /^\/archive\/?$/, /^\/archive\/.+/, /^\/issues\/[^/]+\/?$/];

const redirect = (location) =>
  new Response(null, { status: 301, headers: { location, "cache-control": "public, max-age=86400" } });

export function movedResponse(url) {
  if (url.pathname === "/" || url.pathname === "") return redirect("/devlog/");
  if (MOVED.some((pattern) => pattern.test(url.pathname))) return redirect(`${SPECSHEET_ORIGIN}${url.pathname}${url.search}`);
  return null;
}
