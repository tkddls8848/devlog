import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { syncSharedTheme, sharedDir } from "../shared/sync.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const date = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

export default function (config) {
  // devlog/archive/news 세 사이트가 공유하는 테마 CSS·토글 스크립트·마크업의
  // 단일 원본은 ../shared에 있다. 빌드마다 이 프로젝트 소스로 복사해 각 사이트를
  // 독립적으로 빌드 가능하게 유지하면서도 사본이 따로 갈라지지 않게 한다.
  syncSharedTheme(__dirname);
  config.addWatchTarget(sharedDir);
  config.on("eleventy.before", () => syncSharedTheme(__dirname));

  config.addPassthroughCopy({ "src/assets": "assets" });
  config.addFilter("year", () => new Date().getFullYear());
  config.addFilter("postDate", (value) => date.format(new Date(value)));
  config.addFilter("isoDate", (value) => new Date(value).toISOString());
  config.addFilter("shortSha", (value) => String(value).slice(0, 7));
  config.addCollection("posts", (api) =>
    api.getFilteredByTag("posts").sort((a, b) => b.date - a.date)
  );

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
