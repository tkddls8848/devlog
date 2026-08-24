const TIMEOUT = (ms) => AbortSignal.timeout(ms);
const IBM_LABELS = {
  hardware: "하드웨어", software: "소프트웨어", services: "서비스", withdrawal: "판매 종료",
  statementofdirection: "방향성 발표", rpq: "RPQ",
};
const HPE_BASE = "https://support.hpe.com";
const HPE_PAGE = `${HPE_BASE}/connect/s/search?language=en_US`;
const USER_AGENT = "devlog-archive/1.0";

const xmlDecode = (value) => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
const xmlTag = (xml, name) => xmlDecode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
const htmlText = (html) => xmlDecode(html.replace(/<\/(li|p|h\d|ul|ol)>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function collectIbm(region = "AP") {
  const response = await fetch(`https://www.ibm.com/docs/api/v1/announcement/all?region=${encodeURIComponent(region)}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: TIMEOUT(30_000),
  });
  if (!response.ok) throw new Error(`IBM API ${response.status}`);
  return (await response.json()).flatMap((item) => {
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

async function hpeToken() {
  const page = await fetch(HPE_PAGE, { headers: { "User-Agent": USER_AGENT }, signal: TIMEOUT(40_000) });
  if (!page.ok) throw new Error(`HPE 페이지 ${page.status}`);
  const html = await page.text();
  const fwuid = html.match(/"fwuid"\s*:\s*"([^"]+)"/)?.[1];
  const appId = html.match(/"APPLICATION@markup:\/\/siteforce:communityApp"\s*:\s*"([^"]+)"/)?.[1];
  if (!fwuid || !appId) throw new Error("HPE Aura 컨텍스트를 찾지 못했습니다.");
  const body = new URLSearchParams({
    message: JSON.stringify({ actions: [{ id: "91;a", descriptor: "apex://DCEHPESearchController/ACTION$getToken", callingDescriptor: "markup://c:dceCoveoSearchCustomEndpointHandler", params: {} }] }),
    "aura.context": JSON.stringify({ mode: "PROD", fwuid, app: "siteforce:communityApp", loaded: { "APPLICATION@markup://siteforce:communityApp": appId }, dn: [], globals: {}, uad: false }),
    "aura.pageURI": "/connect/s/search?language=en_US", "aura.token": "undefined",
  });
  const response = await fetch(`${HPE_BASE}/connect/s/sfsites/aura?r=2&other.DCEHPESearch.getToken=1`, {
    method: "POST", headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Referer: HPE_PAGE }, body, signal: TIMEOUT(40_000),
  });
  if (!response.ok) throw new Error(`HPE 토큰 ${response.status}`);
  const action = JSON.parse((await response.text()).replace(/^while\(1\);/, "")).actions[0];
  if (action.state !== "SUCCESS") throw new Error(`HPE 토큰 ${action.state}`);
  return JSON.parse(action.returnValue).token;
}

async function collectHpe() {
  const response = await fetch("https://platform.cloud.coveo.com/rest/search/v2", {
    method: "POST", headers: { Authorization: `Bearer ${await hpeToken()}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ q: "", aq: "@kmdoctypedetails==cv66000043 @kmdoclanguagecode==cv1871440", numberOfResults: 150, sortCriteria: "@sysdate descending", searchHub: "HPE-Search-Page", locale: "en-US" }), signal: TIMEOUT(45_000),
  });
  if (!response.ok) throw new Error(`HPE Coveo ${response.status}`);
  return (await response.json()).results.flatMap((item) => {
    const raw = item.raw || {}; const id = raw.kmdocid || raw.urihash;
    const match = String(raw.kmdoclastmod || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!id || !match || !item.title) return [];
    const ref = String(id).split("||")[0];
    return [{ vendor: "HPE", title: item.title.trim(), url: raw.nimble_public_uri || `${HPE_BASE}/hpesc/public/docDisplay?docId=${encodeURIComponent(ref)}`,
      date: `${match[3]}-${match[1]}-${match[2]}`, kind: "QuickSpecs", ref }];
  });
}

// Dell은 PDF를 대량으로 읽어야 해 Worker 실행 한도를 넘기기 쉽다. 카탈로그에서
// 후보를 만들고 PDF 메타데이터가 평문으로 있는 문서만 Cron에서 저장한다.
const DELL_ASSET = "https://www.delltechnologies.com/asset/en-us/products";
const DELL_CURATED = [["storage", "dell-powerstore-gen3-spec-sheet"], ["storage", "dell-powerstore-gen2-spec-sheet"], ["storage", "powerflex-specification-sheet"], ["networking", "dell-networking-s4100-series-spec-sheet"], ["networking", "dell-powerswitch-s4300-series-spec-sheet"], ["networking", "dell-powerswitch-z9864f-on-spec-sheet"], ["networking", "dell-powerswitch-z9664f-on-spec-sheet"]];
const DELL_KINDS = { servers: "서버", storage: "스토리지", networking: "네트워크" };
const dellDate = (text, field) => [...text.matchAll(new RegExp(`/${field}\\s*\\(D:(\\d{8})`, "g"))].map((match) => match[1]).sort().at(-1);
const fromDellPdf = async ([category, slug]) => {
  const url = `${DELL_ASSET}/${category}/technical-support/${slug}.pdf`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: TIMEOUT(30_000) });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") return null;
  const raw = new TextDecoder("iso-8859-1").decode(bytes);
  const stamp = dellDate(raw, "ModDate") || dellDate(raw, "CreationDate");
  if (!stamp) return null;
  const title = raw.match(/\/Title\s*\(([^)]*)\)/)?.[1]?.trim() || slug.replace(/[-_]/g, " ").replace(/\b(spec sheet|specification sheet|data sheet|dell|emc)\b/gi, "").replace(/\s+/g, " ").trim().toUpperCase();
  return { vendor: "Dell", title: title.replace(/\.pdf$/i, ""), url, date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6)}`, kind: "스펙 시트", tag: DELL_KINDS[category], ref: slug };
};
async function collectDell() {
  const catalog = await fetch("https://downloads.dell.com/catalog/Catalog.gz", { headers: { "User-Agent": USER_AGENT }, signal: TIMEOUT(60_000) });
  if (!catalog.ok) throw new Error(`Dell 카탈로그 ${catalog.status}`);
  const stream = catalog.body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) throw new Error("Dell gzip 본문이 없습니다.");
  const xml = new TextDecoder("utf-16le").decode(await new Response(stream).arrayBuffer());
  const servers = [...new Set([...xml.matchAll(/<Model systemID="[^"]*"[^>]*>[\s\S]*?<Display lang="en">(?:<!\[CDATA\[)?([^<\]]*)/g)].map((match) => match[1].trim().toLowerCase()).filter((name) => /^[a-z]{0,2}\d/.test(name)))].map((name) => ["servers", `poweredge-${name}-spec-sheet`]);
  const targets = [...servers, ...DELL_CURATED].slice(0, 160);
  const found = [];
  for (let index = 0; index < targets.length; index += 8) {
    const batch = await Promise.allSettled(targets.slice(index, index + 8).map(fromDellPdf));
    found.push(...batch.filter((result) => result.status === "fulfilled" && result.value).map((result) => result.value));
  }
  if (!found.length) throw new Error("Dell 스펙 시트를 하나도 받지 못했습니다.");
  return found;
}

export async function runArchive({ env, store, now = new Date() }) {
  const startedAt = now.toISOString();
  const sources = [
    ["IBM", () => collectIbm(env.IBM_REGION || "AP")], ["Lenovo", collectLenovo], ["HPE", collectHpe], ["Dell", collectDell],
  ];
  const settled = await Promise.allSettled(sources.map(([, collect]) => collect()));
  const failedSources = [];
  const records = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") records.push(...result.value);
    else failedSources.push({ source: sources[index][0], message: result.reason?.message || String(result.reason) });
  });
  if (failedSources.length === sources.length) {
    const run = { startedAt, finishedAt: new Date().toISOString(), status: "failed", collectedCount: 0, insertedCount: 0, failedSources, error: "모든 벤더 수집 실패" };
    await store.saveArchiveRun(run); throw new Error(run.error);
  }
  const insertedCount = await store.saveVendorDocuments(records);
  const run = { startedAt, finishedAt: new Date().toISOString(), status: failedSources.length ? "partial" : insertedCount ? "success" : "empty", collectedCount: records.length, insertedCount, failedSources, error: null };
  await store.saveArchiveRun(run);
  return run;
}
