export default function (eleventyConfig) {
  eleventyConfig.addFilter(
    "findById",
    (items, id) => items.find(item => item.id === id)
  );

  eleventyConfig.addFilter("price", (value) => {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "";
    }

    return number.toFixed(2);
  });

  eleventyConfig.addPassthroughCopy({ "src/styles": "styles" });
  eleventyConfig.addPassthroughCopy({ "src/media": "media" });
  eleventyConfig.addPassthroughCopy({ "src/scripts": "scripts" });
  eleventyConfig.addPassthroughCopy({ "src/icons": "icons" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "src/site.webmanifest": "site.webmanifest" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/llms.txt": "llms.txt" });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["njk", "xml"],
    htmlTemplateEngine: "njk",
    passthroughFileCopy: true
  };
};
