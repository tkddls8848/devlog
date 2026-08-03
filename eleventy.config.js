/**
 * Eleventy 설정
 *
 * 글은 tools/push-digest.mjs 가 자동으로 만들어 src/posts/ 에 넣습니다.
 * 사람이 직접 쓴 글도 같은 디렉터리에 두면 똑같이 동작합니다.
 */
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addWatchTarget("src/assets/");

  // ── 필터 ───────────────────────────────────────────────────────────────
  eleventyConfig.addFilter("year", () => String(new Date().getFullYear()));

  /** 발행일 표기 (예: 2026년 8월 2일) */
  eleventyConfig.addFilter("postDate", (d) =>
    new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Seoul",
    }).format(new Date(d || Date.now()))
  );

  /** ISO 날짜 (<time datetime>) */
  eleventyConfig.addFilter("isoDate", (d) => new Date(d || Date.now()).toISOString());

  /** 커밋 해시 표기용 앞 7자 */
  eleventyConfig.addFilter("shortSha", (sha) => String(sha || "").slice(0, 7));

  /** 아카이브에서 특정 벤더의 문서 수 */
  eleventyConfig.addFilter("vendorCount", (records, vendor) =>
    (records || []).filter((r) => r.vendor === vendor).length
  );

  /**
   * 아카이브 표에 실을 행 수 상한.
   *
   * 아카이브는 계속 쌓이기만 합니다. 전부 렌더하면 언젠가 한 페이지가
   * 수 MB 가 되어 열리지 않습니다. 원본은 vendorArchive.json 에 그대로
   * 남으므로 화면에서만 잘라 냅니다.
   */
  eleventyConfig.addFilter("limitArchive", (records) => (records || []).slice(0, 1500));

  // ── 컬렉션 ─────────────────────────────────────────────────────────────
  /** 발행된 글. 최신순. */
  eleventyConfig.addCollection("posts", (collection) =>
    collection
      .getFilteredByTag("posts")
      .sort((a, b) => b.date - a.date)
  );

  /** 벤더 문서 갱신 일지. 최신순. */
  eleventyConfig.addCollection("updates", (collection) =>
    collection
      .getFilteredByTag("updates")
      .sort((a, b) => b.date - a.date)
  );

  return {
    /**
     * GitHub Pages 프로젝트 사이트는 주소에 저장소 이름이 붙습니다
     * (https://tkddls8848.github.io/devlog/). 템플릿의 `| url` 필터가
     * 이 접두사를 붙여 주므로 배포 워크플로에서 이 값만 넘기면 됩니다.
     * 로컬 개발에서는 기본값 "/" 라 그냥 열립니다.
     */
    pathPrefix: process.env.PATH_PREFIX || "/",

    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
