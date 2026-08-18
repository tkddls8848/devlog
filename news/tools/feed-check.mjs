// 피드 주소는 사이트 개편 때 조용히 바뀐다. feeds.mjs의 후보를 전부 두드려
// 어떤 주소가 살아 있는지 한 번에 보여 준다. 수집과 달리 아무것도 저장하지 않는다.
import { feeds } from "./feeds.mjs";
import { fetchFeed } from "./rss.mjs";

const CONCURRENCY = 6;

async function probe(feed) {
  const tried = [];
  for (const url of feed.urls) {
    try {
      const items = await fetchFeed(url, feed.source);
      const newest = items.map((item) => item.at).sort((a, b) => b - a)[0];
      tried.push({
        url,
        ok: true,
        detail: `${items.length}건${newest ? `, 최신 ${newest.toISOString().slice(0, 16)}Z` : ""}`,
      });
      return { ...feed, ok: true, tried };
    } catch (error) {
      tried.push({ url, ok: false, detail: error.message });
    }
  }
  return { ...feed, ok: false, tried };
}

const results = [];
for (let index = 0; index < feeds.length; index += CONCURRENCY) {
  results.push(...(await Promise.all(feeds.slice(index, index + CONCURRENCY).map(probe))));
}

console.log(`피드 후보 점검: 소스 ${feeds.length}곳\n`);
for (const result of results) {
  console.log(`${result.ok ? "✅" : "❌"} ${result.source} (${result.kind})`);
  for (const attempt of result.tried) {
    console.log(`     ${attempt.ok ? "→" : "  "} ${attempt.url}\n        ${attempt.detail}`);
  }
}

const dead = results.filter((result) => !result.ok);
console.log(`\n살아 있는 소스 ${results.length - dead.length}곳, 못 찾은 소스 ${dead.length}곳`);
if (dead.length) {
  console.log(`후보를 다시 정해야 하는 소스: ${dead.map((result) => result.source).join(", ")}`);
  // 하나라도 못 찾으면 실패로 알린다. 조용히 빠진 소스는 알아채기 어렵다.
  process.exitCode = 1;
}
