// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: WorkerPool Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.5.1: Create pool and submit tasks ──────────────
  await harness.runTest(
    "2.5.1",
    "WorkerPool — Create pool with mock executor, submit tasks",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { WorkerPool } = await import("../../core/worker-pool.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const pool = new WorkerPool(logger, {
            minWorkers: 2,
            maxWorkers: 4,
            taskTimeout: 5_000,
          });

          // Mock executor that doubles a number
          const executor = async (payload: unknown): Promise<unknown> => {
            const num = typeof payload === "number" ? payload : 0;
            return num * 2;
          };

          await pool.start(executor);
          details.push("Pool started");
          score += 2;

          if (pool.isRunning()) {
            details.push("Pool is running");
            score += 1;
          }

          // Submit a single task
          const result1 = await pool.submit(5, 3);
          if (result1 === 10) {
            details.push("submit(5) returned 10 (correct)");
            score += 3;
          } else {
            details.push(`submit(5) returned ${result1} (expected 10)`);
            score += 1;
          }

          // Submit multiple tasks
          const results = await pool.submitAll([
            { payload: 1, priority: 3 },
            { payload: 2, priority: 3 },
            { payload: 3, priority: 3 },
          ]);
          if (Array.isArray(results) && results.length === 3) {
            details.push(
              `submitAll returned ${results.length} results: [${results.join(",")}]`,
            );
            if (results[0] === 2 && results[1] === 4 && results[2] === 6) {
              details.push("All results correct");
              score += 3;
            } else {
              score += 1;
            }
          }

          // Check metrics
          const metrics = pool.getMetrics();
          if (metrics && metrics.totalTasksProcessed >= 4) {
            details.push(
              `totalTasksProcessed = ${metrics.totalTasksProcessed}`,
            );
            score += 1;
          }

          await pool.stop();
          details.push("Pool stopped");

          await logger.close();
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

  // ── Test 2.5.2: Priority ordering ─────────────────────────
  await harness.runTest("2.5.2", "WorkerPool — Priority ordering", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { WorkerPool } = await import("../../core/worker-pool.ts");
      const { SynapseLogger } = await import("../../core/logger.ts");

      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const logger = new SynapseLogger(tempDir, "debug");

      try {
        // Create pool with only 1 worker to force sequential execution
        const pool = new WorkerPool(logger, {
          minWorkers: 1,
          maxWorkers: 1,
          taskTimeout: 5_000,
        });

        const completionOrder: number[] = [];

        // Executor that records completion order
        const executor = async (payload: unknown): Promise<unknown> => {
          const id = typeof payload === "number" ? payload : 0;
          // Small delay so tasks queue up
          await new Promise((r) => setTimeout(r, 10));
          completionOrder.push(id);
          return id;
        };

        await pool.start(executor);
        details.push("Pool started with 1 worker");
        score += 2;

        // Submit tasks with different priorities (higher number = higher priority)
        // Submit low priority first, then high
        const promises = [
          pool.submit(1, 1), // low priority
          pool.submit(2, 5), // high priority
          pool.submit(3, 3), // medium priority
        ];

        await Promise.all(promises);
        details.push(`Completion order: [${completionOrder.join(",")}]`);
        score += 3;

        // With priority ordering, the first task (already dispatched) runs first,
        // but from the queue, task 2 (priority 5) should come before task 3 (priority 3)
        // Task 1 may already be executing when 2 and 3 are queued
        if (completionOrder.length === 3) {
          details.push("All 3 tasks completed");
          score += 3;

          // The queue should prioritize higher priority when picking next
          // Since task 1 was already dispatched, check that among remaining, 5 > 3
          const idx2 = completionOrder.indexOf(2);
          const idx3 = completionOrder.indexOf(3);
          if (idx2 < idx3) {
            details.push(
              "Higher priority task (5) completed before lower (3) from queue",
            );
            score += 2;
          } else {
            details.push(
              "Priority ordering not strictly observed (may depend on timing)",
            );
            score += 1;
          }
        }

        await pool.stop();
        await logger.close();
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
  });
}
