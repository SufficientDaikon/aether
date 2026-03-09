import { defineConfig } from "@vscode/test-cli";

export default defineConfig([
  {
    label: "integration",
    files: "dist/__integration__/suite/**/*.test.js",
    workspaceFolder: "src/__integration__/fixtures/test-workspace",
    mocha: {
      ui: "tdd",
      timeout: 30000,
    },
  },
]);
