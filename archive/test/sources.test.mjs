import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { gzipSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

import * as dell from "../tools/sources/dell.mjs";
import * as hpe from "../tools/sources/hpe.mjs";
import * as ibm from "../tools/sources/ibm.mjs";
import * as lenovo from "../tools/sources/lenovo.mjs";

// 수집기는 vendor와 collect()만 내보내고 안쪽은 감춰져 있다. 네트워크를 스텁해
// 실제 코드 경로를 그대로 태운다.
const realFetch = globalThis.fetch;
const realWarn = console.warn;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

// handler는 요청 URL과 init을 그대로 받는다. init까지 넘기는 이유는 HPE가
// 받아 온 토큰을 실제로 Coveo 요청에 싣는지 확인해야 하기 때문이다.
const stub = (handler) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
};

const captureWarnings = () => {
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  return lines;
};

test("네 수집기 모두 vendor 이름과 collect()를 내보낸다", () => {
  // vendor-watch는 sources[index].vendor로 실패 로그를 남긴다. 이름이 빠지면
  // 수집이 조용히 "undefined: 0건"이 된다.
  for (const source of [ibm, lenovo, hpe, dell]) {
    assert.equal(typeof source.vendor, "string");
    assert.ok(source.vendor.length);
    assert.equal(typeof source.collect, "function");
  }
});

// ---------------------------------------------------------------- Lenovo

const rss = (items) => `<rss><channel>${items.join("")}</channel></rss>`;

const rssItem = ({ title, link, guid, pubDate, category, description }) =>
  `<item><title>${title}</title>` +
  (link === undefined ? "" : `<link>${link}</link>`) +
  (guid === undefined ? "" : `<guid>${guid}</guid>`) +
  (pubDate === undefined ? "" : `<pubDate>${pubDate}</pubDate>`) +
  (category === undefined ? "" : `<category>${category}</category>`) +
  (description === undefined ? "" : `<description>${description}</description>`) +
  `</item>`;

const lenovoStub = (items) => stub(() => new Response(rss(items), { status: 200 }));

test("Lenovo는 pubDate가 없거나 깨진 항목만 건너뛴다", async () => {
  lenovoStub([
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
  ]);

  const rows = await lenovo.collect();
  assert.equal(rows.length, 1, "정상 항목만 남아야 한다");
  assert.equal(rows[0].title, "정상 문서");
  assert.equal(rows[0].date, "2026-08-12");
  assert.equal(rows[0].ref, "lp1234");
});

test("Lenovo는 Change History의 최신 항목만 노트로 남긴다", async () => {
  lenovoStub([
    rssItem({
      title: "ThinkSystem 안내서",
      link: "https://lenovopress.lenovo.com/lp1784-guide",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
      description:
        "&lt;p&gt;개요&lt;/p&gt;&lt;h2&gt;Change History&lt;/h2&gt;" +
        "&lt;h3&gt;27 May 2026&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Added Gen5 support&lt;/li&gt;&lt;/ul&gt;" +
        "&lt;h3&gt;10 Jan 2026&lt;/h3&gt;&lt;p&gt;First release&lt;/p&gt;",
    }),
  ]);

  const rows = await lenovo.collect();
  assert.equal(
    rows[0].note,
    "27 May 2026: Added Gen5 support",
    "가장 위의 개정만 쓰고 이전 개정은 섞이면 안 된다"
  );
});

test("Lenovo는 Change History가 없으면 노트 없이 둔다", async () => {
  lenovoStub([
    rssItem({
      title: "노트 없는 문서",
      link: "https://lenovopress.lenovo.com/lp2000-guide",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
      description: "&lt;p&gt;개정 이력이 없는 본문&lt;/p&gt;",
    }),
  ]);

  const [row] = await lenovo.collect();
  assert.ok(!("note" in row), "빈 note 키를 만들면 안 된다");
});

test("Lenovo는 link가 없으면 guid를 쓰고 ref는 문서 번호에서 뽑는다", async () => {
  lenovoStub([
    rssItem({
      title: "guid만 있는 문서",
      guid: "https://lenovopress.lenovo.com/tips1608-thinksystem",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
    }),
    rssItem({
      title: "데이터시트",
      link: "https://lenovopress.lenovo.com/ds0123-datasheet",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
    }),
    rssItem({
      title: "문서 번호 없음",
      link: "https://lenovopress.lenovo.com/announcement",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
    }),
  ]);

  const rows = await lenovo.collect();
  assert.equal(rows[0].url, "https://lenovopress.lenovo.com/tips1608-thinksystem");
  assert.deepEqual(
    rows.map((row) => row.ref),
    ["tips1608", "ds0123", undefined]
  );
  assert.ok(!("ref" in rows[2]), "번호를 못 찾으면 ref 키를 만들지 않는다");
});

test("Lenovo는 category를 종류로 쓰고 없으면 기본값을 넣는다", async () => {
  lenovoStub([
    rssItem({
      title: "Product Guide 문서",
      link: "https://lenovopress.lenovo.com/lp1111-guide",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
      category: "Product Guide",
    }),
    rssItem({
      title: "분류 없는 문서",
      link: "https://lenovopress.lenovo.com/lp2222-guide",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
    }),
  ]);

  assert.deepEqual(
    (await lenovo.collect()).map((row) => row.kind),
    ["Product Guide", "기술 문서"]
  );
});

test("Lenovo는 CDATA와 HTML 엔티티를 풀어 제목에 넣는다", async () => {
  lenovoStub([
    rssItem({
      title: "<![CDATA[Lenovo &amp; Intel &lt;가이드&gt;]]>",
      link: "https://lenovopress.lenovo.com/lp3333-guide",
      pubDate: "Wed, 27 May 2026 00:00:00 GMT",
    }),
  ]);

  assert.equal((await lenovo.collect())[0].title, "Lenovo & Intel <가이드>");
});

test("Lenovo는 RSS 응답이 실패하면 상태 코드를 알린다", async () => {
  stub(() => new Response("", { status: 503 }));
  await assert.rejects(() => lenovo.collect(), /Lenovo RSS 503/);
});

// ------------------------------------------------------------------- IBM

const ibmStub = (items) => stub(() => new Response(JSON.stringify(items), { status: 200 }));

test("IBM은 발표일이 없거나 형식이 다른 항목을 버린다", async () => {
  ibmStub([
    { urlKey: "ok", name: "정상 공고", announcementDate: "2026-08-10T00:00:00.000+0000" },
    { urlKey: "nodate", name: "발표일 없음" },
    { urlKey: "baddate", name: "형식 다름", announcementDate: "10 Aug 2026" },
    {
      urlKey: "internal",
      name: "내부용",
      announcementDate: "2026-08-10T00:00:00.000+0000",
      internalOnly: true,
    },
  ]);

  const rows = await ibm.collect();
  assert.deepEqual(
    rows.map((r) => r.url.split("/").pop()),
    ["ok"]
  );
  assert.equal(rows[0].date, "2026-08-10");
});

test("IBM은 rfaType을 한국어 분류로 옮기고 모르는 값은 비워 둔다", async () => {
  const types = ["hardware", "software", "services", "withdrawal", "statementOfDirection", "rpq"];
  ibmStub([
    ...types.map((rfaType, index) => ({
      urlKey: `t${index}`,
      name: rfaType,
      announcementDate: "2026-08-10T00:00:00.000+0000",
      rfaType,
    })),
    {
      urlKey: "unknown",
      name: "모르는 분류",
      announcementDate: "2026-08-10T00:00:00.000+0000",
      rfaType: "somethingElse",
    },
  ]);

  const rows = await ibm.collect();
  assert.deepEqual(
    rows.slice(0, types.length).map((row) => row.tag),
    ["하드웨어", "소프트웨어", "서비스", "판매 종료", "방향성 발표", "RPQ"]
  );
  assert.ok(!("tag" in rows.at(-1)), "모르는 rfaType은 tag 키를 만들지 않는다");
});

test("IBM은 세일즈 매뉴얼과 일반 공고를 구분하고 문서 번호를 ref로 쓴다", async () => {
  ibmStub([
    {
      urlKey: "manual",
      name: "세일즈 매뉴얼",
      announcementDate: "2026-08-10T00:00:00.000+0000",
      type: "salesManual",
      globalLetterNumber: "AP26-0123",
    },
    { urlKey: "letter", name: "일반 공고", announcementDate: "2026-08-10T00:00:00.000+0000" },
  ]);

  const [manual, letter] = await ibm.collect();
  assert.equal(manual.kind, "세일즈 매뉴얼");
  assert.equal(manual.ref, "AP26-0123");
  assert.equal(letter.kind, "공고");
  assert.ok(!("ref" in letter), "문서 번호가 없으면 ref 키를 만들지 않는다");
});

test("IBM은 IBM_REGION으로 조회 지역을 바꾼다", async () => {
  const previous = process.env.IBM_REGION;
  const calls = ibmStub([]);
  try {
    process.env.IBM_REGION = "US";
    await ibm.collect();
    assert.match(calls[0].url, /region=US/);

    delete process.env.IBM_REGION;
    await ibm.collect();
    assert.match(calls[1].url, /region=AP/, "기본값은 AP다");
  } finally {
    if (previous === undefined) delete process.env.IBM_REGION;
    else process.env.IBM_REGION = previous;
  }
});

test("IBM은 API 응답이 실패하면 상태 코드를 알린다", async () => {
  stub(() => new Response("", { status: 500 }));
  await assert.rejects(() => ibm.collect(), /IBM API 500/);
});

// ------------------------------------------------------------------- HPE

// HPE는 공식 API가 아니라 검색 화면의 내부 호출이다. 페이지에서 Aura 컨텍스트를
// 긁어 토큰을 받고, 그 토큰으로 Coveo를 부르는 3단계를 그대로 태운다.
const AURA_PAGE = `<html><script>{"fwuid":"FWUID1","APPLICATION@markup://siteforce:communityApp":"APPID1"}</script></html>`;

const hpeStub = ({ page = AURA_PAGE, tokenState = "SUCCESS", token = "coveo-token", results = [] }) =>
  stub((url) => {
    if (url.includes("/connect/s/sfsites/aura")) {
      // 실제 응답은 JSON 하이재킹 방지 접두사가 붙어 온다.
      return new Response(
        `while(1);${JSON.stringify({
          actions: [{ state: tokenState, returnValue: JSON.stringify({ token }) }],
        })}`,
        { status: 200 }
      );
    }
    if (url.includes("support.hpe.com/connect/s/search")) return new Response(page, { status: 200 });
    if (url.includes("platform.cloud.coveo.com")) {
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    throw new Error(`예상치 못한 요청 ${url}`);
  });

test("HPE는 받아 온 토큰으로 Coveo를 부르고 QuickSpecs를 만든다", async () => {
  const calls = hpeStub({
    results: [
      {
        title: "  HPE ProLiant DL380 Gen12 QuickSpecs  ",
        raw: { kmdocid: "a00012345en_us||1", kmdoclastmod: "05/22/2026 10:11:12" },
      },
    ],
  });

  const rows = await hpe.collect();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    vendor: "HPE",
    title: "HPE ProLiant DL380 Gen12 QuickSpecs",
    url: "https://support.hpe.com/hpesc/public/docDisplay?docId=a00012345en_us",
    date: "2026-05-22",
    kind: "QuickSpecs",
    ref: "a00012345en_us",
  });

  const coveo = calls.find((call) => call.url.includes("platform.cloud.coveo.com"));
  assert.equal(coveo.init.headers.Authorization, "Bearer coveo-token");
});

test("HPE는 공개 URL이 있으면 그대로 쓰고 없으면 docId 주소를 만든다", async () => {
  hpeStub({
    results: [
      {
        title: "공개 주소 있음",
        raw: {
          kmdocid: "a00099999en_us",
          kmdoclastmod: "01/09/2026",
          nimble_public_uri: "https://www.hpe.com/psnow/doc/a00099999enw",
        },
      },
      {
        title: "urihash만 있음",
        raw: { urihash: "Xy7Z", kmdoclastmod: "01/09/2026" },
      },
    ],
  });

  const rows = await hpe.collect();
  assert.equal(rows[0].url, "https://www.hpe.com/psnow/doc/a00099999enw");
  assert.equal(rows[1].ref, "Xy7Z", "kmdocid가 없으면 urihash로 내려간다");
});

test("HPE는 날짜, 제목, 식별자가 빠진 결과를 버린다", async () => {
  hpeStub({
    results: [
      { title: "정상", raw: { kmdocid: "a1", kmdoclastmod: "05/22/2026" } },
      { title: "날짜 없음", raw: { kmdocid: "a2" } },
      { title: "날짜 형식 다름", raw: { kmdocid: "a3", kmdoclastmod: "2026-05-22" } },
      { title: "식별자 없음", raw: { kmdoclastmod: "05/22/2026" } },
      { raw: { kmdocid: "a5", kmdoclastmod: "05/22/2026" } },
    ],
  });

  assert.deepEqual(
    (await hpe.collect()).map((row) => row.ref),
    ["a1"]
  );
});

test("HPE는 Aura 컨텍스트를 못 찾으면 실패한다", async () => {
  // 검색 화면 구조가 바뀌면 여기서 멈춘다. 조용히 0건이 되면 안 된다.
  hpeStub({ page: "<html>구조가 바뀐 페이지</html>" });
  await assert.rejects(() => hpe.collect(), /Aura 컨텍스트를 찾지 못했습니다/);
});

test("HPE는 토큰 발급이 실패하면 상태를 알린다", async () => {
  hpeStub({ tokenState: "ERROR" });
  await assert.rejects(() => hpe.collect(), /HPE 토큰 ERROR/);
});

test("HPE는 검색 페이지가 실패하면 상태 코드를 알린다", async () => {
  stub(() => new Response("", { status: 502 }));
  await assert.rejects(() => hpe.collect(), /HPE 페이지 502/);
});

// ------------------------------------------------------------------ Dell

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

// 메타데이터가 압축 객체 스트림 안에 있는 진짜 PDF. 평문 정규식에는 하나도
// 잡히지 않아 pdf-lib 경로로만 읽힌다.
async function streamPdf({ title, created, modified }) {
  const doc = await PDFDocument.create();
  doc.addPage();
  if (title) doc.setTitle(title);
  doc.setCreationDate(new Date(created));
  doc.setModificationDate(new Date(modified ?? created));
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

// documents 키는 카탈로그에 실리는 서버 모델명이다. curated는 슬러그를 그대로
// 받고, failing에 든 슬러그는 네트워크 오류를 낸다.
const dellStub = (documents, { curated = {}, failing = [] } = {}) =>
  stub((url) => {
    if (url.includes("downloads.dell.com")) {
      return new Response(catalog(Object.keys(documents)), { status: 200 });
    }
    if (failing.some((slug) => url.includes(slug))) throw new Error("연결이 끊겼습니다");
    const model = Object.keys(documents).find((m) =>
      url.endsWith(`poweredge-${m.toLowerCase()}-spec-sheet.pdf`)
    );
    if (model) return new Response(documents[model], { status: 200 });
    const slug = Object.keys(curated).find((s) => url.endsWith(`${s}.pdf`));
    if (slug) return new Response(curated[slug], { status: 200 });
    return new Response("", { status: 404 });
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

test("Dell은 평문에 메타데이터가 없으면 파서로 읽는다", async () => {
  // 압축 객체 스트림에 든 PDF. 정규식만 쓰면 통째로 놓친다.
  dellStub({
    R7725: await streamPdf({
      title: "PowerEdge R7725 Spec Sheet",
      created: "2024-02-02T00:00:00Z",
      modified: "2026-04-09T00:00:00Z",
    }),
  });

  const rows = await dell.collect();
  assert.equal(rows.length, 1, "파서 경로로 읽어야 한다");
  assert.equal(rows[0].title, "PowerEdge R7725 Spec Sheet");
  assert.equal(rows[0].date, "2026-04-09", "파서 경로에서도 수정일이 생성일보다 앞선다");
});

test("Dell은 제목이 없으면 슬러그로 제목을 만든다", async () => {
  dellStub({
    R770: pdf("/ModDate (D:20260522000000+05'30')"),
  });

  assert.equal((await dell.collect())[0].title, "POWEREDGE R770");
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

test("Dell은 PDF가 아닌 응답을 버린다", async () => {
  // 없는 문서가 200과 함께 안내 페이지를 돌려주는 경우가 있다.
  dellStub({
    R770: pdf("/Title (PowerEdge R770 Spec Sheet) /ModDate (D:20260522000000+05'30')"),
    R999: Buffer.from("<html><body>Page not found</body></html>", "latin1"),
  });

  const rows = await dell.collect();
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["poweredge-r770-spec-sheet"]
  );
});

test("Dell은 스토리지·네트워크 문서에 맞는 분류를 붙인다", async () => {
  const calls = dellStub(
    { R770: pdf("/Title (PowerEdge R770 Spec Sheet) /ModDate (D:20260522000000+05'30')") },
    {
      curated: {
        "dell-powerstore-gen3-spec-sheet": pdf(
          "/Title (PowerStore Gen3 Spec Sheet) /ModDate (D:20260601000000+05'30')"
        ),
        "dell-powerswitch-z9864f-on-spec-sheet": pdf(
          "/Title (PowerSwitch Z9864F-ON Spec Sheet) /ModDate (D:20260401000000+05'30')"
        ),
      },
    }
  );

  const byRef = new Map((await dell.collect()).map((row) => [row.ref, row]));
  assert.equal(byRef.get("dell-powerstore-gen3-spec-sheet").tag, "스토리지");
  assert.equal(byRef.get("dell-powerswitch-z9864f-on-spec-sheet").tag, "네트워크");
  assert.equal(byRef.get("poweredge-r770-spec-sheet").tag, "서버");
  assert.ok(
    calls.some((call) => call.url.includes("/storage/technical-support/")),
    "분류가 URL 경로에도 반영된다"
  );
});

test("Dell은 네트워크 오류를 404와 구분해 경고로 남긴다", async () => {
  // 후보 대부분은 없는 문서라 404는 정상이다. 타임아웃이나 연결 오류는 다르다.
  const warnings = captureWarnings();
  dellStub(
    {
      R770: pdf("/Title (PowerEdge R770 Spec Sheet) /ModDate (D:20260522000000+05'30')"),
      R999: pdf("/Title (받지 못한 문서) /ModDate (D:20260101000000+05'30')"),
    },
    { failing: ["poweredge-r999-spec-sheet"] }
  );

  const rows = await dell.collect();
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["poweredge-r770-spec-sheet"],
    "실패한 후보만 빠지고 나머지는 그대로 저장한다"
  );
  assert.ok(
    warnings.some((line) => line.includes("오류로 건너뛰었습니다") && line.includes("poweredge-r999")),
    `실패를 알리는 경고가 있어야 한다: ${JSON.stringify(warnings)}`
  );
});

test("Dell은 문서를 하나도 못 받으면 실패로 알린다", async () => {
  dellStub({});
  await assert.rejects(() => dell.collect(), /하나도 받지 못했습니다/);
});

test("Dell은 카탈로그를 못 받으면 상태 코드를 알린다", async () => {
  stub(() => new Response("", { status: 403 }));
  await assert.rejects(() => dell.collect(), /Dell 카탈로그 403/);
});

test("Dell은 최신 문서를 앞에 둔다", async () => {
  dellStub({
    R660: pdf("/Title (R660) /ModDate (D:20250310000000+05'30')"),
    R770: pdf("/Title (R770) /ModDate (D:20260522000000+05'30')"),
    T560: pdf("/Title (T560) /ModDate (D:20251101000000+05'30')"),
  });

  assert.deepEqual(
    (await dell.collect()).map((row) => row.date),
    ["2026-05-22", "2025-11-01", "2025-03-10"]
  );
});
