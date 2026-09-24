import { collectionReport, count, issue, finishCollection, htmlText, isRss, rssItems, xmlTag } from "./vendor-collection.mjs";

// OCI publishes every service's release notes in one rolling RSS feed (~50 items).
export const OCI_FEED = "https://docs.oracle.com/en-us/iaas/releasenotes/feed/";

export async function collectOracle() {
  const report = collectionReport("Oracle");
  const records = new Map();
  try {
    const response = await fetch(OCI_FEED, { headers: { Accept: "application/rss+xml, application/xml;q=0.9", "User-Agent": "devlog-archive/1.0" }, redirect: "follow", signal: AbortSignal.timeout(40_000) });
    if (!response.ok) throw new Error(`OCI Release Notes HTTP ${response.status}`);
    const xml = await response.text();
    if (!isRss(xml)) throw new Error("OCI Release Notes 응답이 RSS 형식이 아닙니다");
    const items = rssItems(xml);
    report.counts.candidates = items.length;
    if (!items.length) issue(report, "empty_feed", {});
    for (const item of items) {
      count(report, "attempted");
      const title = xmlTag(item, "title").replace(/\s+/g, " ");
      const published = new Date(xmlTag(item, "pubDate"));
      let link;
      try { link = new URL(xmlTag(item, "link")); } catch { /* Reported below. */ }
      // Links look like /iaas/releasenotes/<service>/<slug>.htm.
      const [, service, slug] = link?.pathname.match(/\/releasenotes\/([^/]+)\/([^/]+)\.htm$/) || [];
      if (!title || Number.isNaN(published.getTime()) || link?.hostname !== "docs.oracle.com" || !service) {
        issue(report, "invalid_entry", { title: title.slice(0, 180) });
        continue;
      }
      const date = published.toISOString().slice(0, 10);
      const note = htmlText(xmlTag(item, "description")).slice(0, 400);
      records.set(`${link.href}:${date}`, { vendor: "Oracle", title, url: link.href, date, kind: "OCI 릴리스 노트", tag: service, ref: slug, ...(note ? { note } : {}) });
    }
  } catch (error) {
    issue(report, "feed_error", { message: error.message });
  }
  return finishCollection([...records.values()], report);
}
