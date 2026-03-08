// ─────────────────────────────────────────────────────────────
// Phase 10.02: Embedder Performance Benchmarks
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  const logDir = join(import.meta.dir, ".bench-embed-logs");

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
    "10.02.1",
    "Embedder — single doc latency (100 iterations)",
    async () => {
      setup();
      const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
      const { Embedder } = await import(join(ROOT, "core/embedder.ts"));
      const logger = new SynapseLogger(logDir);
      const embedder = new Embedder(logger);

      // Warm up corpus
      const docs = Array.from(
        { length: 20 },
        (_, i) =>
          `Document ${i} about ${["react", "database", "security", "testing", "api"][i % 5]} development`,
      );
      for (const d of docs) embedder.addToCorpus(d);

      const latencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = performance.now();
        await embedder.embed(`Query about testing and security topic ${i}`);
        latencies.push(performance.now() - s);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[50];
      const p95 = latencies[95];

      try {
        logger.close();
      } catch {}
      cleanup();
      return {
        score: p95 < 5 ? 10 : p95 < 20 ? 7 : p95 < 100 ? 4 : 0,
        maxScore: 10,
        details: `p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms`,
        metadata: { p50, p95 },
      };
    },
  );

  await harness.runTest(
    "10.02.2",
    "Embedder — batch 100 docs throughput",
    async () => {
      setup();
      const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
      const { Embedder } = await import(join(ROOT, "core/embedder.ts"));
      const logger = new SynapseLogger(logDir);
      const embedder = new Embedder(logger);

      const docs = Array.from(
        { length: 100 },
        (_, i) =>
          `Article ${i}: The ${["quick", "lazy", "fast", "smart", "bold"][i % 5]} ${["fox", "dog", "cat", "bird", "fish"][i % 5]} discusses ${["react", "python", "rust", "go", "java"][i % 5]} patterns`,
      );

      const start = performance.now();
      for (const d of docs) embedder.addToCorpus(d);
      for (const d of docs) await embedder.embed(d);
      const elapsed = performance.now() - start;

      try {
        logger.close();
      } catch {}
      cleanup();
      return {
        score: elapsed < 500 ? 10 : elapsed < 1000 ? 7 : elapsed < 3000 ? 4 : 0,
        maxScore: 10,
        details: `100 docs in ${elapsed.toFixed(1)}ms (${(100000 / elapsed).toFixed(0)} docs/sec)`,
        metadata: { elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest(
    "10.02.3",
    "Embedder — output dimensionality = 384",
    async () => {
      setup();
      const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
      const { Embedder } = await import(join(ROOT, "core/embedder.ts"));
      const logger = new SynapseLogger(logDir);
      const embedder = new Embedder(logger);
      embedder.addToCorpus("test document for dimension check");
      const result = await embedder.embed("test document for dimension check");
      const dim = result.vector.length;

      try {
        logger.close();
      } catch {}
      cleanup();
      return {
        score: dim === 384 ? 10 : 0,
        maxScore: 10,
        details: `dim=${dim} (expected 384)`,
      };
    },
  );
}
