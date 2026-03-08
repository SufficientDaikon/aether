// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: Embedder Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.9.1: Embed text, verify 384-dim output ────────
  await harness.runTest(
    "2.9.1",
    "Embedder — Embed text produces 384-dim vector",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 8;
      const details: string[] = [];

      try {
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
          });

          const result = await embedder.embed(
            "React component architecture for scalable UIs",
          );

          if (result && result.vector) {
            details.push(
              `Embedding returned vector of length ${result.vector.length}`,
            );
            if (result.vector.length === 384) {
              details.push("Vector dimension is 384 (correct)");
              score += 4;
            } else {
              details.push(`Expected 384, got ${result.vector.length}`);
              score += 1;
            }
          } else {
            details.push("embed() did not return a vector");
          }

          if (result.mode === "tfidf") {
            details.push("Mode is tfidf");
            score += 2;
          }

          if (result.dimension === 384) {
            details.push("Reported dimension is 384");
            score += 1;
          }

          if (typeof result.latencyMs === "number" && result.latencyMs >= 0) {
            details.push(`Latency: ${result.latencyMs.toFixed(2)}ms`);
            score += 1;
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
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.9.2: Verify normalization (L2 norm ~1) ────────
  await harness.runTest(
    "2.9.2",
    "Embedder — L2 normalization (norm close to 1)",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
          });

          // Add some corpus data for better embeddings
          embedder.addToCorpus("React component architecture for scalable UIs");
          embedder.addToCorpus("PostgreSQL database optimization techniques");
          embedder.addToCorpus("Node.js server-side rendering with Express");

          const result = await embedder.embed(
            "A meaningful sentence about web development",
          );

          if (result && result.vector) {
            // Compute L2 norm
            let normSq = 0;
            for (const v of result.vector) {
              normSq += v * v;
            }
            const norm = Math.sqrt(normSq);

            details.push(`L2 norm = ${norm.toFixed(6)}`);

            if (Math.abs(norm - 1.0) < 0.01) {
              details.push("Norm is within 0.01 of 1.0 (well normalized)");
              score += 6;
            } else if (Math.abs(norm - 1.0) < 0.1) {
              details.push(
                "Norm is within 0.1 of 1.0 (approximately normalized)",
              );
              score += 4;
            } else if (norm > 0) {
              details.push("Vector has nonzero norm but not close to 1");
              score += 2;
            } else {
              details.push("Zero vector (all zeros)");
            }
          } else {
            details.push("No vector returned");
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
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.9.3: Verify caching (same text = same result) ─
  await harness.runTest(
    "2.9.3",
    "Embedder — Caching (same text returns cached result)",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
            enableCache: true,
          });

          const text = "Identical text for caching test";

          // First call: should not be cached
          const result1 = await embedder.embed(text);
          if (result1.cached === false) {
            details.push("First call: not cached");
            score += 2;
          } else {
            details.push(`First call: cached=${result1.cached}`);
            score += 1;
          }

          // Second call with same text: should be cached
          const result2 = await embedder.embed(text);
          if (result2.cached === true) {
            details.push("Second call: cached=true");
            score += 2;
          } else {
            details.push(`Second call: cached=${result2.cached}`);
            score += 1;
          }

          // Verify vectors are identical
          if (
            result1.vector &&
            result2.vector &&
            result1.vector.length === result2.vector.length
          ) {
            let same = true;
            for (let i = 0; i < result1.vector.length; i++) {
              if (result1.vector[i] !== result2.vector[i]) {
                same = false;
                break;
              }
            }
            if (same) {
              details.push("Cached vector is identical to original");
              score += 2;
            } else {
              details.push("Cached vector differs from original");
            }
          }

          // Check metrics
          const metrics = embedder.getMetrics();
          if (metrics && metrics.cacheHits >= 1) {
            details.push(`cacheHits = ${metrics.cacheHits}`);
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
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
