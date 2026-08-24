export default {
  title: "devlog archive",
  tagline: "IBM · Lenovo · HPE · Dell 제품 문서 갱신을 쌓아 두는 곳",
  githubUser: "tkddls8848",
  // 개발 일지와 뉴스레터는 별도 사이트다. 도메인이 바뀌면 환경 변수로 덮어쓴다.
  // 뉴스레터만 GitHub Pages가 아니라 Cloudflare Workers에서 돈다.
  devlogUrl: process.env.DEVLOG_URL || "https://tkddls8848.github.io/devlog/",
  newsUrl: process.env.NEWS_URL || "https://devlog.tkddls8848.workers.dev/",
};
