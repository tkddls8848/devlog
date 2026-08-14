export const vendor = "Lenovo";

const decode = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) =>
  decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);

const text = (html) =>
  decode(html.replace(/<\/(li|p|h\d|ul|ol)>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

function latestChange(description) {
  const history = description.slice(description.search(/<h2[^>]*>\s*Change History\s*<\/h2>/i));
  const match = history.match(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/i);
  if (!match) return null;
  const detail = text(match[2]).slice(0, 400);
  return detail ? `${text(match[1])}: ${detail}` : null;
}

export async function collect() {
  const response = await fetch("https://lenovopress.lenovo.com/rss", {
    headers: { "User-Agent": "vendor-watch/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Lenovo RSS ${response.status}`);

  const xml = await response.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).flatMap((item) => {
    const url = tag(item, "link") || tag(item, "guid");
    const title = tag(item, "title");
    if (!url || !title) return [];
    const date = new Date(tag(item, "pubDate")).toISOString().slice(0, 10);
    const description = decode(item.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    const note = latestChange(description);
    const ref = url.match(/\/(lp\d+|ds\d+|tips\d+)/i)?.[1];
    return {
      vendor,
      title,
      url,
      date,
      kind: tag(item, "category") || "기술 문서",
      ...(ref && { ref }),
      ...(note && { note }),
    };
  });
}
