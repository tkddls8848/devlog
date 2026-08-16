import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { gzipSync } from "node:zlib";

import * as dell from "../tools/sources/dell.mjs";
import * as ibm from "../tools/sources/ibm.mjs";
import * as lenovo from "../tools/sources/lenovo.mjs";

// 수집기는 collect()만 내보내고 안쪽은 감춰져 있다. 네트워크를 스텁해 실제
// 코드 경로를 그대로 태운다.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (handler) => {
  globalThis.fetch = async (url) => handler(String(url));
};

const rss = (items) => `<rss><channel>${items.join("")}</channel></rss>`;

const rssItem = ({ title, link, pubDate }) =>
  `<item><title>${title}</title><link>${link}</link>` +
  (pubDate === undefined ? "" : `<pubDate>${pubDate}</pubDate>`) +
  `</item>`;

// Dell 카탈로그는 gzip으로 감싼 UTF-16LE XML이다.
const catalog = (models) =>
  gzipSync(
    Buffer.from(
      `<Manifest>${models
        .map((m) => `<Model systemID="0000"><Display lang="en"><![CDATA[${m}]]></Display></Model>`)
        .join("")}</Manifest>`,
      "utf16le"
    )
  );

const pdf = (info) => Buffer.from(`%PDF-1.7\n<< ${info} >>\n%%EOF\n`, "latin1");

const dellStub = (documents) =>
  stub((url) => {
    if (url.includes("downloads.dell.com")) {
      return new Response(catalog(Object.keys(documents)), { status: 200 });
    }
    const model = Object.keys(documents).find((m) =>
      url.endsWith(`poweredge-${m.toLowerCase()}-spec-sheet.pdf`)
    );
    if (model) return new Response(documents[model], { status: 200 });
    return new Response("", { status: 404 });
  });

test("Lenovo는 pubDate가 없거나 깨진 항목만 건너뛴다", async () => {
  stub(() =>
    new Response(
      rss([
        rssItem({
          title: "정상 문서",
          link: "https://lenovopress.lenovo.com/lp1234-guide",
          pubDate: "Tue, 12 Aug 2026 00:00:00 GMT",
        }),
        rssItem({ title: "pubDate 없음", link: "https://lenovopress.lenovo.com/lp5678-guide" }),
        rssItem({
          title: "pubDate 깨짐",
          link: "https://lenovopress.lenovo.com/lp9999-guide",
          pubDate: "언젠가",
        }),
      ]),
      { status: 200 }
    )
  );

  const rows = await lenovo.collect();
  assert.equal(rows.length, 1, "정상 항목만 남아야 한다");
  assert.equal(rows[0].title, "정상 문서");
  assert.equal(rows[0].date, "2026-08-12");
  assert.equal(rows[0].ref, "lp1234");
});

test("IBM은 발표일이 없거나 형식이 다른 항목을 버린다", async () => {
  stub(() =>
    new Response(
      JSON.stringify([
        { urlKey: "ok", name: "정상 공고", announcementDate: "2026-08-10T00:00:00.000+0000" },
        { urlKey: "nodate", name: "발표일 없음" },
        { urlKey: "baddate", name: "형식 다름", announcementDate: "10 Aug 2026" },
        {
          urlKey: "internal",
          name: "내부용",
          announcementDate: "2026-08-10T00:00:00.000+0000",
          internalOnly: true,
        },
      ]),
      { status: 200 }
    )
  );

  const rows = await ibm.collect();
  assert.deepEqual(
    rows.map((r) => r.url.split("/").pop()),
    ["ok"]
  );
  assert.equal(rows[0].date, "2026-08-10");
});

test("Dell은 생성일이 아니라 수정일을 쓴다", async () => {
  dellStub({
    R770: pdf(
      "/Title (PowerEdge R770 Spec Sheet) " +
        "/CreationDate (D:20240101000000+05'30') " +
        "/ModDate (D:20260522000000+05'30')"
    ),
  });

  const rows = await dell.collect();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-05-22", "생성일 2024-01-01을 쓰면 안 된다");
  assert.equal(rows[0].title, "PowerEdge R770 Spec Sheet");
  assert.equal(rows[0].tag, "서버");
  assert.equal(rows[0].ref, "poweredge-r770-spec-sheet");
});

test("Dell은 개정 이력이 여러 번 박힌 PDF에서 최신 수정일을 고른다", async () => {
  dellStub({
    T560: pdf(
      "/Title (PowerEdge T560 Spec Sheet) " +
        "/CreationDate (D:20240601000000+05'30') " +
        "/ModDate (D:20240624000000+05'30') " +
        "/ModDate (D:20250716000000+05'30')"
    ),
  });

  const rows = await dell.collect();
  assert.equal(rows[0].date, "2025-07-16", "먼저 나온 2024-06-24를 집으면 안 된다");
});

test("Dell은 수정일이 없으면 생성일로 내려간다", async () => {
  dellStub({
    R660: pdf("/Title (PowerEdge R660 Spec Sheet) /CreationDate (D:20250310000000+05'30')"),
  });

  const rows = await dell.collect();
  assert.equal(rows[0].date, "2025-03-10");
});

test("Dell은 날짜를 못 읽은 문서를 버린다", async () => {
  dellStub({
    R770: pdf("/Title (PowerEdge R770 Spec Sheet) /ModDate (D:20260522000000+05'30')"),
    R999: pdf("/Title (날짜 없는 문서)"),
  });

  const rows = await dell.collect();
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["poweredge-r770-spec-sheet"]
  );
});

test("Dell은 문서를 하나도 못 받으면 실패로 알린다", async () => {
  dellStub({});
  await assert.rejects(() => dell.collect(), /하나도 받지 못했습니다/);
});
