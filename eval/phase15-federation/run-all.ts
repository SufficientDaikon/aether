// Phase 15: Federation & Distributed — Runner
import {
  TestHarness,
  writeReport,
  type PhaseReport,
} from "../helpers/test-harness.ts";

const TESTS = [
  { id: "01", mod: () => import("./01-federation-transport.test.ts") },
  { id: "02", mod: () => import("./02-dual-instance.test.ts") },
  { id: "03", mod: () => import("./03-federation-security.test.ts") },
];

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 15: Federation & Distributed");
  harness.start();
  for (const test of TESTS) {
    try {
      const mod = await test.mod();
      await mod.run(harness);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await harness.runTest(`15.${test.id}.0`, `${test.id} load`, async () => ({
        score: 0, maxScore: 10, details: `Module failed: ${msg}`,
      }));
    }
  }
  const report = harness.getReport();
  await writeReport(import.meta.dir, harness.generateMarkdown(report), report);
  return report;
}
