// 뉴스 소스는 RSS 2.0과 Atom이 섞여 있다. 형식마다 파서를 따로 두면 소스를
// 늘릴 때마다 같은 코드를 다시 쓰게 되므로 한 파서가 둘 다 읽는다.
const UA = "news-digest/1.0";

// 잘못된 코드 포인트는 fromCodePoint가 던진다. 항목 하나 때문에 소스 전체가
// 실패하지 않게 못 읽은 참조는 원문 그대로 둔다.
const character = (raw, code) => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return raw;
  }
};

const decode = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    // 숫자 참조(&#8217; &#x2019;)는 &amp;를 푼 뒤에 처리한다. The Verge처럼
    // &amp;#8217;로 두 번 감싸 보내는 피드까지 한 번에 풀린다.
    .replace(/&#(\d+);|&#x([0-9a-f]+);/gi, (raw, dec, hex) =>
      character(raw, dec ? Number(dec) : parseInt(hex, 16))
    )
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
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, text/xml, */*" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${label} 피드 ${response.status} (${url})`);
  const body = await response.text();
  // 개편된 사이트는 없는 피드 자리에 200과 함께 안내 HTML을 준다. 이걸 빈
  // 피드로 받아들이면 다음 후보를 두드려 보지 못한다.
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) {
    throw new Error(`${label} 피드 형식이 아닙니다 (${url})`);
  }
  return parseFeed(body);
}

// 후보를 순서대로 두드려 먼저 응답하는 주소를 쓴다. 피드로 읽히기만 하면
// 항목이 0건이어도 그 주소를 쓴다. 조용한 날과 죽은 주소는 다르고, 0건은
// news-digest가 따로 경고한다.
export function feedSource({ source, kind, urls, limit = 5 }) {
  const candidates = Array.isArray(urls) ? urls : [urls];
  return async function collect() {
    const failures = [];
    for (const url of candidates) {
      let items;
      try {
        items = await fetchFeed(url, source);
      } catch (error) {
        failures.push(error.message);
        continue;
      }
      return items
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((item) => ({ source, kind, title: item.title, url: item.url, at: item.at.toISOString() }));
    }
    throw new Error(`${source} 피드를 찾지 못했습니다: ${failures.join(" / ")}`);
  };
}
