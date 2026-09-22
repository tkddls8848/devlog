export default {
  title: "devlog",
  tagline: "코드의 변화에서 설계의 이유를 찾는 개발 기록",
  githubUser: "tkddls8848",
  // 아카이브와 뉴스레터는 별도 사이트다. 도메인이 바뀌면 환경 변수로 덮어쓴다.
  // 뉴스레터만 GitHub Pages가 아니라 Cloudflare Workers에서 돈다.
  archiveUrl: process.env.ARCHIVE_URL || "https://tkddls8848.github.io/devlog/archive/",
  newsUrl: process.env.NEWS_URL || "https://devlog.tkddls8848.workers.dev/",
};
