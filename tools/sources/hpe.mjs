/**
 * HPE QuickSpecs (제품 사양 문서)
 *
 * 셋 중 가장 손이 많이 갑니다. 검색 화면이 Salesforce 커뮤니티 위에 Coveo
 * 검색을 얹은 구조라, 목록을 받으려면 두 단계를 거쳐야 합니다.
 *
 *   1) 검색 페이지 HTML 에서 Aura 컨텍스트(fwuid, 앱 빌드 id)를 긁는다
 *   2) 그 컨텍스트로 Apex 액션 DCEHPESearch.getToken 을 불러
 *      익명 Coveo 토큰을 받는다
 *   3) 토큰으로 Coveo 검색 API 를 친다
 *
 * 토큰은 HPE 가 로그인하지 않은 방문자에게 자기 엔드포인트로 발급하는
 * 게스트 토큰입니다. 검색 화면을 여는 사람 누구나 같은 것을 받습니다.
 *
 * ⚠️ fwuid 는 Salesforce 를 배포할 때마다 바뀝니다. 그래서 값을 저장해 두지
 *    않고 실행할 때마다 페이지에서 다시 긁습니다. 저장해 두면 다음 배포 때
 *    조용히 깨집니다.
 *
 * ⚠️ 이 경로는 공식 API 가 아니라 화면이 쓰는 내부 호출입니다. HPE 가 구조를
 *    바꾸면 멈춥니다. 그때 다른 소스까지 같이 죽지 않도록 vendor-watch 는
 *    소스 하나의 실패를 건너뛰고 계속 갑니다.
 *
 * 필터에 쓰는 코드값은 support.hpe.com/hpesc/public/km/api/coveo_cv/en_US 가
 * 사람이 읽는 이름으로 풀어 줍니다.
 *   cv66000043 = QuickSpecs (kmdoctypedetails)
 *   cv1871440  = English    (kmdoclanguagecode)
 */

const BASE = "https://support.hpe.com";
const PAGE = `${BASE}/connect/s/search?language=en_US`;
const COVEO = "https://platform.cloud.coveo.com/rest/search/v2";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 한 번에 받아 올 건수. 갱신은 하루 수십 건 규모라 이 정도면 넉넉합니다. */
const PAGE_SIZE = 150;

export const vendor = "HPE";

async function getToken() {
  const page = await fetch(PAGE, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(40000),
  });
  if (!page.ok) throw new Error(`HPE 검색 페이지 ${page.status}`);
  const html = await page.text();

  const fwuid = html.match(/"fwuid"\s*:\s*"([^"]+)"/)?.[1];
  const appId = html.match(
    /"APPLICATION@markup:\/\/siteforce:communityApp"\s*:\s*"([^"]+)"/
  )?.[1];
  if (!fwuid || !appId) {
    throw new Error("Aura 컨텍스트(fwuid/app id)를 찾지 못했습니다. 페이지 구조가 바뀐 듯합니다.");
  }

  const body = new URLSearchParams({
    message: JSON.stringify({
      actions: [
        {
          id: "91;a",
          descriptor: "apex://DCEHPESearchController/ACTION$getToken",
          callingDescriptor: "markup://c:dceCoveoSearchCustomEndpointHandler",
          params: {},
        },
      ],
    }),
    "aura.context": JSON.stringify({
      mode: "PROD",
      fwuid,
      app: "siteforce:communityApp",
      loaded: { "APPLICATION@markup://siteforce:communityApp": appId },
      dn: [],
      globals: {},
      uad: false,
    }),
    "aura.pageURI": "/connect/s/search?language=en_US",
    "aura.token": "undefined",
  });

  const res = await fetch(`${BASE}/connect/s/sfsites/aura?r=2&other.DCEHPESearch.getToken=1`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: PAGE,
    },
    body,
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`HPE getToken ${res.status}`);

  let text = await res.text();
  // Aura 응답은 JSON 하이재킹을 막으려고 앞에 while(1); 을 붙여 보냅니다.
  if (text.startsWith("while(1);")) text = text.slice("while(1);".length);

  const action = JSON.parse(text).actions?.[0];
  if (action?.state !== "SUCCESS") {
    throw new Error(`HPE getToken 액션 실패: ${action?.state || "응답 형식 불명"}`);
  }
  const token = JSON.parse(action.returnValue)?.token;
  if (!token) throw new Error("HPE 응답에 Coveo 토큰이 없습니다.");
  return token;
}

/** "07/29/2026 00:00:00.000" → "2026-07-29" */
function parseModDate(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export async function collect() {
  const token = await getToken();

  const res = await fetch(COVEO, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      q: "",
      aq: "@kmdoctypedetails==cv66000043 @kmdoclanguagecode==cv1871440",
      numberOfResults: PAGE_SIZE,
      /*
       * kmdoclastmod 는 "MM/DD/YYYY" 문자열이라 정렬하면 연도를 무시하고
       * 월일로 줄을 세웁니다(12/30/2025 가 07/29/2026 보다 앞섬). 색인 시각인
       * sysdate 는 epoch 숫자라 제대로 정렬됩니다. 문서가 고쳐지면 다시
       * 색인되므로 최근 갱신이 앞으로 옵니다.
       */
      sortCriteria: "@sysdate descending",
      searchHub: "HPE-Search-Page",
      locale: "en-US",
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HPE Coveo ${res.status}`);

  const data = await res.json();
  const out = [];

  for (const item of data.results || []) {
    const raw = item.raw || {};
    const docId = raw.kmdocid || raw.urihash;
    if (!docId || !item.title) continue;

    // 문서가 밝힌 갱신일. 없으면 색인 시각으로 대신합니다.
    const date =
      parseModDate(raw.kmdoclastmod) ||
      (raw.sysdate ? new Date(Number(raw.sysdate)).toISOString().slice(0, 10) : null);
    if (!date) continue;

    const url =
      raw.nimble_public_uri ||
      `${BASE}/hpesc/public/docDisplay?docId=${encodeURIComponent(String(docId).split("||")[0])}`;

    out.push({
      vendor,
      id: String(docId),
      title: item.title.trim(),
      url,
      date,
      kind: "QuickSpecs",
      tag: null,
      ref: String(docId).split("||")[0],
      note: null,
      // 갱신일이 바뀌면 새 항목으로 봅니다.
      fingerprint: `${docId}:${date}`,
    });
  }

  return out;
}
