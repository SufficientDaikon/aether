import {
  TestHarness,
  writeReport,
  type PhaseReport,
} from "../helpers/test-harness.ts";

const TESTS = [
  { id: "01", mod: () => import("./01-runtime-lifecycle.test.ts") },
  { id: "02", mod: () => import("./02-task-pipeline.test.ts") },
  { id: "03", mod: () => import("./03-escalation-chain.test.ts") },
  { id: "04", mod: () => import("./04-mcp-runtime-bridge.test.ts") },
  { id: "05", mod: () => import("./05-websocket-roundtrip.test.ts") },
];

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 11: Integration Testing");
  harness.start();
  for (const test of TESTS) {
    try {
      const mod = await test.mod();
      await mod.run(harness);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await harness.runTest(`11.${test.id}.0`, `${test.id} load`, async () => ({
        score: 0,
        maxScore: 10,
        details: `Module failed: ${msg}`,
      }));
    }
  }
  const report = harness.getReport();
  await writeReport(import.meta.dir, harness.generateMarkdown(report), report);
  return report;
}
