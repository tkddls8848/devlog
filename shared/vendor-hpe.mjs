import { collectionReport, count, issue, finishCollection, validDate } from "./vendor-collection.mjs";

// Public Resource Library endpoint linked from HPE's current QuickSpecs site.
export const HPE_LIBRARY = "https://www.hpe.com/us/en/resource-library/_jcr_content/polaris-body-zone/medialibrary.model.json";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateOf = (value) => {
  const match = String(value || "").match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match || !MONTHS.includes(match[1])) return null;
  const date = `${match[3]}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return validDate(date) ? date : null;
};

export async function collectHpe() {
  const report = collectionReport("HPE");
  const records = new Map();
  const pages = new Set();
  let offset = 0;
  let total = Infinity;
  for (let page = 0; page < 20 && offset < total; page++) {
    const url = new URL(HPE_LIBRARY);
    url.search = new URLSearchParams({ restype: "quickspecs", topic: "", product: "", status: "active", search: "", offset: String(offset), limit: "100", sort: "date" }).toString();
    try {
      count(report, "pagesAttempted");
      const response = await fetch(url.href, { headers: { Accept: "application/json", "User-Agent": "devlog-archive/1.0" }, signal: AbortSignal.timeout(40_000) });
      if (!response.ok) throw new Error(`HPE Resource Library HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.items) || !Number.isInteger(data.stat?.total) || data.stat.total < 0) throw new Error("HPE Resource Library 응답 구조 변경");
      total = data.stat.total;
      report.counts.candidates = total;
      if (!data.items.length) {
        if (offset < total || !total) issue(report, "empty_page", { offset, total });
        break;
      }
      const signature = JSON.stringify(data.items.map((item) => [item.cta?.link, item.lastUpdated]));
      if (pages.has(signature)) { issue(report, "repeated_page", { offset }); break; }
      pages.add(signature);
      for (const item of data.items) {
        count(report, "attempted");
        const date = dateOf(item.lastUpdated);
        let link;
        try { link = new URL(item.cta?.link, "https://www.hpe.com"); } catch { /* Invalid entries are reported below. */ }
        const ref = link?.pathname.match(/\.([ac]\d+(?:enw|enus|en_us)?)\.html$/i)?.[1];
        if (item.label !== "quickspecs" || typeof item.title !== "string" || !item.title.trim() || !date || !ref || link.origin !== "https://www.hpe.com") {
          issue(report, "invalid_entry", { offset, title: String(item.title || "").slice(0, 180) });
          continue;
        }
        // Keep the existing document-ID URL identity to avoid duplicating stored
        // revisions just because the discovery/search endpoint changed.
        records.set(`${ref}:${date}`, { vendor: "HPE", title: item.title.trim(), url: `https://support.hpe.com/hpesc/public/docDisplay?docId=${ref}`, date, kind: "QuickSpecs", ref });
      }
      offset += data.items.length;
      if (page === 19 && offset < total) issue(report, "page_limit", { remaining: total - offset });
    } catch (error) {
      issue(report, "page_error", { offset, message: error.message });
      break;
    }
  }
  return finishCollection([...records.values()], report);
}
