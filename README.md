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
.state/last-seen.json         마지막 GitHub 이벤트 조회 시점(진단용)
```

## 수집 방식

개발 일지는 GitHub Events API의 최근 3페이지를 매번 다시 읽어 `main`·`master`
커밋만 남기고, 커밋 작성일(KST)로 묶어 날짜마다 한 편씩 씁니다. 이벤트 ID는
시간순이 아니므로 중단 기준으로 쓰지 않습니다. 기존 글에 저장된 커밋 SHA로
중복을 제거하며, 병합 커밋, 리버트, 봇 커밋, `chore:`·`bump` 같은 메시지와 이
저장소 자신의 커밋은 제외합니다.

갱신 일지는 IBM 공고 API, Lenovo Press RSS, HPE QuickSpecs(Coveo 검색)에서
문서 목록을 받아 아카이브에 없는 것만 그날치 한 편으로 묶습니다. 한 소스가
실패해도 나머지 소스의 결과는 저장합니다. 세 소스 모두 최근 문서만 돌려주므로
롤링 목록에서 이미 사라진 문서는 복구할 수 없습니다. HPE는 공식 API가 아니라
검색 화면이 쓰는 내부 호출이라 HPE가 구조를 바꾸면 멈출 수 있습니다.

두 글 모두 Cloudflare Workers AI가 쓴 초안을 사람 검토 없이 발행합니다. AI 호출이나
응답 파싱이 실패하면 수집 자료만 사용한 기본 본문을 대신 저장해 원본 기록을 놓치지
않습니다.

## 자동 발행

매일 09:10 KST에 `.github/workflows/publish.yml`이 두 수집기를 독립적으로 실행하고,
새 기록이 있을 때만 `main`에 커밋합니다. 이 푸시와 사람이 직접 `main`에 올린 변경은
모두 `deploy.yml`이 한 번만 빌드하고 GitHub Pages에 배포합니다.

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

# 저장하지 않고 현재 복구 대상을 확인
npm run digest:dry
npm run watch:vendors:dry
```

`.state/last-seen.json`은 마지막 조회 결과를 확인하는 진단 정보이며 중복 판별에는
사용하지 않습니다. 개발 일지는 기존 글의 커밋 SHA, 벤더 문서는 아카이브의
벤더·URL·날짜로 중복을 판별합니다.
