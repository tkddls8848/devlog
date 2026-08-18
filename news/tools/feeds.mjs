// 피드 주소는 사이트마다 규칙이 다르고 개편 때 조용히 바뀐다. 후보를 순서대로
// 두드려 먼저 피드로 읽히는 주소를 쓴다. 소스를 늘리거나 주소를 고칠 때 손댈
// 곳은 이 표뿐이고, `npm run feeds:check`로 후보가 살아 있는지 확인한다.
//
// 표에 없는 소스가 셋 있다. 디지털타임스와 Making Software는 피드가 없는 게
// 아니라 봇 차단에 막혀 홈페이지까지 차단 페이지와 429를 돌려준다. 퀘이사존은
// 유일하게 열리는 rss.app 피드가 2022년 2월에 갱신을 멈췄고 나머지 주소는 403
// 이다. 셋 다 뒷날 열리면 후보만 적어 넣으면 된다.
export const feeds = [
  {
    source: "지디넷코리아",
    kind: "국내 미디어",
    // 자체 주소(news_xml.asp)는 404다. 이 매체는 FeedBurner로만 피드를 낸다.
    urls: ["https://feeds.feedburner.com/zdkorea"],
  },
  {
    source: "전자신문",
    kind: "국내 미디어",
    urls: ["https://rss.etnews.com/Section901.xml", "https://rss.etnews.com/Section902.xml"],
  },
  {
    source: "디지털데일리",
    kind: "국내 미디어",
    urls: ["https://www.ddaily.co.kr/rss.xml"],
  },
  {
    source: "테크M",
    kind: "국내 미디어",
    urls: ["https://www.techm.kr/rss/allArticle.xml", "https://www.techm.kr/rss/S1N1.xml"],
  },
  {
    source: "지티티코리아",
    kind: "국내 미디어",
    urls: ["https://www.gttkorea.com/rss/allArticle.xml", "https://www.gttkorea.com/rss/S1N1.xml"],
  },
  {
    source: "Byline Network",
    kind: "국내 미디어",
    urls: ["https://byline.network/feed/"],
  },
  {
    source: "CIO Korea",
    kind: "국내 미디어",
    urls: ["https://www.ciokorea.com/feed"],
  },
  {
    source: "ITWorld Korea",
    kind: "국내 미디어",
    urls: ["https://www.itworld.co.kr/feed"],
  },
  {
    source: "보안뉴스",
    kind: "보안",
    urls: ["https://www.boannews.com/media/news_rss.xml"],
  },
  {
    source: "Palo Alto Networks 블로그",
    kind: "보안",
    urls: ["https://www.paloaltonetworks.com/blog/feed/"],
  },
  {
    source: "GeekNews",
    kind: "커뮤니티",
    urls: ["https://news.hada.io/rss/news", "https://news.hada.io/rss/topics"],
  },
  {
    source: "서버포럼",
    kind: "커뮤니티",
    urls: ["https://svrforum.com/rss"],
  },
  {
    source: "요즘IT",
    kind: "기술 블로그",
    // 항목에 날짜 태그가 없다. 파서가 채널의 lastBuildDate로 메운다.
    urls: ["https://yozm.wishket.com/magazine/feed/"],
  },
  {
    source: "DEVOCEAN",
    kind: "기술 블로그",
    urls: ["https://devocean.sk.com/blog/rss.do"],
  },
  {
    source: "토스 테크",
    kind: "기술 블로그",
    urls: ["https://toss.tech/rss.xml", "https://toss.tech/feed.xml"],
  },
  {
    source: "Samsung Tech Blog",
    kind: "기술 블로그",
    urls: ["https://techblog.samsung.com/rss"],
  },
  {
    source: "Cloudflare 블로그",
    kind: "기술 블로그",
    urls: ["https://blog.cloudflare.com/ko-kr/rss/", "https://blog.cloudflare.com/rss/"],
  },
  {
    source: "Unsloth AI",
    kind: "기술 블로그",
    // 블로그에는 아직 피드가 없다. 소식이 릴리스 노트로 먼저 나오므로 그것을
    // 대신 받는다. 블로그 피드가 생기면 첫 후보에서 저절로 잡힌다.
    urls: ["https://unsloth.ai/blog/rss.xml", "https://github.com/unslothai/unsloth/releases.atom"],
  },
  {
    source: "The Register",
    kind: "해외 미디어",
    urls: ["https://www.theregister.com/headlines.atom", "https://www.theregister.com/feed/"],
  },
  {
    source: "The Next Platform",
    kind: "해외 미디어",
    urls: ["https://www.nextplatform.com/feed/"],
  },
  {
    source: "TechPowerUp",
    kind: "해외 미디어",
    urls: ["https://www.techpowerup.com/rss/news"],
  },
];
