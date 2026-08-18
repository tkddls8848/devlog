const day = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

const clock = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

export default function (config) {
  config.addPassthroughCopy({ "src/assets": "assets" });
  config.addFilter("year", () => new Date().getFullYear());
  config.addFilter("issueDate", (value) => day.format(new Date(value)));
  config.addFilter("isoDate", (value) => new Date(value).toISOString());
  // 소식이 올라온 시각은 발행 시각과 다르다. 독자 기준인 KST로 보여 준다.
  config.addFilter("clockTime", (value) => clock.format(new Date(value)));
  config.addFilter("entryCount", (sources) =>
    (sources || []).reduce((sum, source) => sum + (source.entries?.length || 0), 0)
  );
  config.addCollection("issues", (api) =>
    api.getFilteredByTag("issues").sort((a, b) => b.date - a.date)
  );

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
