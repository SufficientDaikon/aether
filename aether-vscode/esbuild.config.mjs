// esbuild config for AETHER VS Code extension
// Bundles extension host code + webview Preact app separately

import * as esbuild from "esbuild";
import { readFile } from "node:fs/promises";

const isWatch = process.argv.includes("--watch");

// PostCSS/Tailwind plugin for processing CSS
const postcssPlugin = {
  name: "postcss",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const postcss = (await import("postcss")).default;
      const tailwind = (await import("tailwindcss")).default;
      const autoprefixer = (await import("autoprefixer")).default;

      const source = await readFile(args.path, "utf8");
      const result = await postcss([tailwind, autoprefixer]).process(source, {
        from: args.path,
      });

      return { contents: result.css, loader: "css" };
    });
  },
};

// Extension host bundle (runs in VS Code's Node.js process)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: !isWatch,
};

// Webview bundle (runs in webview iframe)
const webviewConfig = {
  entryPoints: ["src/webview-ui/App.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify: !isWatch,
  define: {
    "process.env.NODE_ENV": isWatch ? '"development"' : '"production"',
  },
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
  },
  jsx: "automatic",
  jsxImportSource: "preact",
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".css": "css",
  },
  plugins: [postcssPlugin],
};

async function build() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
