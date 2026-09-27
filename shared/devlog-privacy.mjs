// Private text never crosses into the publishing/model input. Only fixed technical
// descriptions can leave this boundary; original messages and code are not retained.
const activities = [
  [/중복\s*(요청|실행)|idempoten|deduplicat/i, "중복 요청과 실행 처리"],
  [/접근\s*권한|권한\s*(검사|확인|검증)|authoriz|\bacl\b|\brbac\b/i, "접근 권한 확인"],
  [/인증|로그인|authenticat|\boauth\b/i, "인증 흐름"],
  [/재시도|retry|backoff/i, "실패한 요청의 재시도"],
  [/타임아웃|timeout/i, "응답 대기 시간 처리"],
  [/캐시|\bcach(e|ing|ed)\b/i, "캐시 처리"],
  [/입력\s*(검사|검증)|input validation/i, "입력값 검증"],
  [/예외|오류\s*처리|error handling|exception/i, "오류와 예외 처리"],
  [/페이지네이션|pagination/i, "목록의 페이지 처리"],
  [/테스트|\btests?\b/i, "검증용 테스트"],
  [/로깅|로그\s*(기록|수집)|logging|observability/i, "실행 상태 기록"],
  [/배포|\bdeploy(ment)?\b/i, "배포 과정"],
  [/리팩터|refactor/i, "코드 구조 정리"],
  [/문서|readme|\bdocs?\b|documentation/i, "개발 문서 정리"],
  [/화면|레이아웃|\bui\b|\bux\b|\bcss\b|layout/i, "화면 구성"],
  [/수집|크롤|\bcrawl|\bscrap/i, "자료 수집"],
  [/파싱|parser|parsing/i, "자료 형식 해석"],
  [/검색|\bsearch/i, "검색 처리"],
  [/데이터|데이타|데이터베이스|\bdatabase\b|\bschema\b|\bsql\b/i, "데이터 처리"],
  [/자동화|automation|workflow/i, "작업 자동화"],
  [/분석|\banaly/i, "자료 분석"],
  [/동기화|\bsync/i, "자료 동기화"],
  [/설계|아키텍처|architecture/i, "구조 설계"],
  [/설정|config|configuration/i, "실행 설정 정리"],
  [/의존성|패키지|dependenc|package/i, "의존성 관리"],
];

export const isPrivateCommit = (item) => item.visibility === "private" || item.private === true || item.visibility === "unknown";
export const isPrivateAlias = (repo) => /^(비공개-작업-[a-f0-9]{12}|비공개-프로젝트-[A-Z]+)$/.test(repo);

export function privateProjectLabel(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw Error("Invalid private project ordinal");
  let letters = "";
  for (let n = ordinal; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return `비공개-프로젝트-${letters}`;
}
export const privateDisplayName = (name) => /^비공개-프로젝트-[A-Z]+$/.test(name) ? name.replaceAll("-", " ") : name;

export async function privateAlias(repoId) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`devlog-private:${repoId}`)));
  return `비공개-작업-${Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 12)}`;
}

export function privateWorkSummary(message) {
  // Inspect the subject only. Bodies often contain product plans and code examples.
  const subject = String(message || "").split(/\r?\n/)[0];
  const found = activities.filter(([pattern]) => pattern.test(subject)).map(([, label]) => label);
  return found.length ? `${found.slice(0, 3).join(", ")} 관련 작업을 했다.` : "비공개 작업을 기록했다. 공개 가능한 기술 유형은 자동으로 분류하지 못했다.";
}

function verifiedSummary(text) {
  const value = String(text || "");
  const labels = value.replace(/ 관련 작업을 했다\.$/, "").split(", ");
  if (value.endsWith(" 관련 작업을 했다.") && labels.length <= 3 && labels.every((label) => activities.some(([, allowed]) => allowed === label))) return value;
  return privateWorkSummary(value);
}

export function publicationGroups(groups) {
  const result = new Map();
  for (const [repo, commits] of groups) {
    for (const item of commits) {
      const restricted = isPrivateCommit(item) || isPrivateAlias(repo);
      const name = restricted ? (item.publicRepo || (isPrivateAlias(repo) ? repo : "비공개 작업")) : repo;
      // Already sanitized references carry aliases. Never re-introduce details.
      const safe = restricted ? { repo: name, sha: item.publicSha || (isPrivateAlias(repo) ? item.sha : "0000000"), message: verifiedSummary(item.publicMessage || item.message), visibility: "private" } : item;
      if (!result.has(name)) result.set(name, []);
      result.get(name).push(safe);
    }
  }
  return result;
}
