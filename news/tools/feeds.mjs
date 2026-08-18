// 피드 주소는 사이트마다 규칙이 다르고 개편 때 조용히 바뀐다. 후보를 순서대로
// 두드려 먼저 피드로 읽히는 주소를 쓴다. 소스를 늘리거나 주소를 고칠 때 손댈
// 곳은 이 표뿐이고, `npm run feeds:check`로 후보가 살아 있는지 확인한다.
export const feeds = [
  {
    source: "AWS 뉴스 블로그",
    kind: "클라우드",
    urls: ["https://aws.amazon.com/blogs/aws/feed/"],
  },
  {
    source: "Google Cloud 블로그",
    kind: "클라우드",
    urls: ["https://cloudblog.withgoogle.com/rss/"],
  },
  {
    source: "GitHub 블로그",
    kind: "개발자 도구",
    urls: ["https://github.blog/feed/"],
  },
  {
    source: "Ars Technica",
    kind: "업계 뉴스",
    urls: ["https://feeds.arstechnica.com/arstechnica/index"],
  },
  {
    source: "The Verge",
    kind: "업계 뉴스",
    urls: ["https://www.theverge.com/rss/index.xml"],
  },
];
