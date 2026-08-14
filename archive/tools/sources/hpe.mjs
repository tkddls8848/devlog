export const vendor = "HPE";

const BASE = "https://support.hpe.com";
const PAGE = `${BASE}/connect/s/search?language=en_US`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36";

async function getToken() {
  const page = await fetch(PAGE, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(40000),
  });
  if (!page.ok) throw new Error(`HPE 페이지 ${page.status}`);
  const html = await page.text();
  const fwuid = html.match(/"fwuid"\s*:\s*"([^"]+)"/)?.[1];
  const appId = html.match(
    /"APPLICATION@markup:\/\/siteforce:communityApp"\s*:\s*"([^"]+)"/
  )?.[1];
  if (!fwuid || !appId) throw new Error("HPE Aura 컨텍스트를 찾지 못했습니다.");

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

  const response = await fetch(
    `${BASE}/connect/s/sfsites/aura?r=2&other.DCEHPESearch.getToken=1`,
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: PAGE,
      },
      body,
      signal: AbortSignal.timeout(40000),
    }
  );
  if (!response.ok) throw new Error(`HPE 토큰 ${response.status}`);
  const payload = (await response.text()).replace(/^while\(1\);/, "");
  const action = JSON.parse(payload).actions[0];
  if (action.state !== "SUCCESS") throw new Error(`HPE 토큰 ${action.state}`);
  return JSON.parse(action.returnValue).token;
}

const dateOf = (value) => {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match && `${match[3]}-${match[1]}-${match[2]}`;
};

export async function collect() {
  const response = await fetch("https://platform.cloud.coveo.com/rest/search/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      q: "",
      aq: "@kmdoctypedetails==cv66000043 @kmdoclanguagecode==cv1871440",
      numberOfResults: 150,
      sortCriteria: "@sysdate descending",
      searchHub: "HPE-Search-Page",
      locale: "en-US",
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`HPE Coveo ${response.status}`);

  return (await response.json()).results.flatMap((item) => {
    const raw = item.raw;
    const id = raw.kmdocid || raw.urihash;
    const date = dateOf(raw.kmdoclastmod);
    if (!id || !date || !item.title) return [];
    const ref = String(id).split("||")[0];
    return {
      vendor,
      title: item.title.trim(),
      url: raw.nimble_public_uri || `${BASE}/hpesc/public/docDisplay?docId=${encodeURIComponent(ref)}`,
      date,
      kind: "QuickSpecs",
      ref,
    };
  });
}
