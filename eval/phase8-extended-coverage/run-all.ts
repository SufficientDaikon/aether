// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 8: Extended Coverage Runner
// ─────────────────────────────────────────────────────────────

import {
  TestHarness,
  writeReport,
  type PhaseReport,
} from "../helpers/test-harness.ts";

const TESTS = [
  { id: "01", mod: () => import("./01-mcp-stdio.test.ts") },
  { id: "02", mod: () => import("./02-cli-commands.test.ts") },
  { id: "03", mod: () => import("./03-schema-validator.test.ts") },
  { id: "04", mod: () => import("./04-constitutional-rules.test.ts") },
  { id: "05", mod: () => import("./05-structured-logger.test.ts") },
  { id: "06", mod: () => import("./06-config-manager.test.ts") },
  { id: "07", mod: () => import("./07-group-chat.test.ts") },
  { id: "08", mod: () => import("./08-agent-definitions.test.ts") },
];

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 8: Extended Coverage");
  harness.start();

  for (const test of TESTS) {
    try {
      const mod = await test.mod();
      await mod.run(harness);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await harness.runTest(
        `8.${test.id}.0`,
        `${test.id} module load`,
        async () => ({
          score: 0,
          maxScore: 10,
          details: `Module failed to load: ${msg}`,
        }),
      );
    }
  }

  const report = harness.getReport();
  await writeReport(import.meta.dir, harness.generateMarkdown(report), report);
  return report;
}
