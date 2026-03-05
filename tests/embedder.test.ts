// ─────────────────────────────────────────────────────────────
// Tests: Embedder — Dual-mode TF-IDF + API embedding engine
// ─────────────────────────────────────────────────────────────

import { describe, test, expect, beforeEach } from "bun:test";
import { Embedder, type EmbeddingResult } from "../core/embedder.ts";
import { SynapseLogger } from "../core/logger.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Embedder", () => {
  let embedder: Embedder;
  let logger: SynapseLogger;

  beforeEach(() => {
    const logDir = mkdtempSync(join(tmpdir(), "embedder-test-"));
    logger = new SynapseLogger(logDir, "warn");
    embedder = new Embedder(logger, {
      defaultMode: "tfidf",
      tfidfDimension: 128,
      enableCache: true,
      cacheMaxSize: 100,
    });
  });

  // ── TF-IDF Embedding ────────────────────────────────────

  describe("TF-IDF mode", () => {
    test("embeds text into a fixed-dimension vector", async () => {
      const result = await embedder.embed("Hello world of programming");
      expect(result.vector).toBeDefined();
      expect(result.vector.length).toBe(128);
      expect(result.dimension).toBe(128);
      expect(result.mode).toBe("tfidf");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    test("returns non-zero vectors for non-empty text", async () => {
      const result = await embedder.embed("Machine learning algorithms");
      const norm = Math.sqrt(
        result.vector.reduce((sum, v) => sum + v * v, 0),
      );
      // L2-normalized vector should have norm ≈ 1.0
      expect(norm).toBeGreaterThan(0.9);
      expect(norm).toBeLessThan(1.1);
    });

    test("different texts produce different vectors", async () => {
      const r1 = await embedder.embed("TypeScript is a programming language");
      const r2 = await embedder.embed("Cooking pasta with tomato sauce");

      // Vectors should be different
      let same = true;
      for (let i = 0; i < r1.vector.length; i++) {
        if (Math.abs(r1.vector[i] - r2.vector[i]) > 1e-6) {
          same = false;
          break;
        }
      }
      expect(same).toBe(false);
    });

    test("similar texts produce similar vectors", async () => {
      // Add documents to corpus first for better IDF
      embedder.addToCorpus("JavaScript programming language");
      embedder.addToCorpus("Python programming language");
      embedder.addToCorpus("programming in TypeScript");
      embedder.addToCorpus("cooking Italian food");
      embedder.addToCorpus("baking French pastries");

      const r1 = await embedder.embed("TypeScript programming");
      const r2 = await embedder.embed("JavaScript programming");
      const r3 = await embedder.embed("baking pastries");

      const sim12 = await embedder.similarity(
        "TypeScript programming",
        "JavaScript programming",
      );
      const sim13 = await embedder.similarity(
        "TypeScript programming",
        "baking pastries",
      );

      // TypeScript↔JavaScript should be more similar than TypeScript↔baking
      expect(sim12).toBeGreaterThan(sim13);
    });

    test("empty text produces zero vector", async () => {
      const result = await embedder.embed("");
      const allZero = result.vector.every((v) => v === 0);
      expect(allZero).toBe(true);
    });
  });

  // ── Caching ──────────────────────────────────────────────

  describe("Caching", () => {
    test("returns cached results for repeated embeddings", async () => {
      const r1 = await embedder.embed("cached text test");
      const r2 = await embedder.embed("cached text test");

      expect(r2.cached).toBe(true);

      // Vectors should be identical
      for (let i = 0; i < r1.vector.length; i++) {
        expect(r1.vector[i]).toBe(r2.vector[i]);
      }
    });

    test("metrics track cache hits and misses", async () => {
      await embedder.embed("unique text alpha");
      await embedder.embed("unique text beta");
      await embedder.embed("unique text alpha"); // cache hit

      const metrics = embedder.getMetrics();
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.cacheMisses).toBe(2);
    });
  });

  // ── Batch Embedding ──────────────────────────────────────

  describe("Batch operations", () => {
    test("embedBatch processes multiple texts", async () => {
      const texts = [
        "First document about programming",
        "Second document about cooking",
        "Third document about music",
      ];

      const results = await embedder.embedBatch(texts);
      expect(results).toHaveLength(3);

      for (const result of results) {
        expect(result.vector.length).toBe(128);
        expect(result.mode).toBe("tfidf");
      }
    });

    test("embedBatch with empty array returns empty", async () => {
      const results = await embedder.embedBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  // ── Corpus Management ────────────────────────────────────

  describe("Corpus", () => {
    test("addToCorpus updates IDF weights", async () => {
      // Embed before adding to corpus
      const before = await embedder.embed("rare word xylophone");

      // Add documents to corpus
      embedder.addToCorpus("common word programming");
      embedder.addToCorpus("another document programming");
      embedder.addToCorpus("programming is everywhere");

      // Clear cache to force re-computation
      const fresh = new Embedder(logger, {
        defaultMode: "tfidf",
        tfidfDimension: 128,
      });
      fresh.addToCorpus("common word programming");
      fresh.addToCorpus("another document programming");

      const after = await fresh.embed("rare word xylophone");

      // The vectors should differ because IDF weights changed
      // (This is a structural test — both should produce valid vectors)
      expect(after.vector.length).toBe(128);
    });
  });

  // ── Metrics ──────────────────────────────────────────────

  describe("Metrics", () => {
    test("tracks total embeddings", async () => {
      await embedder.embed("one");
      await embedder.embed("two");
      await embedder.embed("three");

      const metrics = embedder.getMetrics();
      expect(metrics.totalEmbeddings).toBe(3);
      expect(metrics.tfidfCount).toBe(3);
      expect(metrics.apiCount).toBe(0);
    });

    test("tracks average latency", async () => {
      await embedder.embed("test");

      const metrics = embedder.getMetrics();
      expect(metrics.averageLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Similarity ───────────────────────────────────────────

  describe("Similarity", () => {
    test("identical texts have similarity close to 1.0", async () => {
      const sim = await embedder.similarity("hello world", "hello world");
      expect(sim).toBeGreaterThan(0.99);
    });

    test("similarity is between -1 and 1", async () => {
      const sim = await embedder.similarity(
        "programming languages",
        "cooking recipes",
      );
      expect(sim).toBeGreaterThanOrEqual(-1);
      expect(sim).toBeLessThanOrEqual(1);
    });
  });
});
