# devlog — 개발 일지

GitHub 공개 저장소의 커밋을 날짜별 개발 일지로 정리합니다.

운영 사이트: <https://devlog.tkddls8848.workers.dev/devlog/>

수집·Workers AI 생성·D1 저장·서비스는 Cloudflare Worker `devlog`에서 실행됩니다.
Cron Trigger `10 0 * * *`가 매일 09:10 KST에 실행하며, 발행 결과를 로컬 Markdown이나
GitHub 커밋으로 저장하지 않습니다. 기존 61편과 커밋 정보는 D1으로 이관했습니다.

`devlog/` 폴더에는 이전 GitHub Pages 구현과 수집기 테스트가 남아 있지만 운영 데이터의
원본은 아닙니다. 운영 코드는 `news/worker/devlog.mjs`, 화면 라우팅은
`news/worker/index.mjs`, D1 스키마는 `news/migrations/0003_devlog.sql`에 있습니다.
