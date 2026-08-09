const date = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

export default function (config) {
  config.addPassthroughCopy({ "src/assets": "assets" });
  config.addFilter("year", () => new Date().getFullYear());
  config.addFilter("postDate", (value) => date.format(new Date(value)));
  config.addFilter("isoDate", (value) => new Date(value).toISOString());
  config.addFilter("shortSha", (value) => String(value).slice(0, 7));
  config.addFilter("vendorCount", (records, vendor) =>
    records.filter((record) => record.vendor === vendor).length
  );
  config.addCollection("posts", (api) =>
    api.getFilteredByTag("posts").sort((a, b) => b.date - a.date)
  );
  config.addCollection("updates", (api) =>
    api.getFilteredByTag("updates").sort((a, b) => b.date - a.date)
  );

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
