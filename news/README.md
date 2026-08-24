# news — IT 뉴스 다이제스트

IT 업계 뉴스와 엔지니어링 블로그에서 하루치 소식을 모아 한 편의 뉴스레터로 발행하는
Eleventy 사이트입니다.

사이트: <https://devlog-news.tkddls8848.workers.dev/>

개발 일지와 아카이브는 별도 사이트이며 이 폴더의 코드와 무관합니다. 내비게이션
링크로만 이어집니다. 그 둘은 GitHub Pages에 있고 이 사이트만 Cloudflare Workers에
있어 오리진이 다릅니다. 그래서 이웃 링크를 상대 경로가 아닌 절대 주소로 씁니다.

## 구성

```text
tools/feeds.mjs            피드 소스의 이름·분류·후보 주소 표
tools/news-digest.mjs      소식 수집 → 하루 한 편의 이슈 발행
tools/feed-check.mjs       피드 후보 주소가 살아 있는지 한 번에 점검
tools/rss.mjs              RSS 2.0·Atom 공용 파서와 주소 정규화
tools/lib.mjs              Cloudflare Workers AI 호출과 초안 파싱
tools/sources/hackernews.mjs  피드 대신 검색 API를 쓰는 유일한 소스
test/sources.test.mjs      fetch를 스텁해 파서와 수집기를 검증
test/news-digest.test.mjs  수집·중복 제거·발행을 하위 프로세스로 검증
src/issues/                발행된 뉴스레터
src/_data/site.js          사이트 제목과 이웃 사이트 링크
src/index.njk              이슈 목록
src/404.njk                없는 주소에 돌려주는 쪽
wrangler.jsonc             Cloudflare Workers 배포 설정
```

## 소스

소스 22곳을 봅니다. 목록과 피드 주소는 `tools/feeds.mjs` 한 곳에 있고, 소스를
늘리거나 주소를 고칠 때 손댈 곳도 여기뿐입니다.

| 소스 | 분류 | 받는 곳 |
| --- | --- | --- |
| Hacker News | 커뮤니티 | Algolia 검색 API |
| 지디넷코리아 | 국내 미디어 | RSS |
| 전자신문 | 국내 미디어 | RSS |
| 디지털데일리 | 국내 미디어 | RSS |
| 테크M | 국내 미디어 | RSS |
| 지티티코리아 | 국내 미디어 | RSS |
| Byline Network | 국내 미디어 | RSS |
| CIO Korea | 국내 미디어 | RSS |
| ITWorld Korea | 국내 미디어 | RSS |
| 보안뉴스 | 보안 | RSS |
| Palo Alto Networks 블로그 | 보안 | RSS |
| GeekNews | 커뮤니티 | RSS |
| 서버포럼 | 커뮤니티 | RSS |
| 요즘IT | 기술 블로그 | RSS |
| DEVOCEAN | 기술 블로그 | RSS |
| 토스 테크 | 기술 블로그 | RSS |
| Samsung Tech Blog | 기술 블로그 | RSS |
| Cloudflare 블로그 | 기술 블로그 | RSS |
| Unsloth AI | 기술 블로그 | Atom |
| The Register | 해외 미디어 | Atom |
| The Next Platform | 해외 미디어 | RSS |
| TechPowerUp | 해외 미디어 | RSS |

Unsloth AI는 블로그에 아직 피드가 없어 GitHub 릴리스 피드를 대신 받습니다. 블로그
피드가 생기면 첫 후보에서 저절로 잡힙니다.

표에 없는 소스가 셋 있습니다. 디지털타임스와 Making Software는 피드가 없는 게 아니라
봇 차단에 막혀 홈페이지까지 차단 페이지와 429를 돌려줍니다. 퀘이사존은 유일하게 열리는
rss.app 피드가 2022년 2월에 갱신을 멈췄고 나머지 주소는 403입니다. 셋 다 뒷날 열리면
후보 주소만 표에 적어 넣으면 됩니다.

Hacker News만 피드 대신 Algolia 검색 API를 씁니다. 프론트페이지 API는 지금 걸려
있는 글만 돌려주므로, 하루에 한 번 도는 수집기가 놓치지 않도록 시간 범위로 검색하고
점수(`HN_MIN_POINTS`, 기본 100)로 잡담을 걸러 냅니다. Ask HN처럼 외부 주소가 없는
글은 토론 페이지로 이어 줍니다.

나머지는 모두 같은 수집기가 처리합니다. RSS와 Atom은 항목 이름과 날짜 필드가 서로
다르지만 파서 하나가 둘 다 읽고, 제목이나 주소가 없거나 주소가 http가 아닌 항목만
버립니다. 항목 하나가 소스 전체를 무너뜨리지 않게 하기 위해서입니다.

항목에 날짜 태그를 하나도 달지 않는 피드가 있습니다. 요즘IT와 rss.app이 만든 피드가
그렇습니다. 날짜 없는 항목을 버리기만 하면 이런 소스는 통째로 0건이 되어 조용히
빠지므로, 채널이 스스로 밝힌 `lastBuildDate`를 대신 씁니다. 수집 시각으로 메우지
않는 이유는 갱신이 멈춘 피드 때문입니다. 옛 시각이 그대로 남아야 수집 창이 옛 글을
걸러 냅니다.

### 피드 주소를 후보로 두는 이유

피드 주소는 사이트마다 규칙이 다르고 개편 때 조용히 바뀝니다. 그래서 소스마다 후보를
순서대로 두드려 먼저 피드로 읽히는 주소를 씁니다. 개편된 사이트가 없는 피드 자리에
200과 함께 안내 HTML을 주는 경우가 있어, 응답이 피드 형식인지까지 보고 아니면 다음
후보로 넘어갑니다. 항목이 0건이어도 피드로 읽히기만 하면 그 주소를 씁니다. 조용한
날과 죽은 주소는 다르기 때문이며, 0건은 따로 경고로 남깁니다.

후보가 모두 막힌 소스는 어떤 주소를 왜 못 썼는지 로그에 남기고 그 소스만 실패
처리합니다. 다음 명령으로 표의 후보를 한 번에 확인할 수 있습니다.

```bash
npm run feeds:check
```

살아 있는 주소와 막힌 주소, 각 피드의 항목 수와 최신 글 시각을 표로 보여 주고, 후보를
하나도 못 찾은 소스가 있으면 종료 코드 1로 알립니다. 결과를 보고 `tools/feeds.mjs`의
후보만 고치면 됩니다.

## 수집 방식

발행 시각 기준 최근 24시간(`NEWS_WINDOW_HOURS`)에 올라온 글만 모읍니다. 미국 시간대
소스가 많아 KST 오늘치만 담으면 아침 발행에 남는 소식이 거의 없기 때문입니다.

같은 글이 소스마다 추적 파라미터를 달리 붙여 오므로, `utm_*`·`www.`·끝 슬래시를
지운 주소로 중복을 판정합니다. 이미 발행한 이슈의 앞머리에 있는 주소도 같은 방식으로
비교해 다시 싣지 않습니다.

출처 하나가 뉴스레터를 다 채우지 않도록 소스별로 3건(`NEWS_PER_SOURCE`)까지 자른 뒤,
전체를 최신순 30건(`NEWS_MAX_ITEMS`)으로 다시 자릅니다.

한 소스가 실패해도 나머지 소스의 결과로 발행하고 종료 코드 1로 알립니다. 모든 소스가
실패하면 아무것도 쓰지 않습니다.

## AI 요약

모아 둔 headline을 Cloudflare Workers AI에 넘겨 갈래별로 묶은 본문을 받습니다.
headline 밖의 사실은 넣지 말라고 지시하지만 모델이 지어낼 여지는 남아 있으므로,
발행된 글에는 `AI 생성` 표시가 붙고 원문 링크가 항상 함께 실립니다.

AI 호출이 실패하면 링크 목록만 담은 본문으로 발행하고 `aiGenerated: false`로
기록합니다. 요약이 없다고 그날 소식을 통째로 버리지는 않습니다.

## 배포

빌드 산출물 `_site`를 통째로 Cloudflare Workers의 정적 자산으로 올립니다. 서버
코드가 없어 `wrangler.jsonc`에 `main`(스크립트)이 없고, Worker 이름과 자산 폴더만
적혀 있습니다. 없는 주소는 `src/404.njk`가 만든 `404.html`로 돌려줍니다.

Worker가 도메인 뿌리를 통째로 맡으므로 `PATH_PREFIX=/`로 빌드합니다. GitHub Pages에
얹혀 있을 때 필요했던 `/devlog/news/` 앞가지가 이제 없습니다.

배포는 `.github/workflows/news-deploy.yml`이 합니다. `main`의 `news/`나 `shared/`가
바뀐 푸시, 수집 워크플로의 호출, 수동 실행에서 돕니다. `CF_ACCOUNT_ID`와
`CF_WORKERS_API_TOKEN`(없으면 `CF_API_TOKEN`)을 씁니다. 배포 토큰에는 Workers
Scripts 편집 권한이 필요하며, 수집이 쓰는 Workers AI 권한과는 다릅니다.

## 자동 갱신

매일 07:00 KST에 `.github/workflows/news-publish.yml`이 이 폴더만 수집하고,
새 소식이 있을 때만 `main`에 커밋한 뒤 배포를 부릅니다.

Actions 화면에서 직접 돌릴 때는 실행 방식을 고를 수 있습니다. `publish`는 예약 실행과
같고, `dry-run`은 실제 피드를 두드려 담길 소식만 보여 주며, `feeds-check`는 후보 주소가
살아 있는지만 확인합니다. 뒤의 둘은 아무것도 쓰지 않으므로 저장·배포 단계가 저절로
건너뛰어집니다.

## 로컬 실행

Node 20 이상이 필요합니다. CI는 `.nvmrc`의 24를 씁니다.

```bash
npm install
npm run dev
npm run build
npm test

CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run digest

# 저장하지 않고 오늘 담길 소식만 확인 (AI도 부르지 않는다)
npm run digest:dry

# 피드 후보 주소가 살아 있는지 확인
npm run feeds:check

# 뿌리 경로로 빌드해 Cloudflare Workers에 직접 올린다
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run deploy
```

`npm run deploy`는 wrangler를 `npx`로 그때그때 받아 씁니다. 이 폴더의 의존성에
넣지 않은 것은 매일 도는 수집 워크플로가 배포에 쓰지도 않을 큰 패키지를 함께
내려받게 되기 때문입니다.

환경 변수는 `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_AI_MODEL`, `NEWS_WINDOW_HOURS`,
`NEWS_PER_SOURCE`, `NEWS_MAX_ITEMS`, `HN_MIN_POINTS`를 받습니다. 이웃 사이트 주소는
`DEVLOG_URL`, `ARCHIVE_URL`로 덮어쓸 수 있으며 기본값은 `src/_data/site.js`에 있습니다.
