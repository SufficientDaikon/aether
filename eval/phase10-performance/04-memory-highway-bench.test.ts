// ─────────────────────────────────────────────────────────────
// Phase 10.04: Memory Highway Throughput Benchmarks
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  const logDir = join(import.meta.dir, ".bench-highway-logs");

  function setup() {
    if (existsSync(logDir)) rmSync(logDir, { recursive: true });
    mkdirSync(logDir, { recursive: true });
  }
  function cleanup() {
    try {
      if (existsSync(logDir)) rmSync(logDir, { recursive: true });
    } catch {}
  }

  await harness.runTest(
    "10.04.1",
    "MemoryHighway — 1000 messages single subscriber",
    async () => {
      setup();
      const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
      const { MemoryHighway } = await import(
        join(ROOT, "core/memory-highway.ts")
      );
      const logger = new SynapseLogger(logDir);
      const highway = new MemoryHighway(logger, null, null, {
        enableRAG: false,
        enableDedup: false,
      });

      let received = 0;
      highway.subscribe("bench", () => {
        received++;
      });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        await highway.publish("bench", "event", {
          idx: i,
          data: `message-${i}`,
        });
      }
      const elapsed = performance.now() - start;
      const msgsPerSec = Math.round((1000 / elapsed) * 1000);

      try {
        logger.close();
      } catch {}
      cleanup();
      return {
        score:
          msgsPerSec > 50_000
            ? 10
            : msgsPerSec > 10_000
              ? 7
              : msgsPerSec > 1_000
                ? 4
                : 0,
        maxScore: 10,
        details: `${msgsPerSec.toLocaleString()} msg/sec (${elapsed.toFixed(1)}ms, received=${received})`,
        metadata: { msgsPerSec, elapsedMs: elapsed, received },
      };
    },
  );

  await harness.runTest(
    "10.04.2",
    "MemoryHighway — 10 subscribers fan-out",
    async () => {
      setup();
      const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
      const { MemoryHighway } = await import(
        join(ROOT, "core/memory-highway.ts")
      );
      const logger = new SynapseLogger(logDir);
      const highway = new MemoryHighway(logger, null, null, {
        enableRAG: false,
        enableDedup: false,
      });

      let totalReceived = 0;
      for (let s = 0; s < 10; s++) {
        highway.subscribe("fan", () => {
          totalReceived++;
        });
      }

      const COUNT = 500;
      const start = performance.now();
      for (let i = 0; i < COUNT; i++) {
        await highway.publish("fan", "broadcast", { idx: i });
      }
      const elapsed = performance.now() - start;
      const deliveriesPerSec = Math.round((totalReceived / elapsed) * 1000);

      try {
        logger.close();
      } catch {}
      cleanup();
      return {
        score:
          deliveriesPerSec > 50_000
            ? 10
            : deliveriesPerSec > 20_000
              ? 7
              : deliveriesPerSec > 5_000
                ? 4
                : 0,
        maxScore: 10,
        details: `${deliveriesPerSec.toLocaleString()} deliveries/sec (${COUNT} msgs x 10 subs = ${totalReceived} in ${elapsed.toFixed(1)}ms)`,
        metadata: { deliveriesPerSec, elapsedMs: elapsed, totalReceived },
      };
    },
  );

  await harness.runTest(
    "10.04.3",
    "MemoryHighway — publish latency p50/p95",
    async () => {
      setup();
      const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
      const { MemoryHighway } = await import(
        join(ROOT, "core/memory-highway.ts")
      );
      const logger = new SynapseLogger(logDir);
      const highway = new MemoryHighway(logger, null, null, {
        enableRAG: false,
        enableDedup: false,
      });
      highway.subscribe("lat", () => {});

      const latencies: number[] = [];
      for (let i = 0; i < 500; i++) {
        const s = performance.now();
        await highway.publish("lat", "event", { i });
        latencies.push(performance.now() - s);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[250];
      const p95 = latencies[475];
      const p99 = latencies[495];

      try {
        logger.close();
      } catch {}
      cleanup();
      return {
        score: p95 < 1 ? 10 : p95 < 5 ? 7 : p95 < 50 ? 4 : 0,
        maxScore: 10,
        details: `p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms`,
        metadata: { p50, p95, p99 },
      };
    },
  );
}
