export default {
  layout: "layouts/post.njk",
  tags: "updates",
  aiGenerated: true,
  eleventyComputed: {
    permalink: ({ page }) => `/updates/${page.inputPath.split(/[\\/]/).pop().split(".")[0]}/`,
  },
};
