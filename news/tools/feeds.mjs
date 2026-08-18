// 피드 주소는 소스마다 규칙이 제각각이고 개편 때 조용히 바뀐다. 후보를 순서대로
// 두드려 먼저 응답하는 주소를 쓴다. 첫 후보가 가장 그럴듯한 주소이며, 뒤는
// 국내 언론사 CMS와 WordPress·Ghost가 흔히 쓰는 경로다.
// 후보가 모두 막히면 `npm run feeds:check`로 확인하고 여기만 고치면 된다.
export const feeds = [
  {
    source: "지디넷코리아",
    kind: "국내 미디어",
    urls: ["https://zdnet.co.kr/news/news_xml.asp", "https://zdnet.co.kr/rss/"],
  },
  {
    source: "전자신문",
    kind: "국내 미디어",
    urls: ["https://rss.etnews.com/Section901.xml", "https://rss.etnews.com/Section902.xml"],
  },
  {
    source: "디지털데일리",
    kind: "국내 미디어",
    urls: ["https://www.ddaily.co.kr/rss/allArticle.xml", "https://www.ddaily.co.kr/rss/S1N1.xml"],
  },
  {
    source: "디지털타임스",
    kind: "국내 미디어",
    urls: ["https://www.dt.co.kr/rss/rssAll.xml", "https://www.dt.co.kr/rss/section.xml"],
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
    urls: ["https://www.ciokorea.com/rss/feed", "https://www.ciokorea.com/feed"],
  },
  {
    source: "ITWorld Korea",
    kind: "국내 미디어",
    urls: ["https://www.itworld.co.kr/rss/feed", "https://www.itworld.co.kr/feed"],
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
    source: "퀘이사존",
    kind: "커뮤니티",
    urls: ["https://quasarzone.com/rss", "https://quasarzone.com/rss.xml"],
  },
  {
    source: "서버포럼",
    kind: "커뮤니티",
    urls: ["https://svrforum.com/rss", "https://svrforum.com/index.php?act=rss"],
  },
  {
    source: "요즘IT",
    kind: "기술 블로그",
    urls: ["https://yozm.wishket.com/magazine/feed/", "https://yozm.wishket.com/magazine/rss/"],
  },
  {
    source: "DEVOCEAN",
    kind: "기술 블로그",
    urls: ["https://devocean.sk.com/rss.xml", "https://devocean.sk.com/blog/rss.xml"],
  },
  {
    source: "토스 테크",
    kind: "기술 블로그",
    urls: ["https://toss.tech/rss.xml", "https://toss.tech/feed.xml"],
  },
  {
    source: "Samsung Tech Blog",
    kind: "기술 블로그",
    urls: ["https://techblog.samsung.com/rss.xml", "https://techblog.samsung.com/feed.xml"],
  },
  {
    source: "Cloudflare 블로그",
    kind: "기술 블로그",
    urls: ["https://blog.cloudflare.com/ko-kr/rss/", "https://blog.cloudflare.com/rss/"],
  },
  {
    source: "Unsloth AI",
    kind: "기술 블로그",
    urls: ["https://unsloth.ai/blog/rss.xml", "https://unsloth.ai/rss.xml"],
  },
  {
    source: "Making Software",
    kind: "기술 블로그",
    urls: ["https://www.makingsoftware.com/rss.xml", "https://www.makingsoftware.com/feed.xml"],
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
    urls: ["https://www.techpowerup.com/rss/news", "https://www.techpowerup.com/rss/"],
  },
];
