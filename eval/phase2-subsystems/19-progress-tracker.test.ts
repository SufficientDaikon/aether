// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: ProgressTracker Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.19.1: Track execution events ──────────────────────
  await harness.runTest(
    "2.19.1",
    "ProgressTracker — Track execution events and summary",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ProgressTracker } =
          await import("../../core/progress-tracker.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const tracker = new ProgressTracker(store);
          details.push("ProgressTracker created");
          score += 1;

          const wfId = "wf-progress-test";

          // Track several execution events
          tracker.trackExecution(
            wfId,
            0,
            "agent-a",
            "Output from step 0",
            1000,
            5000,
          );
          tracker.trackExecution(
            wfId,
            1,
            "agent-b",
            "Output from step 1",
            1500,
            6000,
          );
          tracker.trackExecution(
            wfId,
            2,
            "agent-c",
            "Output from step 2",
            2000,
            7000,
          );

          details.push("3 execution events tracked");
          score += 2;

          // Get summary
          const summary = tracker.getSummary(wfId);

          if (summary.totalSteps === 3) {
            details.push("Summary reports 3 total steps");
            score += 2;
          }

          if (summary.totalTokens === 4500) {
            details.push("Total tokens: 4500 (correct)");
            score += 1;
          }

          if (summary.uniqueAgents === 3) {
            details.push("Unique agents: 3");
            score += 1;
          }

          if (summary.averageDurationMs > 0) {
            details.push(
              `Average duration: ${Math.round(summary.averageDurationMs)}ms`,
            );
            score += 1;
          }

          // Budget estimation
          const budget = tracker.estimateBudget(10, 4000, 10000);
          if (
            budget.estimatedTokens === 40000 &&
            budget.estimatedTimeMs === 100000
          ) {
            details.push("Budget estimation correct");
            score += 2;
          }

          // Cleanup
          tracker.cleanup(wfId);

          await store.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.19.2: Detect loop ─────────────────────────────────
  await harness.runTest(
    "2.19.2",
    "ProgressTracker — Detect loop from identical outputs",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ProgressTracker } =
          await import("../../core/progress-tracker.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const tracker = new ProgressTracker(store, {
            maxConsecutiveSimilar: 3,
          });

          const wfId = "wf-loop-test";

          // Same agent, same output 4 times (should trigger loop detection)
          const identicalOutput =
            "I am stuck in a loop and producing the same output.";
          tracker.trackExecution(
            wfId,
            0,
            "stuck-agent",
            identicalOutput,
            500,
            2000,
          );
          tracker.trackExecution(
            wfId,
            1,
            "stuck-agent",
            identicalOutput,
            500,
            2000,
          );
          tracker.trackExecution(
            wfId,
            2,
            "stuck-agent",
            identicalOutput,
            500,
            2000,
          );
          tracker.trackExecution(
            wfId,
            3,
            "stuck-agent",
            identicalOutput,
            500,
            2000,
          );

          details.push("4 identical events tracked for same agent");
          score += 2;

          const loopWarning = tracker.detectLoop(wfId);
          if (loopWarning !== null) {
            details.push(`Loop detected: ${loopWarning.message}`);
            score += 4;

            if (loopWarning.agentId === "stuck-agent") {
              details.push("Correct agent identified in loop warning");
              score += 1;
            }

            if (loopWarning.consecutiveCount >= 3) {
              details.push(
                `Consecutive count: ${loopWarning.consecutiveCount}`,
              );
              score += 1;
            }
          } else {
            details.push("Loop NOT detected (expected detection)");
          }

          // shouldAbort should also trigger
          const abort = tracker.shouldAbort(wfId);
          if (abort.abort && abort.reason.length > 0) {
            details.push(`shouldAbort: true — ${abort.reason.slice(0, 80)}`);
            score += 2;
          }

          tracker.cleanup(wfId);
          await store.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
