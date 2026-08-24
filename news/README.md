# news — Cloudflare 뉴스 다이제스트

뉴스 수집, Workers AI 본문 생성, D1 저장, HTML·RSS 서비스가 모두 Cloudflare
Worker 안에서 실행됩니다. 매일 생성되는 결과를 GitHub에 커밋하지 않습니다.

사이트: <https://devlog.tkddls8848.workers.dev/>

## 실행 구조

```text
매일 07:00 KST Cron Trigger
  → RSS·Atom·Hacker News 수집
  → D1의 기존 URL과 비교해 중복 제거
  → Workers AI binding으로 한국어 본문 생성
  → 이슈·기사·실행 이력을 D1에 저장
  → 같은 Worker가 HTML과 /feed.xml을 동적으로 제공
```

Cloudflare binding을 사용하므로 Worker 런타임에는 `CF_ACCOUNT_ID`, `CF_API_TOKEN`,
`CF_WORKERS_API_TOKEN`이 필요하지 않습니다. GitHub Actions에도 뉴스레터용 Cloudflare
secret을 등록하지 않습니다.

## 구성

```text
worker/index.mjs              fetch·scheduled 진입점
worker/digest.mjs             수집·중복 제거·Workers AI 생성
worker/repository.mjs         D1 저장·조회와 기존 이슈 자동 이관
worker/render.mjs             HTML·RSS 렌더링
migrations/0001_initial.sql   D1 스키마
tools/feeds.mjs               피드 소스와 후보 주소
tools/rss.mjs                 RSS·Atom 파서와 URL 정규화
tools/sources/hackernews.mjs  Hacker News 수집기
tools/export-legacy-issues.mjs 기존 Markdown 이슈의 최초 D1 이관 데이터 생성
src/issues/                   이관할 기존 6개 이슈; 이후에는 늘어나지 않음
wrangler.jsonc                AI·D1·Assets·Cron binding 설정
```

## 최초 Cloudflare 설정

### 1. D1 생성

`news` 디렉터리에서 실행합니다.

```bash
npm install
npx wrangler login
npx wrangler d1 create devlog-news
```

현재 계정에는 APAC 리전의 `devlog-news` D1이 생성되어 있고 UUID도
`wrangler.jsonc`에 연결되어 있습니다. 다른 Cloudflare 계정으로 복제할 때만 위 명령의
출력으로 `database_id`를 교체합니다. Worker binding 이름은 `DB`입니다.

### 2. 최초 수동 배포

```bash
npm run deploy
```

이 명령은 정적 테마를 빌드하고, D1 migration을 적용한 다음 Worker를 배포합니다.
첫 HTTP 요청 또는 첫 Cron 실행 때 `src/issues`의 기존 6개 이슈가 D1에 idempotent하게
이관됩니다. `metadata.legacy_import_v1`이 이관 완료 여부를 기록합니다.

### 3. Workers Builds 연결

Cloudflare 대시보드의 `devlog → Settings → Builds`에서 저장소를 연결하고 다음과
같이 설정합니다.

| 설정 | 값 |
| --- | --- |
| Root directory | `news` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npm run db:migrate:remote && npm run deploy:worker` |
| Production branch | `main` |

모노레포 Build watch path는 `news/**`, `shared/**`를 포함합니다. Build API token은
Cloudflare의 Builds 설정에서 생성·선택하며 GitHub secret이 아닙니다. “build token has
been deleted or rolled” 오류가 나오면 같은 화면의 API token에서 새 토큰을 선택하고
저장한 뒤 재시도합니다.

GitHub의 `.github/workflows/news-publish.yml`과 `news-deploy.yml`은 제거되어
Workers Builds와 중복 배포하지 않습니다.

빌드 로그에서 `npm run build`가 `eleventy`만 실행하거나 Wrangler를 즉석 설치한다면
전체 전환 전의 커밋을 재시도한 것입니다. 최신 커밋에서는
`node tools/export-legacy-issues.mjs && eleventy`가 실행되고 Wrangler는 `npm ci`에서
설치됩니다. Build history에서 최신 `main` 커밋인지 확인합니다.

## Binding과 설정값

`wrangler.jsonc`가 설정의 원본입니다.

- `AI`: Workers AI binding
- `DB`: D1 binding
- `ASSETS`: CSS·JS 같은 정적 자산 binding
- Cron `0 22 * * *`: UTC 22:00, KST 07:00
- `CF_AI_MODEL`: 사용할 Workers AI 모델
- `NEWS_WINDOW_HOURS`: 수집 시간 창, 기본 24
- `NEWS_PER_SOURCE`: 소스별 최대 기사, 기본 3
- `NEWS_MAX_ITEMS`: 이슈 전체 최대 기사, 기본 30
- `HN_MIN_POINTS`: Hacker News 최소 점수, 기본 100
- `DEVLOG_URL`, `ARCHIVE_URL`: 상단 내비게이션 주소

공개 피드와 Workers binding만 사용하므로 별도 runtime secret은 없습니다.

## D1 데이터

- `issues`: 제목, 요약, Markdown 본문, 발행 시각
- `entries`: 원문 링크, 출처, 정규화 URL; `normalized_url`이 전역 중복을 차단
- `collection_runs`: 성공·부분 실패·빈 실행·실패 이력
- `metadata`: 기존 Markdown 이관 상태

상태 확인은 `GET /healthz`, RSS는 `GET /feed.xml`에서 제공합니다. 일부 소스가
실패해도 성공한 소식으로 발행하고 `partial` 이력을 남깁니다. 모든 소스가 실패하면
이슈를 만들지 않고 `failed` 이력을 남깁니다. Workers AI가 실패하면 원문 링크 목록을
본문으로 저장합니다.

## 로컬 개발

```bash
npm install
npm run build
npm run db:migrate:local
npm test
npm run dev
```

`npm run dev`는 Cron 테스트 엔드포인트도 엽니다. 실행 중 다음 요청으로 예약 작업을
시험할 수 있습니다.

```bash
curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"
```

Workers AI binding은 로컬 개발 중에도 원격 리소스와 사용량을 사용합니다. 피드 후보만
점검하려면 AI나 D1을 호출하지 않는 `npm run feeds:check`를 사용합니다.
