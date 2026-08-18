import { feedSource } from "../rss.mjs";

export const source = "Google Cloud 블로그";
export const kind = "클라우드";
export const collect = feedSource({ source, kind, url: "https://cloudblog.withgoogle.com/rss/", limit: 8 });
