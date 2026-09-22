import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { gzipSync } from "node:zlib";
import { collectHpe } from "../../shared/vendor-hpe.mjs";
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
    if (value.includes("/catalog/")) return catalog();
    if (value.includes("powerflex")) return new Response("", { status: 403 });
    return pdf();
  };
  let saved, run;
  const result = await runArchive({ env: {}, store: { listDellDocumentUrls: async () => [], saveVendorDocuments: async (records) => { saved = records; return records.length; }, saveArchiveRun: async (value) => { run = value; } } });
  assert.equal(result.status, "partial");
  assert.ok(saved.some((r) => r.vendor === "HPE"));
  assert.ok(saved.some((r) => r.vendor === "Dell"));
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
