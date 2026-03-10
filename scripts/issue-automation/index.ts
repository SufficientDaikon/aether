/**
 * Main entry point for AETHER issue automation system
 * Exports all public APIs for use as a library
 *
 * Usage (CLI):
 *   bun run scripts/issue-automation/index.ts --help
 *
 * Can also be built:
 *   bun build scripts/issue-automation/index.ts --outdir scripts/issue-automation/dist
 */

export * from "./types.ts";
export * from "./taxonomy.ts";
export * from "./llm-client.ts";
export * from "./sanitizer.ts";
export * from "./utils.ts";
export { classifyIssue } from "./classifier.ts";
export { generateComment } from "./comment-generator.ts";
export { detectDuplicate, markDuplicate } from "./duplicate-detector.ts";
export { compareBatch } from "./batch-comparator.ts";
export { analyzeComment, processComment, bulkScanIssues } from "./spam-detector.ts";
export { processStaleIssues } from "./lifecycle-manager.ts";
export { checkForDispute, resolveDispute, scanForDisputes } from "./dispute-handler.ts";
export { runGraceCloser } from "./grace-closer.ts";
export { bootstrapLabels } from "./bootstrap-labels.ts";

// ─── CLI dispatch ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  const [command] = process.argv.slice(2);

  const COMMANDS: Record<string, string> = {
    classify: "classifier.ts",
    comment: "comment-generator.ts",
    detect: "duplicate-detector.ts",
    spam: "spam-detector.ts",
    stale: "lifecycle-manager.ts",
    dispute: "dispute-handler.ts",
    close: "grace-closer.ts",
    bootstrap: "bootstrap-labels.ts",
  };

  if (!command || command === "--help" || command === "-h") {
    console.log(`
AETHER Issue Automation System

Usage: bun run scripts/issue-automation/index.ts <command>

Commands:
  classify    Classify a new issue with labels
  comment     Generate acknowledgment comment
  detect      Detect duplicate issues
  spam        Detect spam in comments
  stale       Process stale issues
  dispute     Handle duplicate disputes
  close       Close issues past grace period
  bootstrap   Create/update GitHub labels

Each command reads config from environment variables.
Run each script directly for usage details.
`);
    process.exit(0);
  }

  const script = COMMANDS[command];
  if (!script) {
    console.error(`Unknown command: ${command}`);
    console.error(`Valid commands: ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(1);
  }

  const { spawnSync } = require("child_process");
  const result = spawnSync(
    "bun",
    ["run", `scripts/issue-automation/${script}`, ...process.argv.slice(3)],
    {
      stdio: "inherit",
      env: process.env,
    }
  );
  process.exit(result.status ?? 0);
}
