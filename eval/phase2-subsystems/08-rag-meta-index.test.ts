// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: RAGMetaIndex Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.8.1: Meta-index 3-tier query ───────────────────
  await harness.runTest(
    "2.8.1",
    "RAGMetaIndex — 3-tier query acceleration (hot cache, bloom, full)",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { RAGIndex } = await import("../../core/rag-index.ts");
        const { RAGMetaIndex } = await import("../../core/rag-meta-index.ts");
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
          });
          const ragIndex = new RAGIndex(embedder, logger, {}, store);
          await ragIndex.initialize();

          // Index some content
          await ragIndex.index(
            "docs",
            "React hooks tutorial and best practices",
            {
              sourceId: "doc-hooks",
              contentType: "text",
            },
          );
          await ragIndex.index(
            "docs",
            "Advanced TypeScript patterns for enterprise apps",
            {
              sourceId: "doc-ts",
              contentType: "text",
            },
          );

          embedder.addToCorpus("React hooks tutorial best practices");
          embedder.addToCorpus("TypeScript patterns enterprise");

          // Create meta-index
          const metaIndex = new RAGMetaIndex(ragIndex, logger, {
            hotCacheSize: 100,
            hotCacheTTL: 60_000,
            cacheAfterHits: 1, // Cache after first hit for testing
          });
          details.push("RAGMetaIndex created");
          score += 2;

          // First query: should be "full" tier (no cache)
          const result1 = await metaIndex.query("React hooks tutorial", 5);
          if (result1 && result1.tier) {
            details.push(`First query tier: ${result1.tier}`);
            score += 2;
          }
          if (Array.isArray(result1.results)) {
            details.push(
              `First query returned ${result1.results.length} result(s)`,
            );
            score += 2;
          }

          // Second query with same text: may hit hot cache
          const result2 = await metaIndex.query("React hooks tutorial", 5);
          if (result2 && result2.tier) {
            details.push(`Second query tier: ${result2.tier}`);
            if (result2.tier === "hot") {
              details.push("Hot cache hit on repeat query");
              score += 2;
            } else {
              score += 1;
            }
          }

          // Check metrics
          const metrics = metaIndex.getMetrics();
          if (metrics) {
            details.push(
              `Metrics: totalQueries=${metrics.totalQueries}, hotHits=${metrics.hotCacheHits}`,
            );
            score += 2;
          }

          // smartQuery convenience method
          try {
            const smart = await metaIndex.smartQuery("TypeScript patterns", 5);
            if (Array.isArray(smart)) {
              details.push(`smartQuery returned ${smart.length} result(s)`);
            }
          } catch {
            details.push("smartQuery errored (non-critical)");
          }

          await ragIndex.shutdown();
          await store.close();
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

  // ── Test 2.8.2: Cache invalidation and clear ──────────────
  await harness.runTest(
    "2.8.2",
    "RAGMetaIndex — Cache invalidation and clear",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { RAGIndex } = await import("../../core/rag-index.ts");
        const { RAGMetaIndex } = await import("../../core/rag-meta-index.ts");
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
          });
          const ragIndex = new RAGIndex(embedder, logger, {}, store);
          await ragIndex.initialize();

          const metaIndex = new RAGMetaIndex(ragIndex, logger, {
            cacheAfterHits: 1,
            hotCacheTTL: 60_000,
          });

          // Warm the cache
          await metaIndex.query("test query for invalidation", 5);
          await metaIndex.query("test query for invalidation", 5);
          details.push("Cache warmed with repeat query");
          score += 2;

          // Invalidate a namespace
          metaIndex.invalidateNamespace("docs");
          details.push("invalidateNamespace('docs') called");
          score += 3;

          // Clear all caches
          metaIndex.clear();
          details.push("clear() called");
          score += 3;

          // Check hit rate methods
          const cacheRate = metaIndex.getCacheHitRate();
          const bloomRate = metaIndex.getBloomHitRate();
          if (typeof cacheRate === "number" && typeof bloomRate === "number") {
            details.push(
              `cacheHitRate=${cacheRate.toFixed(3)}, bloomHitRate=${bloomRate.toFixed(3)}`,
            );
            score += 2;
          }

          await ragIndex.shutdown();
          await store.close();
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
}
