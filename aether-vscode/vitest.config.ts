import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    // Two environments: node for extension host, jsdom for webview UI
    environment: "node",
    environmentMatchGlobs: [
      ["src/__tests__/components/**", "jsdom"],
      ["src/__tests__/App.test.tsx", "jsdom"],
      ["src/__tests__/hooks/**", "jsdom"],
      ["src/__tests__/lib/message-bus.test.ts", "jsdom"],
      ["src/__tests__/stores/**", "jsdom"],
    ],
    setupFiles: ["src/__tests__/setup.ts"],
    server: {
      deps: {
        // Inline so Vite can apply react→preact/compat alias through the transform pipeline
        inline: ["zustand"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/__tests__/**",
        "src/webview-ui/index.css",
        "src/**/index.ts",
      ],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      // Stub vscode module for extension-host tests
      vscode: resolve(__dirname, "src/__tests__/__mocks__/vscode.ts"),
      // Preact aliases (match esbuild config)
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
