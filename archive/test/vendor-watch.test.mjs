import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// vendor-watch.mjs는 export가 없는 실행 스크립트다. 임시 작업 폴더에서 하위
// 프로세스로 돌리고 네 수집기의 네트워크만 스텁해, 저장 결과와 종료 코드까지
// 실제 경로로 확인한다.
const SCRIPT = fileURLToPath(new URL("../tools/vendor-watch.mjs", import.meta.url));
const ARCHIVE = "src/_data/vendorArchive.json";

const STUB = `
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const fixture = JSON.parse(readFileSync(process.env.WATCH_FIXTURE, "utf8"));
const text = (body, status = 200) => new Response(body, { status });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const items = (vendor) => fixture[vendor].items ?? [];

globalThis.fetch = async (url) => {
  const target = String(url);

  if (target.includes("ibm.com/docs/api")) {
    if (fixture.ibm.fail) return json({ message: "다운" }, 500);
    return json(
      items("ibm").map((doc) => ({
        urlKey: doc.key,
        name: doc.title,
        announcementDate: doc.date + "T00:00:00.000+0000",
      }))
    );
  }

  if (target.includes("lenovopress.lenovo.com/rss")) {
    if (fixture.lenovo.fail) return text("", 503);
    const body = items("lenovo")
      .map(
        (doc) =>
          "<item><title>" + doc.title + "</title><link>" + doc.url + "</link>" +
          "<pubDate>" + doc.date + "T00:00:00Z</pubDate></item>"
      )
      .join("");
    return text("<rss><channel>" + body + "</channel></rss>");
  }

  if (target.includes("/connect/s/sfsites/aura")) {
    return text(
      "while(1);" +
        JSON.stringify({
          actions: [{ state: "SUCCESS", returnValue: JSON.stringify({ token: "t" }) }],
        })
    );
  }

  if (target.includes("support.hpe.com/connect/s/search")) {
    if (fixture.hpe.fail) return text("", 502);
    return text(
      '<html>{"fwuid":"F","APPLICATION@markup://siteforce:communityApp":"A"}</html>'
    );
  }

  if (target.includes("platform.cloud.coveo.com")) {
    return json({
      results: items("hpe").map((doc) => ({
        title: doc.title,
        raw: {
          kmdocid: doc.id,
          kmdoclastmod: doc.date.slice(5, 7) + "/" + doc.date.slice(8) + "/" + doc.date.slice(0, 4),
          nimble_public_uri: doc.url,
        },
      })),
    });
  }

  if (target.includes("downloads.dell.com")) {
    if (fixture.dell.fail) return text("", 403);
    const models = items("dell")
      .map(
        (doc) =>
          '<Model systemID="0000"><Display lang="en"><![CDATA[' + doc.model + "]]></Display></Model>"
      )
      .join("");
    return new Response(
      gzipSync(Buffer.from("<Manifest>" + models + "</Manifest>", "utf16le")),
      { status: 200 }
    );
  }

  if (target.includes("delltechnologies.com")) {
    const doc = items("dell").find((entry) =>
      target.endsWith("poweredge-" + entry.model.toLowerCase() + "-spec-sheet.pdf")
    );
    if (!doc) return text("", 404);
    const stamp = doc.date.replaceAll("-", "") + "000000";
    return new Response(
      Buffer.from(
        "%PDF-1.7\\n<< /Title (" + doc.title + ") /ModDate (D:" + stamp + "+05'30') >>\\n%%EOF\\n",
        "latin1"
      ),
      { status: 200 }
    );
  }

  throw new Error("예상치 못한 요청: " + target);
};
`;

const NOTHING = { items: [] };

// Dell만 문서를 하나도 못 받으면 실패로 취급한다. 다른 벤더의 동작을 보는
// 동안 Dell이 종료 코드를 흐리지 않게, 기본값으로 문서 하나를 돌려준다.
const dellDoc = { model: "R770", title: "PowerEdge R770 Spec Sheet", date: "2026-08-13" };
const dellRecord = {
  vendor: "Dell",
  title: "PowerEdge R770 Spec Sheet",
  url: "https://www.delltechnologies.com/asset/en-us/products/servers/technical-support/poweredge-r770-spec-sheet.pdf",
  date: "2026-08-13",
  kind: "스펙 시트",
  tag: "서버",
  ref: "poweredge-r770-spec-sheet",
};

function run({
  archive = [],
  ibm = NOTHING,
  lenovo = NOTHING,
  hpe = NOTHING,
  dell = { items: [dellDoc] },
  args = [],
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "vendor-watch-"));
  const fixture = path.join(dir, "fixture.json");
  const stub = path.join(dir, "stub.mjs");
  const archiveFile = path.join(dir, ARCHIVE);

  writeFileSync(fixture, JSON.stringify({ ibm, lenovo, hpe, dell }), "utf8");
  writeFileSync(stub, STUB, "utf8");
  mkdirSync(path.dirname(archiveFile), { recursive: true });
  const before = `[\n${archive.map((record) => JSON.stringify(record)).join(",\n")}\n]\n`;
  writeFileSync(archiveFile, before, "utf8");

  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(stub).href, SCRIPT, ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, WATCH_FIXTURE: fixture, IBM_REGION: "AP" },
    }
  );

  const raw = readFileSync(archiveFile, "utf8");
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    raw,
    unchanged: raw === before,
    records: JSON.parse(raw),
    leftovers: readdirSync(path.dirname(archiveFile)).filter((name) => name.endsWith(".tmp")),
  };
}

const ibmDoc = { key: "abc123", title: "IBM 공고", date: "2026-08-10" };
const ibmRecord = {
  vendor: "IBM",
  title: "IBM 공고",
  url: "https://www.ibm.com/docs/en/announcements/abc123",
  date: "2026-08-10",
  kind: "공고",
};

test("네 소스의 결과를 모아 아카이브에 더한다", () => {
  const result = run({
    ibm: { items: [ibmDoc] },
    lenovo: { items: [{ title: "Lenovo 안내서", url: "https://lenovopress.lenovo.com/lp1234", date: "2026-08-11" }] },
    hpe: { items: [{ title: "HPE QuickSpecs", id: "a0001", url: "https://www.hpe.com/doc/a0001", date: "2026-08-12" }] },
    dell: { items: [{ model: "R770", title: "PowerEdge R770 Spec Sheet", date: "2026-08-13" }] },
  });

  assert.equal(result.status, 0);
  assert.equal(result.records.length, 4);
  assert.deepEqual(
    result.records.map((record) => record.vendor),
    ["Dell", "HPE", "Lenovo", "IBM"],
    "날짜 내림차순으로 저장한다"
  );
  assert.match(result.output, /새 문서 4건/);
  assert.deepEqual(result.leftovers, [], "임시 파일을 남기지 않는다");
});

test("같은 날짜의 문서는 벤더 이름 순으로 줄 세운다", () => {
  const result = run({
    ibm: { items: [{ key: "same", title: "IBM", date: "2026-08-10" }] },
    lenovo: { items: [{ title: "Lenovo", url: "https://lenovopress.lenovo.com/lp1", date: "2026-08-10" }] },
    dell: { items: [{ model: "R770", title: "Dell", date: "2026-08-10" }] },
  });

  assert.deepEqual(
    result.records.map((record) => record.vendor),
    ["Dell", "IBM", "Lenovo"]
  );
});

test("벤더·URL·날짜가 같은 문서는 다시 담지 않는다", () => {
  const result = run({ archive: [ibmRecord, dellRecord], ibm: { items: [ibmDoc] } });

  assert.equal(result.status, 0);
  assert.match(result.output, /새 문서가 없습니다/);
  assert.ok(result.unchanged, "새 문서가 없으면 파일을 건드리지 않는다");
});

test("같은 문서의 날짜가 바뀌면 새 기록으로 쌓는다", () => {
  // 중복 키에 날짜가 들어 있어 재발행이 갱신으로 잡힌다.
  const result = run({
    archive: [ibmRecord, dellRecord],
    ibm: { items: [{ ...ibmDoc, date: "2026-08-14" }] },
  });

  assert.equal(result.records.length, 3);
  assert.deepEqual(
    result.records.map((record) => record.date),
    ["2026-08-14", "2026-08-13", "2026-08-10"]
  );
});

test("한 수집에서 중복으로 올라온 문서는 하나만 담는다", () => {
  const result = run({ archive: [dellRecord], ibm: { items: [ibmDoc, ibmDoc] } });

  assert.match(result.output, /새 문서 1건/);
  assert.deepEqual(result.records, [dellRecord, ibmRecord]);
});

test("일부 소스가 실패해도 나머지는 저장하고 종료 코드로 알린다", () => {
  const result = run({
    ibm: { items: [ibmDoc] },
    lenovo: { fail: true },
    hpe: { fail: true },
  });

  assert.equal(result.status, 1, "부분 실패는 조용히 지나가면 안 된다");
  assert.match(result.output, /Lenovo 수집 실패, 다른 소스는 계속 처리합니다/);
  assert.match(result.output, /HPE 수집 실패/);
  assert.deepEqual(
    result.records,
    [dellRecord, ibmRecord],
    "성공한 수집 결과는 그대로 저장한다"
  );
  assert.deepEqual(result.leftovers, []);
});

test("모든 소스가 실패하면 아카이브를 건드리지 않는다", () => {
  const result = run({
    archive: [ibmRecord],
    ibm: { fail: true },
    lenovo: { fail: true },
    hpe: { fail: true },
    dell: { fail: true },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /모든 벤더 소스 수집에 실패했습니다/);
  assert.ok(result.unchanged, "전부 실패한 날 기존 기록이 지워지면 안 된다");
  assert.deepEqual(result.leftovers, [], "잘린 임시 파일도 남기지 않는다");
});

test("문서를 하나도 못 받은 소스는 구조 변경을 의심하라고 경고한다", () => {
  const result = run({ ibm: { items: [] }, lenovo: { items: [] } });

  assert.equal(result.status, 0, "0건은 실패가 아니다");
  assert.match(result.output, /IBM가 문서를 하나도 돌려주지 않았습니다/);
  assert.match(result.output, /소스 구조 변경을 의심하세요/);
});

test("드라이런은 새 문서를 세어 보여 주고 저장하지 않는다", () => {
  const result = run({
    archive: [ibmRecord, dellRecord],
    ibm: { items: [{ ...ibmDoc, date: "2026-08-14" }] },
    args: ["--dry-run"],
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /IBM: 1건, 문서 날짜 2026-08-14/);
  assert.match(result.output, /드라이런이므로 파일을 저장하지 않았습니다/);
  assert.ok(result.unchanged);
});

test("저장한 아카이브는 다시 읽을 수 있는 JSON이다", () => {
  // 대상 파일을 직접 덮어쓰다 중단되면 잘린 JSON이 남아 다음 실행이 영구히
  // 실패한다. 저장 직후 형태를 그대로 확인한다.
  const result = run({ ibm: { items: [ibmDoc] } });

  assert.equal(result.raw.at(-1), "\n");
  assert.deepEqual(JSON.parse(result.raw), [dellRecord, ibmRecord]);
});
