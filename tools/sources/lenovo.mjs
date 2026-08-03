/**
 * Lenovo Press (서버·스토리지 사전판매 기술 문서)
 *
 * 셋 중 유일하게 공개 RSS 가 있습니다.
 *
 *   GET https://lenovopress.lenovo.com/rss
 *
 * 이 피드의 값어치는 description 안에 들어 있는 <h2>Change History</h2> 입니다.
 * "문서가 갱신됐다" 가 아니라 "이번에 무엇이 바뀌었다" 까지 벤더가 직접
 * 적어 둡니다. 프로세서 추가, 서버 모델 추가처럼 실제 변경 내역이라
 * 요약할 거리가 가장 많은 소스입니다.
 *
 * ⚠️ 피드는 최근 48건만 담는 롤링 창입니다. 폴링을 오래 멈추면 그사이
 *    갱신은 창 밖으로 밀려 사라집니다.
 */

const FEED = "https://lenovopress.lenovo.com/rss";

export const vendor = "Lenovo";

/* ── 아주 작은 RSS 파서 ──────────────────────────────────────────────────
 * 의존성을 늘리지 않으려고 직접 씁니다. 이 피드는 형식이 일정한 RSS 2.0 이라
 * 정규식으로 충분합니다. 임의의 XML 을 다루려는 게 아닙니다.
 */
const decode = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

const stripHtml = (html) =>
  decode(
    String(html || "")
      .replace(/<\/(li|p|h\d|ul|ol)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

/**
 * description 에서 가장 최근 변경 내역 한 덩어리를 꺼냅니다.
 *
 * 구조는 이렇습니다:
 *   <h2>Change History</h2>
 *   <h3>July 31, 2026</h3>   ← 가장 최근
 *   <ul><li>Added the following processor: …</li></ul>
 *   <h3>April 28, 2026</h3>  ← 그 이전 (필요 없음)
 *
 * 첫 <h3> 블록만 취합니다. 전부 넣으면 몇 년치 이력이 통째로 들어옵니다.
 */
function latestChange(description) {
  const at = description.search(/<h2[^>]*>\s*Change History\s*<\/h2>/i);
  if (at === -1) return null;

  const rest = description.slice(at);
  // 첫 <h3>제목</h3> 과, 다음 <h3> 이 나오기 전까지의 내용.
  const m = rest.match(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/i);
  if (!m) return null;

  const when = stripHtml(m[1]);
  const what = stripHtml(m[2]);
  if (!what) return null;

  // 너무 길면 프롬프트와 화면 양쪽에서 부담입니다.
  const trimmed = what.length > 400 ? `${what.slice(0, 400)}…` : what;
  return when ? `${when}: ${trimmed}` : trimmed;
}

export async function collect() {
  const res = await fetch(FEED, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; vendor-watch/1.0)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Lenovo RSS ${res.status}`);

  const xml = await res.text();
  const out = [];

  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const link = tag(block, "link") || tag(block, "guid");
    const title = tag(block, "title");
    if (!link || !title) continue;

    const pub = tag(block, "pubDate");
    const parsed = pub ? new Date(pub) : null;
    const date =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const description = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";
    const note = latestChange(decode(description));

    out.push({
      vendor,
      title,
      url: link,
      date,
      kind: tag(block, "category") || "기술 문서",
      tag: null,
      // lp1262 같은 문서 번호가 주소 끝에 붙습니다. 사람이 알아보는 식별자입니다.
      ref: link.match(/\/(lp\d+|ds\d+|tips\d+)/i)?.[1] || null,
      note,
      id: link.replace(/^https?:\/\/[^/]+\//, ""),
      /*
       * 같은 문서가 갱신되면 pubDate 가 새로 찍혀 다시 피드에 올라옵니다.
       * 주소만으로 보면 그 갱신을 "이미 본 것" 으로 지나치므로 날짜를 함께 봅니다.
       */
      fingerprint: `${link}:${date}`,
    });
  }

  return out;
}
