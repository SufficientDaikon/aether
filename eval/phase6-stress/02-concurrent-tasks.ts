// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: Concurrent Task Submission Stress Test
// Submits 50 tasks simultaneously via WorkerPool, measures completion
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.2",
    "Concurrent tasks -- 50 simultaneous via WorkerPool",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      let pool: any = null;
      const TIMEOUT_MS = 30_000;

      try {
        const { WorkerPool } = await import("../../core/worker-pool.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-stress-tasks-"));
        const logger = new SynapseLogger(tempDir, "warn");

        try {
          pool = new WorkerPool(logger, {
            minWorkers: 4,
            maxWorkers: 8,
            taskTimeout: 10_000,
            maxRetries: 1,
            scaleUpThreshold: 5,
          });

          // Mock executor that simulates 10-50ms work
          let completedCount = 0;
          const executor = async (payload: unknown): Promise<unknown> => {
            const data = payload as { id: number; delay: number };
            await new Promise((r) => setTimeout(r, data.delay));
            completedCount++;
            return { id: data.id, result: data.id * 2 };
          };

          await pool.start(executor);
          details.push("WorkerPool started with 4-8 workers");
          score += 1;

          const TASK_COUNT = 50;
          const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
            payload: { id: i, delay: 10 + Math.floor(Math.random() * 40) },
            priority: (i % 5) + 1,
          }));

          // Submit all 50 simultaneously and measure
          const startTime = performance.now();

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Concurrent tasks timed out")),
              TIMEOUT_MS,
            ),
          );

          const resultsPromise = pool.submitAll(tasks);
          const results = await Promise.race([resultsPromise, timeoutPromise]);

          const elapsed = performance.now() - startTime;

          details.push(
            `Submitted ${TASK_COUNT} tasks concurrently, completed in ${elapsed.toFixed(0)}ms`,
          );

          // Check all tasks returned results
          if (Array.isArray(results) && results.length === TASK_COUNT) {
            score += 3;
            details.push(`All ${TASK_COUNT} results returned`);
          } else {
            const count = Array.isArray(results) ? results.length : 0;
            details.push(`Only ${count}/${TASK_COUNT} results returned`);
            score += 1;
          }

          // Verify result correctness
          let correctCount = 0;
          if (Array.isArray(results)) {
            for (let i = 0; i < results.length; i++) {
              const r = results[i] as any;
              if (r && r.id === i && r.result === i * 2) {
                correctCount++;
              }
            }
          }

          if (correctCount === TASK_COUNT) {
            score += 2;
            details.push("All results verified correct");
          } else if (correctCount > TASK_COUNT * 0.9) {
            score += 1;
            details.push(`${correctCount}/${TASK_COUNT} results correct`);
          } else {
            details.push(`Only ${correctCount}/${TASK_COUNT} results correct`);
          }

          // Count failures
          const metrics = pool.getMetrics();
          const failures = metrics.totalTasksFailed ?? 0;
          if (failures === 0) {
            score += 2;
            details.push("Zero task failures");
          } else {
            details.push(`${failures} task failures`);
            score += 1;
          }

          // Check throughput: 50 tasks with ~30ms avg delay, ideal ~200ms with 8 workers
          if (elapsed < 5000) {
            score += 2;
            details.push(`Good completion time: ${elapsed.toFixed(0)}ms`);
          } else {
            score += 1;
            details.push(`Slow completion time: ${elapsed.toFixed(0)}ms`);
          }

          details.push(
            `Metrics: processed=${metrics.totalTasksProcessed}, failed=${metrics.totalTasksFailed}, workers=${metrics.totalWorkers}`,
          );

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
        metadata: { test: "concurrent-tasks" },
      };
    },
  );
}
