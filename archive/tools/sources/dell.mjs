import { gunzipSync } from "node:zlib";

export const vendor = "Dell";

// PowerEdge 계열과 그 부품의 펌웨어·드라이버 카탈로그. 인증 없이 열려 있다.
const CATALOG = "https://downloads.dell.com/catalog/Catalog.gz";

// 카탈로그는 롤링 목록이 아니라 전체 목록(1,800건 이상)이라 최근 것만 남긴다.
// 다른 벤더 수집기가 돌려주는 분량과 맞춘 값이다.
const LIMIT = 150;

const types = {
  Firmware: "펌웨어",
  Driver: "드라이버",
  Application: "애플리케이션",
  BIOS: "BIOS",
};

const attr = (block, name) => block.match(new RegExp(`${name}="([^"]*)"`))?.[1];

// <Tag ...><Display lang="en"><![CDATA[값]]></Display></Tag>에서 값만 꺼낸다.
// 여는 태그부터 닫는 태그까지로 범위를 좁혀 하위 요소의 Display와 섞이지 않게 한다.
function display(block, tag) {
  const open = block.indexOf(`<${tag}`);
  if (open < 0) return null;
  const close = block.indexOf(`</${tag}>`, open);
  if (close < 0) return null;
  const value = block
    .slice(open, close)
    .match(/<Display lang="en">(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Display>/)?.[1];
  return value?.replace(/\s+/g, " ").trim() || null;
}

function models(block) {
  const found = [
    ...block.matchAll(
      /<Model systemID="[^"]*"[^>]*>[\s\S]*?<Display lang="en">(?:<!\[CDATA\[)?([^<\]]*)/g
    ),
  ].map((match) => match[1].trim());
  return [...new Set(found)];
}

export async function collect() {
  const response = await fetch(CATALOG, {
    headers: { "User-Agent": "vendor-watch/1.0" },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Dell 카탈로그 ${response.status}`);

  // gzip 안은 UTF-16LE XML이다.
  const xml = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf16le");
  const blocks = xml.match(/<SoftwareComponent [\s\S]*?<\/SoftwareComponent>/g) || [];
  if (!blocks.length) throw new Error("Dell 카탈로그에서 컴포넌트를 찾지 못했습니다.");

  // 같은 릴리스가 지원 시스템 묶음마다 반복된다. releaseID로 묶되 지원 모델은 합친다.
  const byRelease = new Map();
  for (const block of blocks) {
    const ref = attr(block, "releaseID");
    const date = attr(block, "dateTime")?.slice(0, 10);
    const title = display(block, "Name");
    if (!ref || !date || !title) continue;

    if (!byRelease.has(ref)) {
      byRelease.set(ref, {
        ref,
        date,
        title,
        kind: types[display(block, "ComponentType")] || "펌웨어",
        tag: display(block, "Category"),
        models: new Set(),
      });
    }
    const entry = byRelease.get(ref);
    for (const model of models(block)) entry.models.add(model);
  }

  return [...byRelease.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, LIMIT)
    .map(({ ref, date, title, kind, tag, models: list }) => {
      const names = [...list];
      return {
        vendor,
        title,
        url: `https://www.dell.com/support/home/en-us/drivers/driversdetails?driverid=${ref}`,
        date,
        kind,
        ...(tag && { tag }),
        ref,
        ...(names.length && {
          note: `지원 모델 ${names.length}종: ${names.slice(0, 5).join(", ")}${names.length > 5 ? " 외" : ""}`,
        }),
      };
    });
}
