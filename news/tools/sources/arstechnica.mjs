import { feedSource } from "../rss.mjs";

export const source = "Ars Technica";
export const kind = "업계 뉴스";
export const collect = feedSource({ source, kind, url: "https://feeds.arstechnica.com/arstechnica/index", limit: 10 });
