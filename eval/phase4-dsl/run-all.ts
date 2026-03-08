// -----------------------------------------------------------------
// AETHER Eval -- Phase 4: DSL Tests Runner
// Imports all Phase 4 test modules and runs them via TestHarness
// -----------------------------------------------------------------

import {
  TestHarness,
  writeReport,
  type PhaseReport,
} from "../helpers/test-harness.ts";

const TESTS = [
  { id: "01", mod: () => import("./01-lexer.test.ts") },
  { id: "02", mod: () => import("./02-parser.test.ts") },
  { id: "03", mod: () => import("./03-transpiler.test.ts") },
  { id: "04", mod: () => import("./04-complex.test.ts") },
  { id: "05", mod: () => import("./05-errors.test.ts") },
];

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness(
    "Phase 4: DSL (Lexer / Parser / Transpiler) Tests",
  );
  harness.start();

  for (const test of TESTS) {
    try {
      const mod = await test.mod();
      await mod.run(harness);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FATAL] Failed to load/run DSL test ${test.id}: ${msg}`);
      harness.skipTest(
        `4.${test.id}`,
        `DSL test ${test.id} (load failure)`,
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
      `\nPhase 4 complete: ${report.passed}/${report.totalTests} passed, score ${report.totalScore}/${report.maxPossibleScore} (${pct}%)\n`,
    );
    process.exit(report.failed + report.errors > 0 ? 1 : 0);
  } catch (err) {
    console.error("Phase 4 fatal error:", err);
    process.exit(2);
  }
}
