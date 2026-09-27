import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, parseEnv, ROOT_ENV_FILE } from "../../shared/env.mjs";

test("환경 파일 경로는 작업 디렉터리와 무관하게 저장소 최상위다", () => {
  assert.equal(ROOT_ENV_FILE, fileURLToPath(new URL("../../.env", import.meta.url)));
});
test("환경 파일은 따옴표·주석·빈 값을 읽고 셸 값을 덮어쓰지 않는다", () => {
  assert.deepEqual(parseEnv('\uFEFF# comment\nA="value # inside"\nexport B=plain # comment\nC=\nD=\'quoted\'\r\n'), { A: "value # inside", B: "plain", C: "", D: "quoted" });
  const dir = mkdtempSync(path.join(tmpdir(), "devlog-env-test-"));
  const file = path.join(dir, ".env");
  try {
    writeFileSync(file, "A=file\nB=value\nC=file");
    const env = { A: "shell", C: "" };
    loadEnv({ file, env });
    assert.deepEqual(env, { A: "shell", B: "value", C: "" });
    loadEnv({ file: path.join(dir, "missing"), env });
    assert.equal(env.A, "shell");
  } finally { unlinkSync(file); rmdirSync(dir); }
});
