// ─────────────────────────────────────────────────────────────
// Phase 10.01: SQLite Performance Benchmarks
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  const tmpDir = join(import.meta.dir, ".bench-db");

  function setup() {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
  }
  function cleanup() {
    try {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    } catch {}
  }

  await harness.runTest(
    "10.01.1",
    "SQLite — write 1000 agents (ops/sec)",
    async () => {
      setup();
      const { SQLiteStore } = await import(
        join(ROOT, "core/storage/sqlite-store.ts")
      );
      const store = new SQLiteStore(tmpDir);
      await store.init();

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        await store.saveAgent({
          id: `bench-agent-${i}`,
          name: `Bench ${i}`,
          tier: "worker",
          capabilities: ["test", `cap-${i}`],
          sections: ["test"],
          format: "markdown",
          systemPrompt: `Agent ${i}`,
          status: "idle",
        } as any);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((1000 / elapsed) * 1000);

      await store.close();
      cleanup();
      return {
        score:
          opsPerSec > 1000 ? 10 : opsPerSec > 500 ? 7 : opsPerSec > 100 ? 4 : 0,
        maxScore: 10,
        details: `${opsPerSec} ops/sec (${elapsed.toFixed(1)}ms for 1000 writes)`,
        metadata: { opsPerSec, elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest(
    "10.01.2",
    "SQLite — read 1000 agents (ops/sec)",
    async () => {
      setup();
      const { SQLiteStore } = await import(
        join(ROOT, "core/storage/sqlite-store.ts")
      );
      const store = new SQLiteStore(tmpDir);
      await store.init();

      for (let i = 0; i < 1000; i++) {
        await store.saveAgent({
          id: `bench-${i}`,
          name: `A${i}`,
          tier: "worker",
          capabilities: ["t"],
          sections: ["t"],
          format: "markdown",
          systemPrompt: "p",
          status: "idle",
        } as any);
      }

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        await store.getAgent(`bench-${i}`);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((1000 / elapsed) * 1000);

      await store.close();
      cleanup();
      return {
        score:
          opsPerSec > 5000
            ? 10
            : opsPerSec > 2000
              ? 7
              : opsPerSec > 500
                ? 4
                : 0,
        maxScore: 10,
        details: `${opsPerSec} ops/sec (${elapsed.toFixed(1)}ms for 1000 reads)`,
        metadata: { opsPerSec, elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest("10.01.3", "SQLite — FTS5 search latency", async () => {
    setup();
    const { SQLiteStore } = await import(
      join(ROOT, "core/storage/sqlite-store.ts")
    );
    const store = new SQLiteStore(tmpDir);
    await store.init();

    // Index documents via FTS
    for (let i = 0; i < 500; i++) {
      store.saveTaskResult(
        {
          requestId: `task-${i}`,
          executor: `agent-${i % 10}`,
          status: "success",
          output: `Task about ${["react", "database", "security", "api", "testing"][i % 5]} optimization ${i}`,
          duration: 100,
        } as any,
        `Task about ${["react", "database", "security", "api", "testing"][i % 5]} optimization ${i}`,
      );
    }

    const latencies: number[] = [];
    const queries = [
      "react optimization",
      "database",
      "security testing",
      "api design",
    ];
    for (const q of queries) {
      for (let j = 0; j < 5; j++) {
        const s = performance.now();
        store.ftsQuery("tasks", q, 10);
        latencies.push(performance.now() - s);
      }
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    await store.close();
    cleanup();
    return {
      score: p95 < 10 ? 10 : p95 < 50 ? 7 : p95 < 200 ? 4 : 0,
      maxScore: 10,
      details: `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms over ${latencies.length} queries`,
      metadata: { p50, p95, count: latencies.length },
    };
  });
}
