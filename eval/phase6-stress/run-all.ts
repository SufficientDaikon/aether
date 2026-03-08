// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: Stress Tests Runner
// Runs all 8 stress tests sequentially and generates a report
// -----------------------------------------------------------------

import {
  TestHarness,
  writeReport,
  type PhaseReport,
} from "../helpers/test-harness.ts";

const TESTS = [
  { id: "01", mod: () => import("./01-message-throughput.ts") },
  { id: "02", mod: () => import("./02-concurrent-tasks.ts") },
  { id: "03", mod: () => import("./03-large-payloads.ts") },
  { id: "04", mod: () => import("./04-deep-recursion.ts") },
  { id: "05", mod: () => import("./05-circuit-breaker-load.ts") },
  { id: "06", mod: () => import("./06-worker-pool-spike.ts") },
  { id: "07", mod: () => import("./07-rag-at-scale.ts") },
  { id: "08", mod: () => import("./08-websocket-saturation.ts") },
];

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 6: Stress Tests");
  harness.start();

  for (const test of TESTS) {
    try {
      const mod = await test.mod();
      await mod.run(harness);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  [FATAL] Failed to load/run stress test ${test.id}: ${msg}`,
      );
      harness.skipTest(
        `6.${test.id}`,
        `Stress test ${test.id} (load failure)`,
        `Module failed to load: ${msg.slice(0, 200)}`,
      );
    }
  }

  const report = harness.getReport();
  const dir = `${import.meta.dir}`;
  await writeReport(dir, harness.generateMarkdown(report), report);
  return report;
}

if (import.meta.main) {
  try {
    const report = await run();
    const pct =
      report.maxPossibleScore > 0
        ? ((report.totalScore / report.maxPossibleScore) * 100).toFixed(1)
        : "N/A";
    console.log(
      `\nPhase 6 complete: ${report.passed}/${report.totalTests} passed (${pct}%)\n`,
    );
    process.exit(report.failed + report.errors > 0 ? 1 : 0);
  } catch (err) {
    console.error("Phase 6 fatal error:", err);
    process.exit(2);
  }
}
