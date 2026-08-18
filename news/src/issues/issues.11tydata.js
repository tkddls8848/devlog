export default {
  layout: "layouts/issue.njk",
  tags: "issues",
  aiGenerated: true,
  eleventyComputed: {
    permalink: ({ page }) => `/issues/${page.inputPath.split(/[\\/]/).pop().split(".")[0]}/`,
  },
};
