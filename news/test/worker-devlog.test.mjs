import assert from "node:assert/strict";
import test from "node:test";
import { runDevlog } from "../worker/devlog.mjs";

const storeFor = (runs) => ({
  publishedDevlogShas: async () => new Set(),
  saveDevlogRun: async (run) => runs.push(run),
});

test("개발일지는 GITHUB_TOKEN을 Bearer 인증으로 보낸다", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => [] };
  };
  try {
    const runs = [];
    const result = await runDevlog({ env: { GITHUB_TOKEN: "test-token" }, store: storeFor(runs), now: new Date("2026-08-25T00:10:00Z") });
    assert.equal(result.status, "empty");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
    assert.equal(runs[0].status, "empty");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GITHUB_TOKEN이 없으면 익명 호출하지 않고 실패 이력을 남긴다", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("호출되면 안 됩니다."); };
  try {
    const runs = [];
    await assert.rejects(
      runDevlog({ env: {}, store: storeFor(runs), now: new Date("2026-08-25T00:10:00Z") }),
      /GITHUB_TOKEN/
    );
    assert.equal(called, false);
    assert.equal(runs[0].status, "failed");
    assert.match(runs[0].error, /GITHUB_TOKEN/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
