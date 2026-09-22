import { collectionReport, count, issue, finishCollection, safeLocation, validDate } from "../../shared/vendor-collection.mjs";

const ASSET = "https://www.delltechnologies.com/asset/en-us/products";
const CATALOG = "https://downloads.dell.com/catalog/Catalog.gz";
const CURATED = [["storage", "dell-powerstore-gen3-spec-sheet"], ["storage", "dell-powerstore-gen2-spec-sheet"], ["storage", "powerflex-specification-sheet"], ["networking", "dell-networking-s4100-series-spec-sheet"], ["networking", "dell-powerswitch-s4300-series-spec-sheet"], ["networking", "dell-powerswitch-z9864f-on-spec-sheet"], ["networking", "dell-powerswitch-z9664f-on-spec-sheet"]];
const KINDS = { servers: "서버", storage: "스토리지", networking: "네트워크" };
const headers = { "User-Agent": "devlog-archive/1.0" };
const dateOf = (text, field) => [...text.matchAll(new RegExp(`/${field}\\s*\\(D:(\\d{4})(\\d{2})(\\d{2})`, "g"))]
  .map((m) => `${m[1]}-${m[2]}-${m[3]}`).filter(validDate).sort().at(-1);
const loginLocation = (value) => {
  try { const url = new URL(value); return url.hostname === "myaccess.dell.com" || /\/(?:login|signin|oauth2|sso)(?:\/|$)/i.test(url.pathname); }
  catch { return false; }
};

async function fromPdf(target, report) {
  const { url, category, slug, known } = target;
  count(report, "attempted");
  try {
    // Inspect redirects before following them; do not fetch authentication flows.
    let current = url;
    let response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetch(current, { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) { issue(report, "invalid_redirect", { url, status: response.status }); return null; }
      const next = new URL(location, current);
      if (loginLocation(next.href)) { issue(report, "login_redirect", { url, status: response.status, destination: safeLocation(next.href) }); return null; }
      if (next.protocol !== "https:" || !["www.delltechnologies.com", "www.dell.com", "i.dell.com", "dl.dell.com", "downloads.dell.com"].includes(next.hostname)) {
        issue(report, "unexpected_redirect", { url, destination: safeLocation(next.href) }); return null;
      }
      if (redirects === 5) { issue(report, "redirect_limit", { url }); return null; }
      current = next.href;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && !known) count(report, "not_found");
      else issue(report, response.status === 404 ? "missing_document" : response.status === 403 ? "blocked" : response.status === 401 ? "authentication_required" : response.status === 429 ? "rate_limited" : "http_error", { url, status: response.status });
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
      const html = new TextDecoder().decode(bytes.slice(0, 100000));
      issue(report, /myaccess\.dell\.com|<title[^>]*>[^<]*(?:sign in|log in|login)|<input[^>]+type=["']password/i.test(html) ? "login_page" : "not_pdf", { url, status: response.status });
      return null;
    }
    const raw = new TextDecoder("iso-8859-1").decode(bytes);
    const date = dateOf(raw, "ModDate") || dateOf(raw, "CreationDate");
    if (!date) { issue(report, "missing_metadata", { url }); return null; }
    const title = raw.match(/\/Title\s*\(([^)]*)\)/)?.[1]?.trim() || slug.replace(/[-_]/g, " ").replace(/\b(spec sheet|specification sheet|data sheet|dell|emc)\b/gi, "").replace(/\s+/g, " ").trim().toUpperCase();
    return { vendor: "Dell", title: title.replace(/\.pdf$/i, ""), url, date, kind: "스펙 시트", tag: KINDS[category], ref: slug };
  } catch (error) {
    issue(report, error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "network_error", { url, message: error.message });
    return null;
  }
}

export async function collectDell({ knownUrls = [] } = {}) {
  const report = collectionReport("Dell");
  const candidates = new Map();
  const add = (category, slug, known = false) => {
    const url = `${ASSET}/${category}/technical-support/${slug}.pdf`;
    candidates.set(url, { url, category, slug, known: known || candidates.get(url)?.known || false });
  };
  for (const url of knownUrls) {
    const match = String(url).match(/^https:\/\/www\.delltechnologies\.com\/asset\/en-us\/products\/(servers|storage|networking)\/technical-support\/([\w-]+)\.pdf$/);
    if (match) add(match[1], match[2], true);
    else issue(report, "unsupported_known_url", { url: safeLocation(url) });
  }
  for (const [category, slug] of CURATED) add(category, slug, true);
  try {
    const catalog = await fetch(CATALOG, { headers, signal: AbortSignal.timeout(60_000) });
    if (!catalog.ok) { await catalog.body?.cancel(); throw new Error(`Dell 카탈로그 HTTP ${catalog.status}`); }
    const stream = catalog.body?.pipeThrough(new DecompressionStream("gzip"));
    if (!stream) throw new Error("Dell gzip 본문이 없습니다.");
    const xml = new TextDecoder("utf-16le").decode(await new Response(stream).arrayBuffer());
    const servers = [...new Set([...xml.matchAll(/<Model systemID="[^"]*"[^>]*>[\s\S]*?<Display lang="en">(?:<!\[CDATA\[)?([^<\]]*)/g)]
      .map((match) => match[1].trim().toLowerCase().replace(/\s+/g, "")).filter((name) => /^[a-z]{0,2}\d[\w-]*$/.test(name)))];
    if (!servers.length) throw new Error("Dell 카탈로그에서 서버 모델을 찾지 못했습니다.");
    for (const name of servers) add("servers", `poweredge-${name}-spec-sheet`);
  } catch (error) { issue(report, "catalog_error", { url: CATALOG, message: error.message }); }
  const all = [...candidates.values()];
  report.counts.candidates = all.length;
  const targets = all.slice(0, 160);
  if (all.length > targets.length) issue(report, "candidate_limit", { skipped: all.length - targets.length });
  const records = [];
  for (let index = 0; index < targets.length; index += 8) {
    const batch = await Promise.all(targets.slice(index, index + 8).map((target) => fromPdf(target, report)));
    records.push(...batch.filter(Boolean));
  }
  return finishCollection(records, report);
}
