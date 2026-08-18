# news — IT 뉴스 다이제스트

IT 업계 뉴스와 엔지니어링 블로그에서 하루치 소식을 모아 한 편의 뉴스레터로 발행하는
Eleventy 사이트입니다.

사이트: <https://tkddls8848.github.io/devlog/news/>

개발 일지와 아카이브는 별도 사이트이며 이 폴더의 코드와 무관합니다. 내비게이션
링크로만 이어집니다.

## 구성

```text
tools/news-digest.mjs      소식 수집 → 하루 한 편의 이슈 발행
tools/rss.mjs              RSS 2.0·Atom 공용 파서와 주소 정규화
tools/lib.mjs              Cloudflare Workers AI 호출과 초안 파싱
tools/sources/             여섯 소스 수집기
test/sources.test.mjs      fetch를 스텁해 파서와 수집기를 검증
test/news-digest.test.mjs  수집·중복 제거·발행을 하위 프로세스로 검증
src/issues/                발행된 뉴스레터
src/_data/site.js          사이트 제목과 이웃 사이트 링크
src/index.njk              이슈 목록
```

## 소스

| 소스 | 분류 | 받는 곳 |
| --- | --- | --- |
| Hacker News | 커뮤니티 | Algolia 검색 API |
| AWS 뉴스 블로그 | 클라우드 | RSS |
| Google Cloud 블로그 | 클라우드 | RSS |
| GitHub 블로그 | 개발자 도구 | RSS |
| Ars Technica | 업계 뉴스 | RSS |
| The Verge | 업계 뉴스 | Atom |

RSS와 Atom은 항목 이름과 날짜 필드가 서로 다릅니다. 파서 하나가 둘 다 읽고,
제목·주소·날짜 중 하나라도 없거나 깨진 항목만 버립니다. 항목 하나가 소스 전체를
무너뜨리지 않게 하기 위해서입니다.

Hacker News의 프론트페이지 API는 지금 걸려 있는 글만 돌려주므로, 하루에 한 번
도는 수집기가 놓치지 않도록 시간 범위로 검색하고 점수(`HN_MIN_POINTS`, 기본 100)로
잡담을 걸러 냅니다. Ask HN처럼 외부 주소가 없는 글은 토론 페이지로 이어 줍니다.

## 수집 방식

발행 시각 기준 최근 24시간(`NEWS_WINDOW_HOURS`)에 올라온 글만 모읍니다. 미국 시간대
소스가 많아 KST 오늘치만 담으면 아침 발행에 남는 소식이 거의 없기 때문입니다.

같은 글이 소스마다 추적 파라미터를 달리 붙여 오므로, `utm_*`·`www.`·끝 슬래시를
지운 주소로 중복을 판정합니다. 이미 발행한 이슈의 앞머리에 있는 주소도 같은 방식으로
비교해 다시 싣지 않습니다.

출처 하나가 뉴스레터를 다 채우지 않도록 소스별로 6건(`NEWS_PER_SOURCE`)까지 자른 뒤,
전체를 최신순 24건(`NEWS_MAX_ITEMS`)으로 다시 자릅니다.

한 소스가 실패해도 나머지 소스의 결과로 발행하고 종료 코드 1로 알립니다. 모든 소스가
실패하면 아무것도 쓰지 않습니다.

## AI 요약

모아 둔 headline을 Cloudflare Workers AI에 넘겨 갈래별로 묶은 본문을 받습니다.
headline 밖의 사실은 넣지 말라고 지시하지만 모델이 지어낼 여지는 남아 있으므로,
발행된 글에는 `AI 생성` 표시가 붙고 원문 링크가 항상 함께 실립니다.

AI 호출이 실패하면 링크 목록만 담은 본문으로 발행하고 `aiGenerated: false`로
기록합니다. 요약이 없다고 그날 소식을 통째로 버리지는 않습니다.

## 자동 갱신

매일 09:40 KST에 `.github/workflows/news-publish.yml`이 이 폴더만 수집하고,
새 소식이 있을 때만 `main`에 커밋한 뒤 배포를 부릅니다.

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
```

환경 변수는 `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_AI_MODEL`, `NEWS_WINDOW_HOURS`,
`NEWS_PER_SOURCE`, `NEWS_MAX_ITEMS`, `HN_MIN_POINTS`를 받습니다. 이웃 사이트 주소는
`DEVLOG_URL`, `ARCHIVE_URL`로 덮어쓸 수 있으며 기본값은 `src/_data/site.js`에 있습니다.
