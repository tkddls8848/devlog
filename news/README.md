# news — Cloudflare Worker `devlog` (작업 회고)

이 폴더가 작업 회고 Worker 전체입니다. 커밋 수집·글 작성·D1 저장·HTML 서비스와 웹 편집기가
모두 여기서 실행됩니다. 매일 생성되는 결과는 GitHub에 커밋하지 않습니다. 글쓰기 방식은
[`devlog/README.md`](../devlog/README.md)를 보세요.

사이트: <https://devlog.tkddls8848.workers.dev/devlog/>

뉴스 다이제스트와 벤더 문서 아카이브는 2026-10에
[specsheet](https://github.com/tkddls8848/specsheet) 저장소의 Worker `specsheet`와 D1 `specsheet`로
옮겼습니다. 이 Worker는 옛 경로 `/issues/*`, `/feed.xml`, `/archive`, `/archive/*`를
<https://specsheet.tkddls8848.workers.dev>의 같은 경로·쿼리로 301 이동하고, `/`는 `/devlog/`로 보냅니다
(`worker/redirects.mjs`).

Cloudflare binding을 사용하므로 Worker 런타임에는 `CF_ACCOUNT_ID`, `CF_API_TOKEN`,
`CF_WORKERS_API_TOKEN`이 필요하지 않습니다.

## 구성

```text
worker/index.mjs              fetch·scheduled 진입점, 라우팅
worker/redirects.mjs          specsheet로 옮긴 옛 경로의 301
worker/devlog.mjs             작업 회고 커밋 수집과 자동 작성·발행
worker/devlog-writer.mjs      작업 기록 본문 작성(저장소별 병렬, gpt-oss-120b)
worker/devlog-admin.mjs       웹 편집기(로그인, 편집, 미리보기, 맞춤법, AI 다시 쓰기)
worker/devlog-auth.mjs        편집기 로그인 쿠키
worker/devlog-spellcheck.mjs  맞춤법 검사(다음 검사기, 실패 시 Workers AI)
worker/repository.mjs         D1 저장·조회
worker/render.mjs             HTML·RSS 렌더링
migrations/0001~0006          D1 스키마(0001·0002는 옮긴 뉴스·아카이브 테이블)
tools/devlog-journal.mjs      작업 회고 CLI(npm run journal)
tools/backfill-private.mjs, rename-private-labels.mjs  비공개 작업 소급 반영·별칭 정리
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
npm run deploy:with-migrations
```

최초 배포나 스키마 변경 때만 D1 권한이 있는 관리자 환경에서 이 명령을 실행합니다.
일반 `npm run deploy`는 정적 테마를 빌드하고 Worker만 배포하며 D1 migration을
실행하지 않습니다.
개발일지의 기존 Markdown은 D1 이관 후 제거했습니다. 운영 데이터의
단일 원본은 D1이며 새 발행 결과도 GitHub에 커밋하지 않습니다.

### 3. Workers Builds 연결

Cloudflare 대시보드의 `devlog → Settings → Builds`에서 저장소를 연결하고 다음과
같이 설정합니다.

| 설정 | 값 |
| --- | --- |
| Root directory | `news` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |

모노레포 Build watch path는 `news/**`, `shared/**`를 포함합니다. Build API token은
Cloudflare의 Builds 설정에서 생성·선택하며 GitHub secret이 아닙니다. “build token has
been deleted or rolled” 오류가 나오면 같은 화면의 API token에서 새 토큰을 선택하고
저장한 뒤 재시도합니다.

Workers Builds의 Deploy command에는 D1 migration을 넣지 않습니다. 기본 Build API
token은 Worker 업로드 권한은 있지만 D1 쿼리 권한은 없으므로 함께 실행하면 Cloudflare
API 오류 `7403`으로 배포가 중단됩니다. 새 migration은 먼저 D1 권한이 있는 관리자
환경에서 `npm run db:migrate:remote`로 적용하고, Git push로 Worker 배포를 진행합니다.
Cloudflare의 Build command와 Deploy command는 `wrangler.jsonc`가 아니라 대시보드의
Builds 설정에 저장되므로 대시보드 값도 위 표와 정확히 같아야 합니다.

GitHub의 `.github/workflows/news-publish.yml`과 `news-deploy.yml`은 제거되어
Workers Builds와 중복 배포하지 않습니다.

## Binding과 설정값

`wrangler.jsonc`가 설정의 원본입니다.

- `AI`: Workers AI binding
- `DB`: D1 binding
- `ASSETS`: CSS·JS 같은 정적 자산 binding
- Cron `10 0 * * *`: UTC 00:10, KST 09:10, 작업 기록 자동 작성·발행 (`DEVLOG_AUTO_PUBLISH=false`면 초안만, `devlog/README.md` 참고)
- `DEVLOG_URL`, `ARCHIVE_URL`, `NEWS_URL`: 상단 내비게이션 주소 (`ARCHIVE_URL`, `NEWS_URL`은 specsheet Worker)

개발일지의 GitHub API 요청은 익명 호출 제한에 걸리지 않도록 Worker secret
`GITHUB_TOKEN`을 필수로 사용합니다. 저장소나 `wrangler.jsonc`에 값을 쓰지 말고
`news` 디렉터리에서 다음 명령으로 등록합니다.

```bash
npx wrangler secret put GITHUB_TOKEN
```

공개 저장소의 이벤트와 커밋만 읽으므로 별도의 배포용 토큰이 아니라 GitHub 읽기 전용
fine-grained personal access token을 사용합니다. `CF_ACCOUNT_ID`, `CF_API_TOKEN`,
`CF_WORKERS_API_TOKEN`은 Worker 런타임 secret이 아닙니다.

## D1 데이터

- `devlog_posts`, `devlog_commits`, `devlog_runs`, `devlog_private_aliases`: 작업 회고 글·참고 자료,
  커밋, 실행 이력, 비공개 프로젝트 별칭(0003~0006)
- `issues`, `entries`, `collection_runs`, `metadata`, `vendor_documents`, `archive_runs`(0001·0002):
  specsheet D1로 옮긴 뉴스·아카이브 테이블. 전환 후 정상 확인이 끝나면 migration으로 지웁니다.

상태 확인은 `GET /healthz`에서 제공하며 `latestDevlogRun`만 돌려줍니다.

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
curl "http://localhost:8787/__scheduled?cron=10+0+*+*+*"
```

Workers AI binding은 로컬 개발 중에도 원격 리소스와 사용량을 사용합니다.
