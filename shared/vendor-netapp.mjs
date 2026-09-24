import { collectionReport, count, issue, finishCollection, htmlText, isRss, rssItems, xmlTag } from "./vendor-collection.mjs";

// docs.netapp.com publishes one RSS feed per product, fed by its "What's new"
// page. Most feeds hold only the latest entry, so the archive accumulates them.
// An empty feed is normal; a missing or malformed feed is not.
export const NETAPP_PRODUCTS = {
  "ontap": "ONTAP",
  "ontap-systems": "ONTAP 하드웨어",
  "asa-r2": "ASA r2",
  "ontap-afx": "AFX",
  "ontap-select": "ONTAP Select",
  "e-series": "E-Series",
  "e-series-santricity": "SANtricity",
  "storagegrid": "StorageGRID",
  "data-infrastructure-insights": "Data Infrastructure Insights",
  "trident": "Trident",
};
const feedUrl = (product) => `https://docs.netapp.com/us-en/${product}/feed.xml`;

async function collectProduct(product, report, records) {
  count(report, "feedsAttempted");
  const response = await fetch(feedUrl(product), { headers: { Accept: "application/rss+xml, application/xml;q=0.9", "User-Agent": "devlog-archive/1.0" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  if (!isRss(xml)) throw new Error("RSS 형식이 아닙니다");
  for (const item of rssItems(xml)) {
    count(report, "candidates");
    count(report, "attempted");
    const title = xmlTag(item, "title");
    const published = new Date(xmlTag(item, "pubDate"));
    let link;
    try { link = new URL(xmlTag(item, "link")); } catch { /* Reported below. */ }
    if (!title || Number.isNaN(published.getTime()) || link?.origin !== "https://docs.netapp.com") {
      issue(report, "invalid_entry", { product, title: title.slice(0, 180) });
      continue;
    }
    // The feed appends ?time=<epoch> per revision; the date already tells revisions apart.
    const url = `${link.origin}${link.pathname}`;
    const date = published.toISOString().slice(0, 10);
    const note = htmlText(xmlTag(item, "description")).slice(0, 400);
    records.set(`${url}:${date}`, { vendor: "NetApp", title, url, date, kind: "What's new", tag: NETAPP_PRODUCTS[product], ref: product, ...(note ? { note } : {}) });
  }
}

export async function collectNetApp({ products = Object.keys(NETAPP_PRODUCTS) } = {}) {
  const report = collectionReport("NetApp");
  const records = new Map();
  const settled = await Promise.allSettled(products.map((product) => collectProduct(product, report, records)));
  settled.forEach((result, index) => {
    if (result.status === "rejected") issue(report, "feed_error", { product: products[index], message: result.reason?.message || String(result.reason) });
  });
  const result = finishCollection([...records.values()], report);
  // Empty feeds are expected, so zero records with every feed readable is not a failure.
  if (!records.size && report.issueCount === 0) report.status = "success";
  return result;
}
