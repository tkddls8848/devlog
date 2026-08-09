export const vendor = "IBM";

const labels = {
  hardware: "하드웨어",
  software: "소프트웨어",
  services: "서비스",
  withdrawal: "판매 종료",
  statementofdirection: "방향성 발표",
  rpq: "RPQ",
};

export async function collect() {
  const region = process.env.IBM_REGION || "AP";
  const response = await fetch(
    `https://www.ibm.com/docs/api/v1/announcement/all?region=${region}`,
    {
      headers: { Accept: "application/json", "User-Agent": "vendor-watch/1.0" },
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok) throw new Error(`IBM API ${response.status}`);

  return (await response.json())
    .filter((item) => !item.internalOnly && item.urlKey && item.name)
    .map((item) => {
      const date = String(item.announcementDate).slice(0, 10);
      const tag = labels[String(item.rfaType || "").toLowerCase()];
      return {
        vendor,
        title: item.name.trim(),
        url: `https://www.ibm.com/docs/en/announcements/${item.urlKey}`,
        date,
        kind: item.type === "salesManual" ? "세일즈 매뉴얼" : "공고",
        ...(tag && { tag }),
        ...(item.globalLetterNumber && { ref: item.globalLetterNumber }),
      };
    });
}
