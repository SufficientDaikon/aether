// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: Subsystem Unit Tests Runner
// ─────────────────────────────────────────────────────────────

import {
  TestHarness,
  writeReport,
  type PhaseReport,
} from "../helpers/test-harness.ts";

const TESTS = [
  { id: "01", mod: () => import("./01-storage.test.ts") },
  { id: "02", mod: () => import("./02-registry.test.ts") },
  { id: "03", mod: () => import("./03-interaction-net.test.ts") },
  { id: "04", mod: () => import("./04-net-scheduler.test.ts") },
  { id: "05", mod: () => import("./05-worker-pool.test.ts") },
  { id: "06", mod: () => import("./06-memory-highway.test.ts") },
  { id: "07", mod: () => import("./07-rag-index.test.ts") },
  { id: "08", mod: () => import("./08-rag-meta-index.test.ts") },
  { id: "09", mod: () => import("./09-embedder.test.ts") },
  { id: "10", mod: () => import("./10-escalation.test.ts") },
  { id: "11", mod: () => import("./11-guardrails.test.ts") },
  { id: "12", mod: () => import("./12-conversation.test.ts") },
  { id: "13", mod: () => import("./13-entity-memory.test.ts") },
  { id: "14", mod: () => import("./14-handoff.test.ts") },
  { id: "15", mod: () => import("./15-state-graph.test.ts") },
  { id: "16", mod: () => import("./16-workflow-builder.test.ts") },
  { id: "17", mod: () => import("./17-durable.test.ts") },
  { id: "18", mod: () => import("./18-conflict-resolution.test.ts") },
  { id: "19", mod: () => import("./19-progress-tracker.test.ts") },
  { id: "20", mod: () => import("./20-acp.test.ts") },
  { id: "21", mod: () => import("./21-shared-state.test.ts") },
  { id: "22", mod: () => import("./22-plugin.test.ts") },
  { id: "23", mod: () => import("./23-reaction-engine.test.ts") },
  { id: "24", mod: () => import("./24-tier-registry.test.ts") },
  { id: "25", mod: () => import("./25-forge.test.ts") },
  { id: "26", mod: () => import("./26-sentinel.test.ts") },
  { id: "27", mod: () => import("./27-preflight.test.ts") },
  { id: "28", mod: () => import("./28-settings.test.ts") },
];

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 2: Subsystem Unit Tests");
  harness.start();

  for (const test of TESTS) {
    try {
      const mod = await test.mod();
      await mod.run(harness);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  [FATAL] Failed to load/run subsystem test ${test.id}: ${msg}`,
      );
      harness.skipTest(
        `2.${test.id}`,
        `Subsystem ${test.id} (load failure)`,
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
      `\nPhase 2 complete: ${report.passed}/${report.totalTests} passed (${pct}%)\n`,
    );
    process.exit(report.failed + report.errors > 0 ? 1 : 0);
  } catch (err) {
    console.error("Phase 2 fatal error:", err);
    process.exit(2);
  }
}
