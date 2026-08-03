/**
 * IBM 발표 공고(Announcement letters) · 세일즈 매뉴얼
 *
 * IBM Documentation 의 공고 페이지(https://www.ibm.com/docs/en/announcements)가
 * 쓰는 API 를 그대로 부릅니다. 페이지는 SPA 라 HTML 을 긁을 수 없지만, 그
 * 화면이 부르는 엔드포인트는 인증 없이 JSON 을 줍니다.
 *
 *   GET /docs/api/v1/announcement/all?region=AP
 *
 * ⚠️ 이 목록은 "최근 2주" 롤링 창입니다.
 *    한 번에 전체 이력을 주지 않고 대략 2주치(70건 안팎)만 담깁니다. 그래서
 *    주기적으로 폴링해 새로 들어온 것을 쌓아 두어야 아카이브가 됩니다.
 *    며칠 이상 수집이 멈추면 그사이 공고는 창 밖으로 밀려나 영영 놓칩니다.
 *
 * region 은 공고가 유효한 지역입니다. 기본값 AP(아시아·태평양). 지역마다
 * 발표 날짜와 목록이 조금씩 다릅니다.
 */

const REGION = process.env.IBM_REGION || "AP";

const API = `https://www.ibm.com/docs/api/v1/announcement/all?region=${REGION}`;

/** 공고 종류 표기. API 는 대소문자가 섞여 오므로 눌러서 맞춥니다. */
const KIND_LABEL = {
  hardware: "하드웨어",
  software: "소프트웨어",
  services: "서비스",
  withdrawal: "판매 종료",
  statementofdirection: "방향성 발표",
  rpq: "RPQ",
};

const label = (rfaType) => KIND_LABEL[String(rfaType || "").toLowerCase()] || null;

export const vendor = "IBM";

export async function collect() {
  const res = await fetch(API, {
    headers: {
      Accept: "application/json",
      // UA 가 없으면 간헐적으로 막힙니다.
      "User-Agent": "Mozilla/5.0 (compatible; vendor-watch/1.0)",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`IBM API ${res.status}`);

  const list = await res.json();
  if (!Array.isArray(list)) throw new Error("IBM API 응답이 배열이 아닙니다.");

  const out = [];
  for (const item of list) {
    // 내부 전용 공고는 링크를 열어도 볼 수 없습니다.
    if (item.internalOnly) continue;
    if (!item.urlKey || !item.name) continue;

    const date = String(item.announcementDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const isManual = item.type === "salesManual";

    out.push({
      vendor,
      id: String(item.key),
      title: item.name.trim(),
      url: `https://www.ibm.com/docs/en/announcements/${item.urlKey}`,
      date,
      kind: isManual ? "세일즈 매뉴얼" : "공고",
      tag: label(item.rfaType),
      // 공고 번호(AD26-0841 등)는 IBM 내부에서 문서를 지목하는 식별자라
      // 그대로 남겨 둡니다.
      ref: item.globalLetterNumber || null,
      note: null,
      /*
       * IBM 은 같은 문서를 고쳐 다시 내보내면 announcementDate 가 바뀝니다.
       * key 만으로 보면 갱신을 놓치므로 날짜를 지문에 넣습니다.
       */
      fingerprint: `${item.key}:${date}`,
    });
  }

  return out;
}
