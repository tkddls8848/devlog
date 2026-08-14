export default function (config) {
  config.addPassthroughCopy({ "src/assets": "assets" });
  config.addFilter("year", () => new Date().getFullYear());
  config.addFilter("vendorCount", (records, vendor) =>
    records.filter((record) => record.vendor === vendor).length
  );

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
