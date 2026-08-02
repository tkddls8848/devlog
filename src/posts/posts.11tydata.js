/**
 * src/posts/ 안 모든 글에 공통으로 적용되는 값.
 * (JSON 이 아니라 JS 인 이유는 permalink 에 진짜 boolean false 를 넣어야
 *  하기 때문입니다. JSON 으로는 문자열 "false" 가 되어 Eleventy 가 "false"
 *  라는 이름의 파일을 만들려고 합니다.)
 */
export default {
  layout: "layouts/post.njk",

  // 이 태그로 collections.posts 가 만들어집니다 (eleventy.config.js).
  tags: "posts",

  eleventyComputed: {
    /*
     * draft: true 인 글은 아예 페이지를 만들지 않습니다.
     * 목록에서만 빼면 주소를 아는 사람에게는 열리므로, 검토를 마치지 않은
     * 글이 공개된 것과 같습니다.
     *
     * 주소는 파일 이름(inputPath)에서 직접 만듭니다.
     *
     * fileSlug 와 filePathStem 은 둘 다 파일명 앞의 날짜(2026-08-02-)를 떼어
     * 냅니다. 그러면 날짜만 다르고 이름이 같은 글 — 매번 만들어지는
     * …-devlog.md — 이 전부 /posts/devlog/ 하나로 겹쳐서, 새 글이 나올 때마다
     * 지난 글이 덮어써집니다. inputPath 만 날짜를 그대로 갖고 있습니다.
     */
    permalink: (data) => {
      if (data.draft) return false;
      const name = data.page.inputPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
      return `/posts/${name}/`;
    },
  },
};
