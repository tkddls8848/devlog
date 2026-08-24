export const source = "Hacker News";
export const kind = "커뮤니티";

// 프론트페이지 API는 지금 걸린 글만 준다. 하루 한 번 도는 수집기가 놓치지 않게
// 시간 범위로 검색하고, 점수로 잡담을 걸러 낸다.
const LIMIT = 10;

export async function collect(since, { minPoints = 100 } = {}) {
  const cutoff = Math.floor(since.getTime() / 1000);
  const response = await fetch(
    "https://hn.algolia.com/api/v1/search?tags=story" +
      `&numericFilters=created_at_i>${cutoff},points>${Number(minPoints)}&hitsPerPage=${LIMIT}`,
    {
      headers: { Accept: "application/json", "User-Agent": "news-digest/1.0" },
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok) throw new Error(`Hacker News API ${response.status}`);

  const hits = (await response.json()).hits;
  if (!Array.isArray(hits)) throw new Error("Hacker News 응답에 hits가 없습니다.");

  return hits.flatMap((hit) => {
    const title = String(hit.title || "").trim();
    const at = new Date(hit.created_at);
    if (!title || !hit.objectID || Number.isNaN(at.getTime())) return [];
    const comments = Number(hit.num_comments || 0);
    return {
      source,
      kind,
      title,
      // Ask HN·Show HN 텍스트 글에는 외부 주소가 없다. 토론 페이지로 보낸다.
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      at: at.toISOString(),
      note: `${Number(hit.points || 0)} points · 댓글 ${comments}`,
    };
  });
}
