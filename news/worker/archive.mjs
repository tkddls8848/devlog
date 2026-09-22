import { collectHpe } from "../../shared/vendor-hpe.mjs";
import { collectDell } from "./archive-dell.mjs";

const TIMEOUT = (ms) => AbortSignal.timeout(ms);
const IBM_LABELS = {
  hardware: "하드웨어", software: "소프트웨어", services: "서비스", withdrawal: "판매 종료",
  statementofdirection: "방향성 발표", rpq: "RPQ",
};
const USER_AGENT = "devlog-archive/1.0";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IBM_HOME = "https://www.ibm.com/docs/announcements";
const IBM_CLOUD_FEED = "https://cloud.ibm.com/status/api/notifications/feed.rss";

const browserHeaders = (referer, accept = "*/*") => ({
  Accept: accept,
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: referer,
  "User-Agent": BROWSER_USER_AGENT,
});

const xmlDecode = (value) => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
const xmlTag = (xml, name) => xmlDecode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
const htmlText = (html) => xmlDecode(html.replace(/<\/(li|p|h\d|ul|ol)>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function collectIbm(region = "AP") {
  const officialUrl = `https://www.ibm.com/docs/api/v1/announcement/all?region=${encodeURIComponent(region)}`;
  let items;
  try {
    const response = await fetch(officialUrl, {
      headers: browserHeaders(IBM_HOME, "application/json, text/plain, */*"),
      redirect: "follow",
      signal: TIMEOUT(40_000),
    });
    if (!response.ok) throw new Error(`IBM Docs API ${response.status}`);
    items = await response.json();
    if (!Array.isArray(items)) throw new Error("IBM Docs API 응답이 배열이 아닙니다.");
  } catch (docsError) {
    // IBM Docs의 Akamai가 Cloudflare egress를 차단할 때도 IBM 공식 데이터만 사용한다.
    // Cloud Status RSS의 announcement 항목은 제품 변경·종료 공지를 지속 제공한다.
    const response = await fetch(IBM_CLOUD_FEED, {
      headers: browserHeaders("https://cloud.ibm.com/status/announcement", "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"),
      redirect: "follow",
      signal: TIMEOUT(40_000),
    });
    if (!response.ok) throw new Error(`${docsError.message}; IBM Cloud RSS ${response.status}`);
    const xml = await response.text();
    const records = (xml.match(/<item>[\s\S]*?<\/item>/g) || []).flatMap((item) => {
      if (xmlTag(item, "category") !== "announcement") return [];
      const title = xmlTag(item, "title");
      const url = xmlTag(item, "link");
      const published = new Date(xmlTag(item, "pubDate"));
      if (!title || !url || Number.isNaN(published.getTime())) return [];
      const ref = xmlTag(item, "guid");
      const note = htmlText(xmlTag(item, "description")).slice(0, 400);
      return [{ vendor: "IBM", title, url, date: published.toISOString().slice(0, 10), kind: "IBM Cloud 공지", tag: "Cloud",
        ...(ref ? { ref } : {}), ...(note ? { note } : {}) }];
    });
    if (!records.length) throw new Error(`${docsError.message}; IBM Cloud RSS 공지가 없습니다.`);
    return records;
  }
  return items.flatMap((item) => {
    if (item.internalOnly || !item.urlKey || !item.name || !/^\d{4}-\d{2}-\d{2}/.test(String(item.announcementDate))) return [];
    const tag = IBM_LABELS[String(item.rfaType || "").toLowerCase()];
    return [{ vendor: "IBM", title: item.name.trim(), url: `https://www.ibm.com/docs/en/announcements/${item.urlKey}`,
      date: String(item.announcementDate).slice(0, 10), kind: item.type === "salesManual" ? "세일즈 매뉴얼" : "공고",
      ...(tag ? { tag } : {}), ...(item.globalLetterNumber ? { ref: item.globalLetterNumber } : {}) }];
  });
}

async function collectLenovo() {
  const response = await fetch("https://lenovopress.lenovo.com/rss", { headers: { "User-Agent": USER_AGENT }, signal: TIMEOUT(30_000) });
  if (!response.ok) throw new Error(`Lenovo RSS ${response.status}`);
  const xml = await response.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).flatMap((item) => {
    const url = xmlTag(item, "link") || xmlTag(item, "guid");
    const title = xmlTag(item, "title");
    const published = new Date(xmlTag(item, "pubDate"));
    if (!url || !title || Number.isNaN(published.getTime())) return [];
    const description = xmlDecode(item.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    const history = description.slice(description.search(/<h2[^>]*>\s*Change History\s*<\/h2>/i));
    const changed = history.match(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/i);
    const detail = changed ? htmlText(changed[2]).slice(0, 400) : "";
    const note = changed && detail ? `${htmlText(changed[1])}: ${detail}` : null;
    const ref = url.match(/\/(lp\d+|ds\d+|tips\d+)/i)?.[1];
    return [{ vendor: "Lenovo", title, url, date: published.toISOString().slice(0, 10), kind: xmlTag(item, "category") || "기술 문서",
      ...(ref ? { ref } : {}), ...(note ? { note } : {}) }];
  });
}

export async function runArchive({ env, store, now = new Date() }) {
  const startedAt = now.toISOString();
  const sources = [
    ["IBM", () => collectIbm(env.IBM_REGION || "AP")], ["Lenovo", collectLenovo], ["HPE", collectHpe],
    ["Dell", async () => collectDell({ knownUrls: await store.listDellDocumentUrls() })],
  ];
  const settled = await Promise.allSettled(sources.map(([, collect]) => collect()));
  const failedSources = [];
  const records = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const value = result.value;
      records.push(...(Array.isArray(value) ? value : value.records));
      if (value.report) {
        console.log("벤더 수집 결과", JSON.stringify(value.report));
        if (value.report.status !== "success") failedSources.push(value.report);
      }
    } else failedSources.push({ source: sources[index][0], status: "failed", message: result.reason?.message || String(result.reason) });
  });
  if (!records.length && failedSources.length === sources.length) {
    const run = { startedAt, finishedAt: new Date().toISOString(), status: "failed", collectedCount: 0, insertedCount: 0, failedSources, error: "모든 벤더 수집 실패" };
    await store.saveArchiveRun(run); throw new Error(run.error);
  }
  const insertedCount = await store.saveVendorDocuments(records);
  const run = { startedAt, finishedAt: new Date().toISOString(), status: failedSources.length ? "partial" : insertedCount ? "success" : "empty", collectedCount: records.length, insertedCount, failedSources, error: null };
  await store.saveArchiveRun(run);
  return run;
}
