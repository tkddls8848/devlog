import assert from "node:assert/strict";
import test from "node:test";
import worker, { DEVLOG_CRON } from "../worker/index.mjs";

const fakeDb = () => {
  const statement = {
    bind() { return statement; },
    async first() { return null; },
    async all() { return { results: [] }; },
    async run() { return { meta: { changes: 0 } }; },
  };
  return { prepare: () => statement, batch: async () => [] };
};
const env = () => ({ DB: fakeDb(), ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
const get = (path, method = "GET") => worker.fetch(new Request(`https://devlog.tkddls8848.workers.dev${path}`, { method }), env());

test("옛 뉴스 경로는 GET과 HEAD 모두 301", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await get("/feed.xml?utm=x", method);
    assert.equal(response.status, 301, method);
    assert.equal(response.headers.get("location"), "https://specsheet.tkddls8848.workers.dev/feed.xml?utm=x");
  }
});

test("healthz는 작업 회고 실행 이력만 돌려준다", async () => {
  const health = await (await get("/healthz")).json();
  assert.deepEqual(Object.keys(health).sort(), ["latestDevlogRun", "ok"]);
});

test("작업 회고 목록은 200", async () => {
  assert.equal((await get("/devlog/")).status, 200);
});

test("작업 회고 Cron만 돌리고 옛 뉴스·아카이브 Cron은 건너뛴다", async () => {
  const ran = [];
  const ctx = { waitUntil: (promise) => ran.push(promise.catch(() => {})) };
  for (const cron of ["0 22 * * *", "25 0 * * *"]) await worker.scheduled({ cron, scheduledTime: Date.now() }, env(), ctx);
  assert.equal(ran.length, 0);
  assert.equal(DEVLOG_CRON, "10 0 * * *");
});
