import assert from "node:assert/strict";
import test from "node:test";
import { movedResponse, SPECSHEET_ORIGIN } from "../worker/redirects.mjs";

const at = (path) => movedResponse(new URL(`https://devlog.tkddls8848.workers.dev${path}`));

test("옮긴 경로는 같은 경로·쿼리로 specsheet에 301", () => {
  for (const path of ["/feed.xml", "/feed.xml?utm=x", "/archive", "/archive/", "/archive/?q=dell", "/issues/2026-10-01-news/", "/issues/2026-10-01-news"]) {
    const response = at(path);
    assert.equal(response?.status, 301, path);
    assert.equal(response.headers.get("location"), `${SPECSHEET_ORIGIN}${path}`, path);
  }
});

test("루트는 작업 회고로 301", () => {
  for (const path of ["/", "/?ref=x"]) {
    const response = at(path);
    assert.equal(response?.status, 301);
    assert.equal(response.headers.get("location"), "/devlog/");
  }
});

test("작업 회고와 비슷하지만 옮기지 않는 경로는 그대로 둔다", () => {
  for (const path of ["/devlog/", "/devlog/posts/a/", "/archived", "/issues", "/issues/", "/feed.xml.bak", "/assets/css/main.css", "/healthz"]) {
    assert.equal(at(path), null, path);
  }
});
