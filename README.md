# devlog

GitHub 커밋과 IBM·Lenovo·HPE 제품 문서 갱신을 매일 기록하는 Eleventy 사이트입니다.

사이트: <https://tkddls8848.github.io/devlog/>

## 페이지

- `/` 개발 일지 — 공개 저장소에 올린 커밋을 날짜별로 정리
- `/updates/` 갱신 일지 — 그날 새로 관측한 벤더 문서를 한 편으로 정리
- `/archive/` 아카이브 — 누적된 벤더 문서 목록, 벤더와 검색어로 거르기

## 구성

```text
tools/push-digest.mjs         GitHub 커밋 → 개발 일지
tools/vendor-watch.mjs        벤더 문서 → 갱신 일지와 아카이브
tools/sources/                IBM·Lenovo·HPE 수집기
tools/lib.mjs                 Cloudflare Workers AI 호출과 초안 파싱
src/posts/                    개발 일지
src/updates/                  갱신 일지
src/_data/vendorArchive.json  벤더 문서 아카이브
.state/last-seen.json         마지막으로 처리한 GitHub 이벤트 ID
```

## 수집 방식

개발 일지는 GitHub Events API로 공개 푸시를 읽어 `main`·`master` 커밋만 남기고,
커밋 작성일(KST)로 묶어 날짜마다 한 편씩 씁니다. 병합 커밋, 리버트, 봇 커밋,
`chore:`·`bump` 같은 메시지, 이 저장소 자신의 커밋은 제외합니다.

갱신 일지는 IBM 공고 API, Lenovo Press RSS, HPE QuickSpecs(Coveo 검색)에서
문서 목록을 받아 아카이브에 없는 것만 그날치 한 편으로 묶습니다. 세 소스 모두
최근 문서만 돌려주므로 수집이 며칠 멈추면 그사이 갱신은 놓칩니다. HPE는 공식
API가 아니라 검색 화면이 쓰는 내부 호출이라 HPE가 구조를 바꾸면 멈춥니다.

두 글 모두 Cloudflare Workers AI가 쓴 초안을 사람 검토 없이 발행합니다.

## 자동 발행

매일 09:10 KST에 `.github/workflows/publish.yml`이 두 수집기를 실행하고, 새 기록이
있을 때만 `main`에 커밋한 뒤 GitHub Pages에 배포합니다. 사람이 직접 `main`에 올린
변경은 `deploy.yml`이 빌드하고 배포합니다.

## 설정

GitHub 저장소의 Actions secrets에 다음 값을 등록합니다.

- `CF_ACCOUNT_ID`: Cloudflare 계정 ID
- `CF_API_TOKEN`: Workers AI 권한이 있는 API 토큰

Actions variables로 `CF_AI_MODEL`과 `IBM_REGION`을 바꿀 수 있습니다. 기본값은 각각
`@cf/meta/llama-3.1-8b-instruct-fast`, `AP`입니다. GitHub API는 워크플로가 자동으로
받는 `GITHUB_TOKEN`을 씁니다.

Settings → Pages의 Source는 `GitHub Actions`, Settings → Actions의 Workflow
permissions는 `Read and write permissions`로 설정합니다.

## 로컬 실행

Node 20 이상이 필요합니다. CI는 `.nvmrc`의 24를 씁니다.

```bash
npm install
npm run dev
npm run build

GH_TOKEN=... CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run digest
CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run watch:vendors
```

자동화 상태는 `.state/last-seen.json`의 마지막 GitHub 이벤트 ID 하나만 사용합니다.
벤더 문서 중복 여부는 별도 상태 파일 없이 아카이브의 벤더·URL·날짜로 판별합니다.
