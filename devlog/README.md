# devlog — 개발 일지

GitHub 공개 저장소에 올린 커밋을 매일 한 편의 일지로 기록하는 Eleventy 사이트입니다.

사이트: <https://tkddls8848.github.io/devlog/>

벤더 문서 아카이브는 별도 사이트이며 이 폴더의 코드와 무관합니다. 내비게이션
링크로만 이어집니다.

## 구성

```text
tools/push-digest.mjs   GitHub 커밋 → 개발 일지
tools/lib.mjs           Cloudflare Workers AI 호출과 초안 파싱
src/posts/              발행된 글
src/_data/site.js       사이트 제목과 아카이브 링크
.state/last-seen.json   마지막 GitHub 이벤트 조회 시점(진단용)
```

## 수집 방식

GitHub Events API의 최근 3페이지를 매번 다시 읽어 `main`·`master`·`dev` 커밋만
남기고, 커밋 작성일(KST)로 묶어 날짜마다 한 편씩 씁니다. 이벤트 ID는 시간순이
아니므로 중단 기준으로 쓰지 않습니다. 기존 글에 저장된 커밋 SHA로 중복을
제거하며, 병합 커밋, 리버트, 봇 커밋, `chore:`·`bump` 같은 메시지와 이 저장소
자신의 커밋은 제외합니다.

Cloudflare Workers AI가 쓴 초안을 사람 검토 없이 발행합니다. AI 호출이나 응답
파싱이 실패하면 수집한 커밋만 사용한 기본 본문을 대신 저장해 원본 기록을 놓치지
않습니다.

## 자동 발행

매일 09:10 KST에 `.github/workflows/devlog-publish.yml`이 이 폴더만 수집하고,
새 글이 있을 때만 `main`에 커밋한 뒤 배포를 부릅니다.

## 로컬 실행

Node 20 이상이 필요합니다. CI는 `.nvmrc`의 24를 씁니다.

```bash
npm install
npm run dev
npm run build
npm test

GH_TOKEN=... CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run digest

# 저장하지 않고 현재 복구 대상을 확인
npm run digest:dry
```

`.state/last-seen.json`은 마지막 조회 결과를 확인하는 진단 정보이며 중복 판별에는
사용하지 않습니다. 중복은 기존 글에 적힌 커밋 SHA로만 판별합니다.

`ARCHIVE_URL`로 아카이브 사이트 주소를 덮어쓸 수 있습니다. 기본값은
`src/_data/site.js`에 있습니다.
