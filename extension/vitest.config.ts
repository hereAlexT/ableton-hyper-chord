import { defineConfig, type Plugin } from "vitest/config";

/** Mirror build.ts's esbuild `.html` text loader so modules that inline HTML load under vitest. */
const htmlAsText: Plugin = {
  name: "html-as-text",
  transform(code, id) {
    if (!id.endsWith(".html")) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

export default defineConfig({
  plugins: [htmlAsText],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
