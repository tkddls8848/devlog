import { feedSource } from "../rss.mjs";

export const source = "AWS 뉴스 블로그";
export const kind = "클라우드";
export const collect = feedSource({ source, kind, url: "https://aws.amazon.com/blogs/aws/feed/", limit: 8 });
