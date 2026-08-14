export default {
  layout: "layouts/post.njk",
  tags: "posts",
  aiGenerated: true,
  eleventyComputed: {
    permalink: ({ page }) => `/posts/${page.inputPath.split(/[\\/]/).pop().split(".")[0]}/`,
  },
};
