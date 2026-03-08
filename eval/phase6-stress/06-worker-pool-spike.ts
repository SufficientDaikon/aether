// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: WorkerPool Elasticity Spike Test
// Submit 100 tasks with mock executor (50ms each), measure total
// time and verify all complete
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.6",
    "WorkerPool -- 100-task spike with 50ms executor",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      let pool: any = null;
      const TIMEOUT_MS = 60_000;

      try {
        const { WorkerPool } = await import("../../core/worker-pool.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-stress-spike-"));
        const logger = new SynapseLogger(tempDir, "warn");

        try {
          pool = new WorkerPool(logger, {
            minWorkers: 2,
            maxWorkers: 10,
            taskTimeout: 10_000,
            maxRetries: 1,
            scaleUpThreshold: 5,
            idleTimeoutMs: 5_000,
            healthCheckMs: 1_000,
          });

          // Mock executor: ~50ms per task
          const completionLog: number[] = [];
          const executor = async (payload: unknown): Promise<unknown> => {
            const id = (payload as { id: number }).id;
            await new Promise((r) => setTimeout(r, 50));
            completionLog.push(id);
            return { id, done: true };
          };

          await pool.start(executor);
          details.push("WorkerPool started (min=2, max=10)");
          score += 1;

          const TASK_COUNT = 100;
          const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
            payload: { id: i },
            priority: 3,
          }));

          // Submit all 100 at once
          const startTime = performance.now();

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Spike test timed out")),
              TIMEOUT_MS,
            ),
          );

          const resultsPromise = pool.submitAll(tasks);
          const results = await Promise.race([resultsPromise, timeoutPromise]);

          const elapsed = performance.now() - startTime;

          details.push(
            `${TASK_COUNT} tasks completed in ${elapsed.toFixed(0)}ms`,
          );

          // Verify all tasks completed
          if (Array.isArray(results) && results.length === TASK_COUNT) {
            score += 3;
            details.push(`All ${TASK_COUNT} results returned`);
          } else {
            const count = Array.isArray(results) ? results.length : 0;
            score += 1;
            details.push(`${count}/${TASK_COUNT} results returned`);
          }

          // Verify all completions were logged
          if (completionLog.length === TASK_COUNT) {
            score += 2;
            details.push(`All ${TASK_COUNT} tasks ran through executor`);
          } else {
            details.push(
              `${completionLog.length}/${TASK_COUNT} executor completions`,
            );
          }

          // Check metrics
          const metrics = pool.getMetrics();
          details.push(
            `Metrics: processed=${metrics.totalTasksProcessed}, failed=${metrics.totalTasksFailed}, avgDuration=${metrics.averageTaskDuration.toFixed(1)}ms`,
          );

          if (metrics.totalTasksFailed === 0) {
            score += 1;
            details.push("Zero failures");
          }

          // Performance check: with 10 workers and 50ms tasks,
          // ideal = 100/10 * 50ms = 500ms. Realistic: 1-5s
          if (elapsed < 10_000) {
            score += 2;
            details.push(
              `Completion time ${elapsed.toFixed(0)}ms is within acceptable range`,
            );
          } else {
            score += 1;
            details.push(`Completion time ${elapsed.toFixed(0)}ms is slow`);
          }

          // Verify elasticity: pool should have scaled up from 2
          const workerInfos = pool.getWorkerInfos();
          details.push(`Final worker count: ${workerInfos.length}`);
          if (workerInfos.length > 2) {
            score += 1;
            details.push("Pool scaled up beyond minimum (elasticity working)");
          }

          await pool.stop();
          pool = null;
          details.push("Pool stopped cleanly");

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
        if (pool) {
          try {
            await pool.stop();
          } catch {}
        }
        if (tempDir) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
        }
      }

      return {
        score,
        maxScore,
        details: details.join("; "),
        metadata: { test: "worker-pool-spike" },
      };
    },
  );
}
