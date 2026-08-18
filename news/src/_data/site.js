export default {
  title: "devlog news",
  tagline: "IT 업계 뉴스와 엔지니어링 블로그를 하루 한 편으로 묶는 뉴스레터",
  githubUser: "tkddls8848",
  // 개발 일지와 아카이브는 별도 사이트다. 도메인이 바뀌면 환경 변수로 덮어쓴다.
  devlogUrl: process.env.DEVLOG_URL || "https://tkddls8848.github.io/devlog/",
  archiveUrl: process.env.ARCHIVE_URL || "https://tkddls8848.github.io/devlog/archive/",
};
