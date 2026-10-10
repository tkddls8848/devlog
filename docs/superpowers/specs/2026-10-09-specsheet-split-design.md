# 뉴스·아카이브를 specsheet 저장소로 분리 — 설계

작성일: 2026-10-09

## 배경과 목표

지금은 Cloudflare Worker `devlog` 하나가 세 사이트(뉴스 다이제스트 `/`, 벤더 문서 아카이브
`/archive/`, 작업 회고 `/devlog/`)를 제공하고, 운영 데이터는 모두 D1 `devlog-news` 한 곳에 있다.
R2는 쓰지 않는다.

뉴스와 아카이브(데이터시트 갱신 현황)를 새 저장소 <https://github.com/tkddls8848/specsheet>로
옮겨 별도 Worker로 운영하고, 데이터도 별도 D1로 옮긴다. devlog 저장소에는 작업 회고와 `video/`만 남는다.

성공 기준:

- 기존 뉴스 이슈·기사·실행 이력, 아카이브 문서·실행 이력이 하나도 빠지지 않고 새 D1에 있다.
- 새 주소에서 같은 화면과 RSS가 나오고, 옛 주소는 301로 새 주소에 닿는다.
- 전환 다음 날 07:00 뉴스, 09:25 아카이브, 09:30 HPE 수집이 specsheet에서 성공한다.
- devlog Worker는 작업 회고만 수행하고, 같은 Cron이 두 Worker에서 두 번 돌지 않는다.

## 결정 사항

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 스토리지 | 새 D1 `specsheet`로 분리 | 두 저장소가 각자 migration을 소유한다. 같은 D1을 공유하면 `d1_migrations`가 파일 이름으로 기록돼 두 저장소의 `0001_*`이 충돌하고, 백업·복원·한도도 묶인다. R2는 SQL 조회·`UNIQUE` 중복 제거가 필요한 이 데이터에 맞지 않는다. |
| 주소 | `specsheet.tkddls8848.workers.dev` + 옛 경로 301 | 두 Worker가 서로 의존하지 않는다. |
| 저장소 구조 | `news/`, `archive/`, `shared/`를 그대로 이식 | 변경을 최소화한다. 단, 상대 기능 코드는 양쪽에서 제거한다. |

## 1. 역할 분담

| | specsheet (신규) | devlog (기존) |
| --- | --- | --- |
| Worker | `specsheet` | `devlog` |
| D1 | `specsheet` (APAC) | `devlog-news` (최종적으로 `devlog_*`만) |
| 경로 | `/`, `/issues/*`, `/feed.xml`, `/archive/`, `/healthz`, 정적 자산 | `/devlog/*`, `/healthz`, 그 외 옛 경로는 301 |
| Cron | `0 22 * * *` 뉴스, `25 0 * * *` 아카이브 | `10 0 * * *` 작업 회고 |
| GitHub Actions | `hpe-archive.yml`, `test.yml`(archive, news) | `test.yml`(devlog, news, video) |
| 비밀값 | GitHub secret `CLOUDFLARE_WORKER_AI_API_TOKEN`(D1 편집), `CLOUDFLARE_ACCOUNT_ID` | Worker secret `GITHUB_TOKEN`, `DEVLOG_ADMIN_PASSWORD` |

## 2. specsheet 저장소

이식 대상: `news/`, `archive/`, `shared/`, 루트의 `.editorconfig`, `.gitattributes`, `.gitignore`,
`.env.example`, `.github/workflows/hpe-archive.yml`, `.github/workflows/test.yml`.
`git filter-repo`로 이 경로의 커밋 이력을 보존한다. 도구를 쓸 수 없으면 이력 없이 복사하고 첫 커밋에
원본 커밋 해시(`1131b1b` 이후 분리 시점)를 적는다.

이식 후 제거:

- `news/worker/devlog.mjs`, `devlog-writer.mjs`, `devlog-admin.mjs`, `devlog-auth.mjs`, `devlog-spellcheck.mjs`
- `news/tools/devlog-journal.mjs`, `backfill-private.mjs`, `rename-private-labels.mjs`
- `shared/devlog-privacy.mjs`, `devlog-writing.mjs`, `devlog.css`, `devlog.js`, `devlog-editor.js`
- `news/migrations/0003_*`~`0006_*`
- 위 파일을 쓰는 테스트

이식 후 수정:

- `news/worker/index.mjs`: `/devlog*` 경로, 편집기 처리, 작업 회고 Cron 분기 제거. `/healthz`는
  `latestRun`, `latestArchiveRun`만 돌려준다.
- `news/worker/repository.mjs`: `devlog_*` 조회·저장 메서드와 `shared/devlog-*` import 제거.
  `ensureLegacyArchive`는 유지한다(이관할 `metadata` 행 덕분에 다시 실행되지 않는다).
- `news/worker/render.mjs`: 작업 회고 렌더러(`renderDevlogHome`, `renderDevlogPost`)와
  `isDevlog` 분기 제거. 내비게이션의 "개발 일지"는 `DEVLOG_URL`(절대 주소), "아카이브"는 `/archive/`,
  "뉴스레터"는 `/`.
- `news/wrangler.jsonc`: `name: "specsheet"`, D1 `database_name: "specsheet"`와 새 `database_id`,
  Cron `["0 22 * * *", "25 0 * * *"]`, `DEVLOG_URL: "https://devlog.tkddls8848.workers.dev/devlog/"`,
  `ARCHIVE_URL: "https://specsheet.tkddls8848.workers.dev/archive/"`, `run_worker_first`에서 `/devlog*` 제거.
- `news/tools/push-vendor-docs.mjs`: `DATABASE_NAME`·`DATABASE_ID`를 `specsheet` D1로.
- `news/eleventy.config.js` / `shared/sync.mjs`: 제거한 devlog 자산을 복사하지 않도록 정리.
- `.github/workflows/test.yml`: 매트릭스 `[archive, news]`.
- README: 루트, `news/`, `archive/`를 specsheet 기준으로 다시 쓴다.

Workers Builds: Root directory `news`, Build `npm ci && npm run build`, Deploy `npx wrangler deploy`,
branch `main`, watch path `news/**`, `shared/**`, `archive/src/_data/**`(빌드가 `vendorArchive.json`을 읽는다).

## 3. devlog 저장소 정리

제거:

- `archive/` 폴더 전체
- `shared/vendor-collection.mjs`, `vendor-hpe.mjs`, `vendor-netapp.mjs`, `vendor-oracle.mjs`
- `news/worker/digest.mjs`, `archive.mjs`, `archive-dell.mjs`, `news/worker/generated/`
- `news/tools/feeds.mjs`, `rss.mjs`, `sources/`, `feed-check.mjs`, `push-vendor-docs.mjs`, `export-legacy-archive.mjs`
- `.github/workflows/hpe-archive.yml`
- 위 파일을 쓰는 테스트

수정:

- `news/worker/index.mjs`
  - `/` → `301 /devlog/`
  - `/issues/*`, `/feed.xml`, `/archive`, `/archive/*` → `301 https://specsheet.tkddls8848.workers.dev<같은 경로><같은 쿼리>`
  - `ensureLegacyArchive` 호출 제거, `/healthz`는 `latestDevlogRun`만
  - `scheduled`는 작업 회고만 실행
- `news/worker/repository.mjs`: 뉴스·아카이브 메서드, `ensureLegacyArchive`, `legacy-archive`·`rss.mjs` import 제거.
- `news/worker/render.mjs`: 뉴스·아카이브 렌더러 제거. 내비게이션의 "뉴스레터"는 `NEWS_URL`,
  "아카이브"는 `ARCHIVE_URL`(둘 다 specsheet 절대 주소).
- `news/wrangler.jsonc`: Cron `["10 0 * * *"]`, `vars`에서 뉴스 설정(`CF_AI_MODEL`, `NEWS_*`, `HN_MIN_POINTS`)
  제거, `NEWS_URL`·`ARCHIVE_URL` 추가, `run_worker_first`를 `["/", "/issues/*", "/archive*", "/devlog*", "/feed.xml", "/healthz"]`
  그대로 둔다(301을 Worker가 처리해야 한다).
- `news/package.json`: `build`에서 `export-legacy-archive` 제거, `feeds:check` 제거.
- `.github/workflows/test.yml`: 매트릭스 `[devlog, news, video]`.
- README: 루트와 `news/`를 작업 회고 전용으로 고치고 specsheet 링크를 단다.

폴더 이름 `news/`는 Workers Builds Root directory와 묶여 있어 이번에는 바꾸지 않는다.

## 4. 데이터 이관과 전환

전환 시간대: KST 10:00~다음 날 06:30. 이 사이에는 어떤 Cron이나 HPE 워크플로도 돌지 않아
`devlog-news`의 뉴스·아카이브 테이블이 바뀌지 않는다.

1. `wrangler d1 create specsheet --location apac`, specsheet `wrangler.jsonc`에 id 반영.
2. `wrangler d1 migrations apply DB --remote`로 0001, 0002 적용.
3. specsheet Worker를 **Cron 없이**(`"crons": []`) 배포하고 Workers Builds를 연결한다.
4. `devlog-news`에서 테이블별로 export:
   `wrangler d1 export devlog-news --remote --no-schema --table <name> --output <name>.sql`
   대상: `issues`, `entries`, `collection_runs`, `vendor_documents`, `archive_runs`, `metadata`.
5. 같은 순서(외래 키: `entries`·`collection_runs` → `issues`)로
   `wrangler d1 execute specsheet --remote --file <name>.sql` 실행.
6. 검증:
   - 테이블별 `count(*)`가 원본과 같다.
   - `max(issues.published_at)`, `max(collection_runs.started_at)`, `max(archive_runs.started_at)`,
     `max(vendor_documents.document_date)`가 원본과 같다.
   - specsheet 주소에서 `/`, 최신 `/issues/<slug>/`, `/archive/`, `/feed.xml`, `/healthz`가 200이고 내용이 옛 주소와 같다.
7. 동시에 푸시:
   - specsheet: Cron 활성화, `hpe-archive.yml` 활성화(GitHub secret 등록 후).
   - devlog: 3절 변경(Cron 제거, 301, `hpe-archive.yml` 삭제).
8. 다음 날 07:00, 09:25, 09:30 실행 결과를 specsheet `/healthz`와 Actions 로그로 확인한다.

되돌리기: 옛 테이블은 `devlog-news`에 1주일 남겨 둔다. 문제가 생기면 devlog 커밋을 되돌리고
specsheet Cron을 끈다. specsheet에서 새로 쌓인 행이 있으면 같은 export/import로 되돌려 넣는다.

정리(전환 1주 후, 정상 확인 뒤): devlog 저장소에 `news/migrations/0007_drop_news_archive.sql`을 추가해
`entries`, `collection_runs`, `issues`, `archive_runs`, `vendor_documents`, `metadata`를 DROP하고,
D1 권한이 있는 환경에서 `npm run db:migrate:remote`로 적용한다. devlog 저장소의 GitHub secret
`CLOUDFLARE_WORKER_AI_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`도 삭제한다.

## 5. 테스트

- 두 저장소 모두 `npm test`가 각 매트릭스 폴더에서 통과한다.
- devlog: `index.mjs`의 301 대상(경로·쿼리 보존, `/` → `/devlog/`)을 단위 테스트로 검증한다.
- specsheet: 로컬 D1에 export 덤프를 넣고 `wrangler dev`로 화면과 `/feed.xml`을 확인한다.
- 전환 후 `curl -I`로 옛 주소 다섯 가지(`/`, `/issues/<slug>/`, `/feed.xml`, `/archive/`, `/archive?q=x`)의 301과 Location을 확인한다.

## 사용자가 직접 해야 하는 일

- `npx wrangler login` (로컬 로그인이 만료됨)
- specsheet 저장소의 GitHub secret `CLOUDFLARE_WORKER_AI_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 등록
- Cloudflare 대시보드에서 `specsheet` Worker의 Workers Builds 저장소 연결

## 범위 밖

- devlog 저장소 `news/` 폴더 이름 변경
- R2 도입(PDF 원본 보관, D1 백업)
- 커스텀 도메인
