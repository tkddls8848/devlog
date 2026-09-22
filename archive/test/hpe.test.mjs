import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { collect } from "../tools/sources/hpe.mjs";

const realFetch = globalThis.fetch;
const realWarn = console.warn;
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; });

test("로컬 HPE 수집기도 현재 Resource Library를 사용한다", async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /medialibrary\.model\.json/);
    return new Response(JSON.stringify({ stat: { total: 1 }, items: [{ label: "quickspecs", title: "HPE Test", lastUpdated: "Sep 21, 2026", cta: { link: "/us/en/resources.quickspecs.test.a50000001enw.html" } }] }));
  };
  assert.equal((await collect())[0].date, "2026-09-21");
});

test("로컬 HPE 수집 실패는 진단을 출력하고 실패로 알린다", async () => {
  const warnings = [];
  console.warn = (value) => warnings.push(JSON.parse(value));
  globalThis.fetch = async () => new Response("", { status: 502 });
  await assert.rejects(collect(), /502/);
  assert.equal(warnings[0].status, "failed");
  assert.equal(warnings[0].counts.page_error, 1);
});
