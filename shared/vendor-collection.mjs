// Diagnostics fit the existing archive_runs.failed_sources JSON column.
export function collectionReport(source) {
  return { source, status: "success", message: "", counts: { candidates: 0, attempted: 0, collected: 0 }, issueCount: 0, issues: [] };
}

export function count(report, key, amount = 1) {
  report.counts[key] = (report.counts[key] || 0) + amount;
}

export function issue(report, kind, details = {}) {
  count(report, kind);
  report.issueCount++;
  // Counts remain exact while bounding the persisted URL/error samples.
  if (report.issues.length < 40) report.issues.push({ kind, ...details });
}

export function finishCollection(records, report) {
  report.counts.collected = records.length;
  report.omittedIssueCount = report.issueCount - report.issues.length;
  report.status = !records.length ? "failed" : report.issueCount ? "partial" : "success";
  report.message = `${report.source}: ${records.length}건 수집, 확인 필요 ${report.issueCount}건`;
  return { records, report };
}

export function safeLocation(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return ""; }
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Minimal RSS helpers shared by the feed-based collectors.
export const xmlDecode = (value) => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
export const xmlTag = (xml, name) => xmlDecode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
export const htmlText = (html) => xmlDecode(String(html || "").replace(/<\/(li|p|h\d|ul|ol)>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export const rssItems = (xml) => String(xml || "").match(/<item>[\s\S]*?<\/item>/g) || [];
export const isRss = (xml) => /<rss[\s>]/.test(String(xml || "")) && /<channel[\s>]/.test(String(xml || ""));
