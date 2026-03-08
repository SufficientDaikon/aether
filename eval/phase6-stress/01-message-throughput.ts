// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: MemoryHighway Message Throughput Stress Test
// Publishes 10,000 messages and measures throughput + dedup correctness
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.1",
    "MemoryHighway -- 10k message throughput",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      const TIMEOUT_MS = 30_000;

      try {
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-stress-highway-"));
        const logger = new SynapseLogger(tempDir, "warn");

        try {
          const highway = new MemoryHighway(logger, null, null, {
            enableRAG: false,
            enableDedup: true,
            dedupWindowMs: 60_000,
            maxRetainedMessages: 15_000,
          });

          let received = 0;
          highway.subscribe("stress", () => {
            received++;
          });

          const MESSAGE_COUNT = 10_000;

          // Publish 10,000 unique messages and measure time
          const startTime = performance.now();

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Throughput test timed out")),
              TIMEOUT_MS,
            ),
          );

          const publishPromise = (async () => {
            for (let i = 0; i < MESSAGE_COUNT; i++) {
              await highway.publish(
                "stress",
                "event",
                { index: i },
                {
                  summary: `Stress message ${i}`,
                  sender: `agent-${i % 10}`,
                  priority: (i % 5) + 1,
                },
              );
            }
          })();

          await Promise.race([publishPromise, timeoutPromise]);

          const elapsed = performance.now() - startTime;
          const msgsPerSec = Math.round((MESSAGE_COUNT / elapsed) * 1000);

          details.push(
            `Published ${MESSAGE_COUNT} messages in ${elapsed.toFixed(0)}ms`,
          );
          details.push(`Throughput: ${msgsPerSec} msg/sec`);

          // Score based on throughput
          if (msgsPerSec >= 5000) {
            score += 6;
            details.push("Throughput >= 5000 msg/sec (full marks)");
          } else if (msgsPerSec >= 2000) {
            score += 4;
            details.push("Throughput >= 2000 msg/sec (good)");
          } else if (msgsPerSec >= 500) {
            score += 2;
            details.push("Throughput >= 500 msg/sec (acceptable)");
          } else {
            score += 1;
            details.push("Throughput below 500 msg/sec (slow)");
          }

          // Check that dedup did not block unique messages
          // Each message has a unique summary so they should all get through
          if (received === MESSAGE_COUNT) {
            score += 2;
            details.push(
              `All ${MESSAGE_COUNT} unique messages delivered to subscriber`,
            );
          } else {
            // Some may be deduped if summary+channel+sender collide
            const ratio = received / MESSAGE_COUNT;
            if (ratio >= 0.95) {
              score += 1;
              details.push(
                `${received}/${MESSAGE_COUNT} delivered (${(ratio * 100).toFixed(1)}% -- minor dedup collisions)`,
              );
            } else {
              details.push(
                `Only ${received}/${MESSAGE_COUNT} delivered (${(ratio * 100).toFixed(1)}%)`,
              );
            }
          }

          // Verify metrics
          const metrics = highway.getMetrics();
          if (metrics.totalMessages >= MESSAGE_COUNT * 0.9) {
            score += 1;
            details.push(`Metrics totalMessages=${metrics.totalMessages}`);
          }

          // Check history length (capped at maxRetainedMessages)
          if (highway.historyLength > 0) {
            score += 1;
            details.push(`History retained ${highway.historyLength} messages`);
          }

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
        metadata: { test: "message-throughput" },
      };
    },
  );
}
