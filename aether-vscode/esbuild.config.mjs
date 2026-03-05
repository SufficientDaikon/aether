// esbuild config for AETHER VS Code extension
// Bundles extension host code + webview React app separately

import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

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
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".css": "css",
  },
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
