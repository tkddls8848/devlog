import { feedSource } from "../rss.mjs";

export const source = "The Verge";
export const kind = "업계 뉴스";
export const collect = feedSource({ source, kind, url: "https://www.theverge.com/rss/index.xml", limit: 10 });
