/**
 * src/updates/ 안 모든 글에 공통으로 적용되는 값.
 *
 * src/posts/posts.11tydata.js 와 같은 구조입니다. permalink 를 파일 이름에서
 * 직접 만드는 이유도 같습니다 — fileSlug 는 앞의 날짜를 떼어 내서, 매번
 * 같은 이름으로 만들어지는 …-updates.md 가 전부 한 주소로 겹칩니다.
 */
export default {
  layout: "layouts/update.njk",

  // 이 태그로 collections.updates 가 만들어집니다 (eleventy.config.js).
  tags: "updates",

  eleventyComputed: {
    permalink: (data) => {
      const name = data.page.inputPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
      return `/updates/${name}/`;
    },
  },
};
