// ─────────────────────────────────────────────────────────────
// Phase 5 — Run All Tests
// Orchestrates all Phase 5 functional tests, passing a shared
// GeminiWrapper and CostTracker instance to each test file.
// Returns a PhaseReport with aggregated results.
// ─────────────────────────────────────────────────────────────

import { TestHarness, type PhaseReport } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

// Import all test modules
import { run as run01 } from "./01-trivial-task.ts";
import { run as run02 } from "./02-agent-routing.ts";
import { run as run03 } from "./03-multi-step.ts";
import { run as run04 } from "./04-escalation-chain.ts";
import { run as run05 } from "./05-group-chat.ts";
import { run as run06 } from "./06-rag-enriched.ts";
import { run as run07 } from "./07-durable-workflow.ts";
import { run as run08 } from "./08-full-hierarchy.ts";

/** All test runners in execution order */
const ALL_TESTS = [
  { id: "01", name: "Trivial Task", run: run01 },
  { id: "02", name: "Agent Routing", run: run02 },
  { id: "03", name: "Multi-Step Workflow", run: run03 },
  { id: "04", name: "Escalation Chain", run: run04 },
  { id: "05", name: "Group Chat", run: run05 },
  { id: "06", name: "RAG Enriched", run: run06 },
  { id: "07", name: "Durable Workflow", run: run07 },
  { id: "08", name: "Full Hierarchy", run: run08 },
];

export async function run(
  gemini: GeminiWrapper,
  costTracker: CostTracker,
): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 5 — Functional (Live Gemini)");
  harness.start();

  for (const test of ALL_TESTS) {
    try {
      await test.run(harness, gemini, costTracker);
    } catch (err) {
      // If an entire test module throws (not caught by internal error handling),
      // record it as an error rather than crashing the whole suite.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  [ERR!] Test ${test.id} (${test.name}) threw unhandled error: ${msg}`,
      );
      // Use the harness to record the failure so it shows in the report
      await harness.runTest(
        `5.${test.id}`,
        `${test.name} (unhandled error)`,
        async () => ({
          score: 0,
          maxScore: 10,
          details: `Unhandled error in test module: ${msg}`,
          metadata: {
            error: msg,
            stack: err instanceof Error ? err.stack : undefined,
          },
        }),
      );
    }
  }

  const report = harness.getReport();

  // Print summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Phase 5 Summary`);
  console.log(`${"─".repeat(60)}`);
  console.log(`  Tests:   ${report.totalTests}`);
  console.log(`  Passed:  ${report.passed}`);
  console.log(`  Failed:  ${report.failed}`);
  console.log(`  Errors:  ${report.errors}`);
  console.log(`  Score:   ${report.totalScore} / ${report.maxPossibleScore}`);
  if (report.maxPossibleScore > 0) {
    const pct = ((report.totalScore / report.maxPossibleScore) * 100).toFixed(
      1,
    );
    console.log(`  Percent: ${pct}%`);
  }

  // Print cost summary
  const costSummary = costTracker.getSummary();
  console.log(`\n  Cost Summary:`);
  console.log(`    Total calls:  ${costSummary.totalCalls}`);
  console.log(
    `    Total tokens: ${costSummary.totalInputTokens + costSummary.totalOutputTokens}`,
  );
  console.log(`    Est. cost:    $${costSummary.totalCost.toFixed(4)}`);
  console.log(`    Remaining:    $${costSummary.remainingBudget.toFixed(4)}`);
  console.log(`    Active key:   ${costSummary.activeKey}`);
  console.log(`${"─".repeat(60)}\n`);

  return report;
}
