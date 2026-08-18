// 뉴스 소스는 RSS 2.0과 Atom이 섞여 있다. 형식마다 파서를 따로 두면 소스를
// 늘릴 때마다 같은 코드를 다시 쓰게 되므로 한 파서가 둘 다 읽는다.
const UA = "news-digest/1.0";

const decode = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) =>
  decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1]);

// Atom은 <link href="…"/>로 주소를 주고, 같은 글에 대체 링크를 여러 개 달기도 한다.
function linkOf(entry) {
  const alternate = entry.match(/<link\b[^>]*\brel=["']alternate["'][^>]*>/i)?.[0];
  const any = alternate || entry.match(/<link\b[^>]*\bhref=["'][^"']+["'][^>]*>/i)?.[0];
  const href = any?.match(/\bhref=["']([^"']+)["']/i)?.[1];
  return decode(href) || tag(entry, "link") || tag(entry, "guid") || tag(entry, "id");
}

export function parseFeed(xml) {
  const blocks = String(xml || "").match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  return blocks.flatMap((entry) => {
    const title = tag(entry, "title");
    const url = linkOf(entry);
    if (!title || !url || !/^https?:\/\//i.test(url)) return [];
    // 날짜가 비거나 깨지면 뒤에서 toISOString이 던진다. flatMap 안이라 그대로
    // 두면 항목 하나 때문에 소스 전체가 실패한다.
    const stamp =
      tag(entry, "pubDate") ||
      tag(entry, "published") ||
      tag(entry, "updated") ||
      tag(entry, "dc:date");
    const at = new Date(stamp);
    if (Number.isNaN(at.getTime())) return [];
    return { title, url, at };
  });
}

// 같은 글이 소스마다 추적 파라미터를 달리 붙여 온다. 중복 판정 전에 걷어낸다.
export function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref_?$|ref_src|source$|cmp$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.protocol = "https:";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname}${path}${url.search}`;
  } catch {
    return String(value).trim();
  }
}

export async function fetchFeed(url, label) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, text/xml" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${label} 피드 ${response.status}`);
  return parseFeed(await response.text());
}

// 소스 모듈은 이 함수 한 줄로 끝난다. 소스별로 다른 건 이름·주소·분류뿐이다.
export function feedSource({ source, kind, url, limit = 8 }) {
  return async function collect() {
    const items = await fetchFeed(url, source);
    return items
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map((item) => ({ source, kind, title: item.title, url: item.url, at: item.at.toISOString() }));
  };
}
