import { feedSource } from "../rss.mjs";

export const source = "GitHub 블로그";
export const kind = "개발자 도구";
export const collect = feedSource({ source, kind, url: "https://github.blog/feed/", limit: 6 });
