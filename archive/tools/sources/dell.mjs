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

// PDF 메타데이터는 평문일 때도, 압축 객체 스트림에 있을 때도 있다. 두 방법의
// 성공하는 파일이 서로 달라 정규식을 먼저 보고 실패하면 파서로 넘긴다.
async function metadata(buffer) {
  const raw = buffer.toString("latin1");
  const title = raw.match(/\/Title\s*\(([^)]*)\)/)?.[1]?.trim();
  const stamp = raw.match(/\/(?:ModDate|CreationDate)\s*\(D:(\d{8})/)?.[1];
  const date = stamp && `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6)}`;
  if (title && date) return { title, date };

  try {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    const parsed = doc.getModificationDate() || doc.getCreationDate();
    return {
      title: title || doc.getTitle()?.trim() || null,
      date: date || parsed?.toISOString().slice(0, 10) || null,
    };
  } catch {
    return { title: title || null, date: date || null };
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
