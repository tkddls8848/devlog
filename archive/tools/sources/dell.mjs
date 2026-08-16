import { gunzipSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

export const vendor = "Dell";

const ASSET = "https://www.delltechnologies.com/asset/en-us/products";
// 서버 모델 목록의 시드. 펌웨어 카탈로그가 유일하게 기계 판독 가능한 모델 목록이다.
const CATALOG = "https://downloads.dell.com/catalog/Catalog.gz";
const CONCURRENCY = 8;

// 스토리지·네트워크는 파일 이름 규칙이 없어 슬러그를 만들 수 없다. 확인된 것만 둔다.
// 새 제품은 여기에 직접 추가한다.
const CURATED = [
  ["storage", "dell-powerstore-gen3-spec-sheet"],
  ["storage", "dell-powerstore-gen2-spec-sheet"],
  ["storage", "h18143-dell-emc-powerstore-family-spec-sheet"],
  ["storage", "h18234-dell-powerstore-data-sheet"],
  ["storage", "powerflex-specification-sheet"],
  ["networking", "dell-networking-s4100-series-spec-sheet"],
  ["networking", "dell-powerswitch-s4300-series-spec-sheet"],
  ["networking", "dell-powerswitch-z9864f-on-spec-sheet"],
  ["networking", "dell-powerswitch-z9664f-on-spec-sheet"],
  ["networking", "dell-emc-powerswitch-z9432f-spec-sheet"],
  ["networking", "dell-emc-powerswitch-s5448f-on-spec-sheet"],
  ["networking", "dell_emc_networking_s4048t_on_series_spec_sheet"],
];

const kinds = { servers: "서버", storage: "스토리지", networking: "네트워크" };

async function serverCandidates() {
  const response = await fetch(CATALOG, {
    headers: { "User-Agent": "vendor-watch/1.0" },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Dell 카탈로그 ${response.status}`);

  // gzip 안은 UTF-16LE XML이다. 지원 시스템 이름만 뽑아 슬러그로 만든다.
  const xml = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf16le");
  const models = new Set(
    [...xml.matchAll(/<Model systemID="[^"]*"[^>]*>[\s\S]*?<Display lang="en">(?:<!\[CDATA\[)?([^<\]]*)/g)]
      .map((match) => match[1].trim().toLowerCase())
      .filter((name) => /^[a-z]{0,2}\d/.test(name))
  );
  return [...models].map((model) => ["servers", `poweredge-${model}-spec-sheet`]);
}

// 증분 업데이트된 PDF는 개정 이력만큼 날짜가 여러 번 박힌다. 앞에서부터 찾으면
// 가장 오래된 개정본을 집으므로 전부 모아 최신을 고른다.
const stampOf = (raw, field) => {
  const stamps = [...raw.matchAll(new RegExp(`/${field}\\s*\\(D:(\\d{8})`, "g"))].map(
    (match) => match[1]
  );
  if (!stamps.length) return null;
  const latest = stamps.sort().at(-1);
  return `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6)}`;
};

// PDF 메타데이터는 평문일 때도, 압축 객체 스트림에 있을 때도 있다. 두 방법의
// 성공하는 파일이 서로 달라 정규식을 먼저 보고 실패하면 파서로 넘긴다.
//
// 찾는 순서가 중요하다. 개정 감지가 목적이므로 수정일이 생성일보다 앞선다.
// ModDate와 CreationDate를 한 패턴으로 묶으면 파일에서 먼저 나오는 생성일이
// 잡히는데, Dell 스펙 시트는 생성일이 먼저라 재발행을 통째로 놓친다.
async function metadata(buffer) {
  const raw = buffer.toString("latin1");
  const title = raw.match(/\/Title\s*\(([^)]*)\)/)?.[1]?.trim();
  const modified = stampOf(raw, "ModDate");
  if (title && modified) return { title, date: modified };

  try {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    const parsed = doc.getModificationDate() || doc.getCreationDate();
    return {
      title: title || doc.getTitle()?.trim() || null,
      date: modified || parsed?.toISOString().slice(0, 10) || null,
    };
  } catch {
    // 파서까지 실패하면 평문 생성일이라도 쓴다.
    return { title: title || null, date: modified || stampOf(raw, "CreationDate") || null };
  }
}

const titleOf = (slug) =>
  slug
    .replace(/[-_]/g, " ")
    .replace(/\b(spec sheet|specification sheet|data sheet)\b/gi, "")
    .replace(/\b(dell|emc)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

async function fetchOne([category, slug]) {
  const url = `${ASSET}/${category}/technical-support/${slug}.pdf`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "vendor-watch/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.subarray(0, 4).toString() !== "%PDF") return null;

    const { title, date } = await metadata(buffer);
    if (!date) return null;
    return {
      vendor,
      title: (title || titleOf(slug)).replace(/\.pdf$/i, "").trim(),
      url,
      date,
      kind: "스펙 시트",
      tag: kinds[category],
      ref: slug,
    };
  } catch {
    return null;
  }
}

export async function collect() {
  const targets = [...(await serverCandidates()), ...CURATED];
  const found = [];

  // 후보가 200개 가까이 되고 대부분은 없는 문서라, 동시 요청 수를 묶어 돌린다.
  for (let index = 0; index < targets.length; index += CONCURRENCY) {
    const batch = await Promise.all(targets.slice(index, index + CONCURRENCY).map(fetchOne));
    found.push(...batch.filter(Boolean));
  }
  if (!found.length) throw new Error("Dell 스펙 시트를 하나도 받지 못했습니다.");

  return found.sort((a, b) => b.date.localeCompare(a.date));
}
