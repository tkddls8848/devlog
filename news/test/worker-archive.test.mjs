import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { gzipSync } from "node:zlib";
import { collectHpe } from "../../shared/vendor-hpe.mjs";
import { collectNetApp } from "../../shared/vendor-netapp.mjs";
import { collectOracle } from "../../shared/vendor-oracle.mjs";
import { collectDell } from "../worker/archive-dell.mjs";
import { runArchive } from "../worker/archive.mjs";

const realFetch = globalThis.fetch;
const realLog = console.log;
afterEach(() => { globalThis.fetch = realFetch; console.log = realLog; });
const json = (value) => new Response(JSON.stringify(value));
const hpeItem = (id = "a50006984enw", date = "Sep 21, 2026") => ({ label: "quickspecs", title: "HPE DL360 QuickSpecs", lastUpdated: date, cta: { link: `/us/en/resources.quickspecs.server.${id}.html?parentPage=/us/en/resource-library` } });
const catalog = (models = ["r770"]) => new Response(gzipSync(Buffer.from(`<Manifest>${models.map((model) => `<Model systemID="1"><Display lang="en"><![CDATA[${model}]]></Display></Model>`).join("")}</Manifest>`, "utf16le")));
const pdf = (stamp = "20260921") => new Response(`%PDF-1.7\n/Title (Spec sheet) /ModDate (D:${stamp}080000)\n%%EOF`);
const dellUrl = (slug) => `https://www.delltechnologies.com/asset/en-us/products/servers/technical-support/${slug}.pdf`;
const stubDell = (handler, models) => { globalThis.fetch = async (url, init) => String(url).includes("/catalog/") ? catalog(models) : handler(String(url), init); };

test("HPE는 현재 Resource Library를 페이지 순회하고 문서 ID와 날짜를 유지한다", async () => {
  const offsets = [];
  globalThis.fetch = async (value) => {
    const url = new URL(value);
    assert.match(url.pathname, /medialibrary\.model\.json$/);
    assert.equal(url.searchParams.get("sort"), "date");
    assert.equal(url.searchParams.get("status"), "active");
    const offset = Number(url.searchParams.get("offset")); offsets.push(offset);
    return json({ stat: { total: 2 }, items: [hpeItem(offset ? "a00026913enus" : "a50006984enw")] });
  };
  const { records, report } = await collectHpe();
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(report.status, "success");
  assert.equal(records.length, 2);
  assert.equal(records[0].date, "2026-09-21");
  assert.equal(records[0].url, "https://support.hpe.com/hpesc/public/docDisplay?docId=a50006984enw");
});

test("HPE 잘못된 날짜·주소·타입은 부분 누락으로 보고한다", async () => {
  globalThis.fetch = async () => json({ stat: { total: 5 }, items: [hpeItem(), hpeItem("a50000001enw", "Feb 30, 2026"), { ...hpeItem(), cta: { link: "https://evil.example/x.a50000001enw.html" } }, { ...hpeItem(), label: "video" }, { ...hpeItem(), title: "" }] });
  const result = await collectHpe();
  assert.equal(result.records.length, 1);
  assert.equal(result.report.status, "partial");
  assert.equal(result.report.counts.invalid_entry, 4);
});

test("HPE 중간 페이지 실패에도 받은 문서를 보존한다", async () => {
  globalThis.fetch = async (url) => new URL(url).searchParams.get("offset") === "0" ? json({ stat: { total: 2 }, items: [hpeItem()] }) : new Response("", { status: 503 });
  const result = await collectHpe();
  assert.equal(result.records.length, 1);
  assert.equal(result.report.status, "partial");
  assert.match(result.report.issues[0].message, /503/);
});

test("HPE 구조 변경·빈 응답·반복 페이지는 조용한 성공이 되지 않는다", async () => {
  for (const data of [{ results: [] }, { stat: { total: 0 }, items: [] }]) {
    globalThis.fetch = async () => json(data);
    assert.equal((await collectHpe()).report.status, "failed");
  }
  globalThis.fetch = async () => json({ stat: { total: 3 }, items: [hpeItem()] });
  const result = await collectHpe();
  assert.equal(result.records.length, 1);
  assert.equal(result.report.counts.repeated_page, 1);
});

test("HPE 순회 상한 도달은 부분 누락으로 남긴다", async () => {
  globalThis.fetch = async (url) => json({ stat: { total: 21 }, items: [hpeItem(`a${new URL(url).searchParams.get("offset")}enw`)] });
  const result = await collectHpe();
  assert.equal(result.records.length, 20);
  assert.equal(result.report.counts.page_limit, 1);
  assert.equal(result.report.status, "partial");
});

test("Dell 차단·로그인 이동·로그인 HTML·HTTP 오류를 구분하고 인증 주소를 따라가지 않는다", async () => {
  let loginFetched = false;
  stubDell((url, init) => {
    assert.equal(init.redirect, "manual");
    if (url.includes("myaccess")) loginFetched = true;
    if (url.includes("powerstore-gen2")) return new Response("", { status: 403 });
    if (url.includes("powerflex")) return new Response("", { status: 302, headers: { location: "https://myaccess.dell.com/oauth2/authorize?state=secret" } });
    if (url.includes("s4100")) return new Response('<html><title>Sign In</title></html>');
    if (url.includes("s4300")) return new Response("", { status: 429 });
    if (url.includes("z9864")) return new Response("", { status: 503 });
    return pdf();
  });
  const result = await collectDell();
  assert.equal(result.report.status, "partial");
  for (const kind of ["blocked", "login_redirect", "login_page", "rate_limited", "http_error"]) assert.equal(result.report.counts[kind], 1);
  assert.equal(loginFetched, false);
  assert.doesNotMatch(JSON.stringify(result.report), /secret/);
  assert.equal(result.records.length, 3);
});

test("Dell PDF 리다이렉트는 수집하고 문서 아닌 응답·메타데이터 누락·타임아웃은 기록한다", async () => {
  stubDell((url) => {
    if (url.endsWith("poweredge-r770-spec-sheet.pdf")) return new Response("", { status: 302, headers: { location: "https://i.dell.com/spec.pdf" } });
    if (url.includes("powerflex")) return new Response("%PDF-1.7\nno dates");
    if (url.includes("s4100")) return new Response("<html>Something changed</html>");
    if (url.includes("s4300")) throw new DOMException("Timed out", "TimeoutError");
    return pdf();
  });
  const { records, report } = await collectDell();
  assert.ok(records.some((r) => r.ref === "poweredge-r770-spec-sheet"));
  for (const kind of ["missing_metadata", "not_pdf", "timeout"]) assert.equal(report.counts[kind], 1);
});

test("Dell 이미 알던 문서의 404와 추정한 주소의 404를 구별한다", async () => {
  stubDell((url) => url.includes("poweredge-") ? new Response("", { status: 404 }) : pdf());
  const result = await collectDell({ knownUrls: [dellUrl("poweredge-old-spec-sheet")] });
  assert.equal(result.report.counts.missing_document, 1);
  assert.equal(result.report.counts.not_found, 1);
  assert.equal(result.report.status, "partial");
  stubDell((url) => url.includes("poweredge-") ? new Response("", { status: 404 }) : pdf());
  assert.equal((await collectDell()).report.status, "success", "추정 후보의 404만 있으면 부분 실패가 아니다");
});

test("Dell 카탈로그 실패에도 알려진 문서와 고정 목록은 수집한다", async () => {
  globalThis.fetch = async (url) => String(url).includes("/catalog/") ? new Response("", { status: 403 }) : pdf();
  const result = await collectDell({ knownUrls: [dellUrl("poweredge-r770-spec-sheet")] });
  assert.equal(result.report.status, "partial");
  assert.equal(result.report.counts.catalog_error, 1);
  assert.equal(result.records.length, 8);
});

test("Dell 후보 상한과 보고서 샘플 상한도 숨기지 않는다", async () => {
  stubDell(() => new Response("", { status: 403 }), Array.from({ length: 200 }, (_, i) => `r${i}`));
  const { report } = await collectDell();
  assert.equal(report.status, "failed");
  assert.equal(report.counts.candidates, 207);
  assert.equal(report.counts.attempted, 160);
  assert.equal(report.counts.blocked, 160);
  assert.equal(report.counts.candidate_limit, 1);
  assert.equal(report.issueCount, 161);
  assert.equal(report.issues.length, 40);
  assert.equal(report.omittedIssueCount, 121);
});

test("운영 실행은 부분 수집 문서를 저장하고 상세 실패 정보를 기존 이력에 전달한다", async () => {
  console.log = () => {};
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("ibm.com/docs/api")) return json([{ name: "IBM doc", urlKey: "test", announcementDate: "2026-09-21" }]);
    if (value.includes("lenovopress")) return new Response('<rss><item><title>Lenovo doc</title><link>https://lenovopress.lenovo.com/lp1</link><pubDate>21 Sep 2026 00:00:00 GMT</pubDate></item></rss>');
    if (value.includes("medialibrary")) return json({ stat: { total: 1 }, items: [hpeItem()] });
    if (value.includes("docs.netapp.com")) return rss([]);
    if (value.includes("docs.oracle.com")) return rss([ociItem()]);
    if (value.includes("/catalog/")) return catalog();
    if (value.includes("powerflex")) return new Response("", { status: 403 });
    return pdf();
  };
  let saved, run;
  const result = await runArchive({ env: {}, store: { listDellDocumentUrls: async () => [], saveVendorDocuments: async (records) => { saved = records; return records.length; }, saveArchiveRun: async (value) => { run = value; } } });
  assert.equal(result.status, "partial");
  assert.ok(saved.some((r) => r.vendor === "HPE"));
  assert.ok(saved.some((r) => r.vendor === "Dell"));
  assert.ok(saved.some((r) => r.vendor === "Oracle"));
  assert.deepEqual(run.failedSources.map((r) => r.source), ["Dell"]);
  assert.equal(run.failedSources[0].source, "Dell");
  assert.equal(run.failedSources[0].counts.blocked, 1);
  assert.equal(run.failedSources[0].issues[0].status, 403);
});

test("모든 벤더 실패는 failed 이력을 남기고 문서를 저장하지 않는다", async () => {
  console.log = () => {};
  globalThis.fetch = async () => new Response("", { status: 403 });
  let run;
  await assert.rejects(runArchive({ env: {}, store: { listDellDocumentUrls: async () => [], saveVendorDocuments: async () => assert.fail("저장하면 안 됨"), saveArchiveRun: async (value) => { run = value; } } }), /모든 벤더/);
  assert.equal(run.status, "failed");
  assert.equal(run.failedSources.find((r) => r.source === "Dell").counts.blocked, 7);
});

const rss = (items) => new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.join("")}</channel></rss>`);
const netappItem = (product, date = "Wed, 01 Jul 2026 13:47:42 +0000") => `<item><title>What&apos;s new for ${product} (1 Jul 2026)</title><pubDate>${date}</pubDate><link>https://docs.netapp.com/us-en/${product}/whats-new.html?time=1782913662</link><description><![CDATA[ Learn about new platforms. ]]></description></item>`;
const ociItem = (service = "generative-ai", slug = "regional-router", date = "Wed, 23 Sep 2026 12:00:00 +0000") => `<item><title>Route requests
across regions</title><link>https://docs.oracle.com/iaas/releasenotes/${service}/${slug}.htm</link><description>&lt;div&gt;&lt;p&gt;OCI now supports &lt;a href=&quot;/x&quot;&gt;routing&lt;/a&gt; &amp;amp; more.&lt;/p&gt;&lt;/div&gt;</description><pubDate>${date}</pubDate></item>`;

test("NetApp은 제품별 What's new 피드를 모으고 개정 쿼리를 뗀 주소를 쓴다", async () => {
  const requested = [];
  globalThis.fetch = async (url) => { requested.push(String(url)); return String(url).includes("/ontap-systems/") ? rss([netappItem("ontap-systems")]) : rss([]); };
  const { records, report } = await collectNetApp({ products: ["ontap-systems", "ontap"] });
  assert.deepEqual(requested.sort(), ["https://docs.netapp.com/us-en/ontap-systems/feed.xml", "https://docs.netapp.com/us-en/ontap/feed.xml"]);
  assert.equal(report.status, "success");
  assert.deepEqual(records, [{ vendor: "NetApp", title: "What's new for ontap-systems (1 Jul 2026)", url: "https://docs.netapp.com/us-en/ontap-systems/whats-new.html", date: "2026-07-01", kind: "What's new", tag: "ONTAP 하드웨어", ref: "ontap-systems", note: "Learn about new platforms." }]);
});

test("NetApp 빈 피드는 정상이지만 실패·비RSS 피드는 부분 누락으로 남긴다", async () => {
  globalThis.fetch = async () => rss([]);
  assert.equal((await collectNetApp({ products: ["ontap"] })).report.status, "success");
  globalThis.fetch = async (url) => String(url).includes("/trident/") ? new Response("", { status: 404 }) : String(url).includes("/ontap/") ? new Response("<html>login</html>") : rss([netappItem("e-series")]);
  const { records, report } = await collectNetApp({ products: ["e-series", "trident", "ontap"] });
  assert.equal(records.length, 1);
  assert.equal(report.status, "partial");
  assert.deepEqual(report.issues.map((item) => [item.product, item.message]).sort(), [["ontap", "RSS 형식이 아닙니다"], ["trident", "HTTP 404"]]);
});

test("NetApp 잘못된 날짜·외부 링크는 버리고 보고한다", async () => {
  globalThis.fetch = async () => rss([netappItem("ontap", "not a date"), netappItem("ontap").replace("docs.netapp.com", "evil.example"), netappItem("ontap")]);
  const { records, report } = await collectNetApp({ products: ["ontap"] });
  assert.equal(records.length, 1);
  assert.equal(report.counts.invalid_entry, 2);
});

test("Oracle은 OCI 릴리스 노트에서 서비스와 문서 이름, 본문 요약을 뽑는다", async () => {
  globalThis.fetch = async () => rss([ociItem(), ociItem("database-management", "dbm-new")]);
  const { records, report } = await collectOracle();
  assert.equal(report.status, "success");
  assert.deepEqual(records[0], { vendor: "Oracle", title: "Route requests across regions", url: "https://docs.oracle.com/iaas/releasenotes/generative-ai/regional-router.htm", date: "2026-09-23", kind: "OCI 릴리스 노트", tag: "generative-ai", ref: "regional-router", note: "OCI now supports routing & more." });
  assert.equal(records[1].tag, "database-management");
});

test("Oracle 빈 피드·구조 변경·HTTP 실패는 조용한 성공이 되지 않는다", async () => {
  for (const response of [() => rss([]), () => new Response("<html></html>"), () => new Response("", { status: 503 })]) {
    globalThis.fetch = async () => response();
    assert.equal((await collectOracle()).report.status, "failed");
  }
  globalThis.fetch = async () => rss([ociItem(), ociItem().replace("/releasenotes/generative-ai/", "/Content/")]);
  const { records, report } = await collectOracle();
  assert.equal(records.length, 1);
  assert.equal(report.status, "partial");
});
