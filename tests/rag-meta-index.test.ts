// ─────────────────────────────────────────────────────────────
// Tests: RAGMetaIndex — Self-referential 3-tier cache
// ─────────────────────────────────────────────────────────────

import { describe, test, expect, beforeEach } from "bun:test";
import { RAGMetaIndex } from "../core/rag-meta-index.ts";
import { SynapseLogger } from "../core/logger.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Minimal RAGIndex mock ──────────────────────────────────
class MockRAGIndex {
  private items: Array<{ text: string; namespace: string }> = [];

  addMockItem(text: string, namespace: string) {
    this.items.push({ text, namespace });
  }

  async query(
    text: string,
    options?: { namespace?: string; topK?: number },
  ) {
    const topK = options?.topK ?? 5;
    const ns = options?.namespace;
    let matches = this.items.filter((item) =>
      item.text.toLowerCase().includes(text.toLowerCase().slice(0, 8)),
    );
    if (ns) matches = matches.filter((item) => item.namespace === ns);
    return matches.slice(0, topK).map((item, i) => ({
      id: `mock-${i}`,
      text: item.text,
      score: 0.9 - i * 0.1,
      namespace: item.namespace,
      metadata: { sourceId: `s${i}`, type: "doc", timestamp: Date.now() },
    }));
  }
}

describe("RAGMetaIndex", () => {
  let metaIndex: RAGMetaIndex;
  let logger: SynapseLogger;
  let mockRag: MockRAGIndex;

  beforeEach(() => {
    const logDir = mkdtempSync(join(tmpdir(), "meta-index-test-"));
    logger = new SynapseLogger(logDir, "warn");
    mockRag = new MockRAGIndex();
    mockRag.addMockItem("React component optimization guide", "code");
    mockRag.addMockItem("React hooks best practices", "code");
    mockRag.addMockItem("Agent deployment config", "agents");

    metaIndex = new RAGMetaIndex(mockRag as any, logger, {
      hotCacheSize: 10,
      hotCacheTTL: 60_000,
      cacheAfterHits: 1,
    });
  });

  // ── Core Query ───────────────────────────────────────────

  describe("Core query", () => {
    test("query returns results from RAGIndex", async () => {
      const { results, tier } = await metaIndex.query("React");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(tier).toBe("full");
    });

    test("smartQuery returns flat results array", async () => {
      const results = await metaIndex.smartQuery("React");
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("returns empty for unmatched queries", async () => {
      const { results } = await metaIndex.query("xyzzy-nonsense-12345");
      expect(results).toHaveLength(0);
    });
  });

  // ── Hot Cache Tier ───────────────────────────────────────

  describe("Hot cache", () => {
    test("second identical query serves from hot cache", async () => {
      const r1 = await metaIndex.query("React");
      expect(r1.tier).toBe("full");

      const r2 = await metaIndex.query("React");
      expect(r2.tier).toBe("hot");
      expect(r2.results.length).toBe(r1.results.length);
    });

    test("hot cache respects topK", async () => {
      await metaIndex.query("React", 10);
      const { results } = await metaIndex.query("React", 1);
      expect(results).toHaveLength(1);
    });

    test("clear() empties all caches", async () => {
      await metaIndex.query("React");
      metaIndex.clear();
      const { tier } = await metaIndex.query("React");
      expect(tier).toBe("full");
    });
  });

  // ── Bloom Filter Tier ────────────────────────────────────

  describe("Bloom filter", () => {
    test("bloom records seen queries for future routing", async () => {
      const fresh = new RAGMetaIndex(mockRag as any, logger, {
        hotCacheSize: 10,
        hotCacheTTL: 60_000,
        cacheAfterHits: 999, // High threshold prevents hot-cache
      });

      await fresh.query("React");
      await fresh.query("React");

      const metrics = fresh.getMetrics();
      expect(metrics.bloomHits).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Metrics ──────────────────────────────────────────────

  describe("Metrics", () => {
    test("getMetrics returns valid structure", () => {
      const metrics = metaIndex.getMetrics();
      expect(metrics).toHaveProperty("hotCacheSize");
      expect(metrics).toHaveProperty("hotCacheHits");
      expect(metrics).toHaveProperty("hotCacheMisses");
      expect(metrics).toHaveProperty("bloomHits");
      expect(metrics).toHaveProperty("bloomMisses");
      expect(metrics).toHaveProperty("totalQueries");
      expect(typeof metrics.hotCacheSize).toBe("number");
      expect(typeof metrics.totalQueries).toBe("number");
    });

    test("tracks total queries", async () => {
      await metaIndex.query("test1");
      await metaIndex.query("test2");
      const metrics = metaIndex.getMetrics();
      expect(metrics.totalQueries).toBe(2);
    });

    test("tracks hot cache hits", async () => {
      await metaIndex.query("React");
      await metaIndex.query("React");
      const metrics = metaIndex.getMetrics();
      expect(metrics.hotCacheHits).toBe(1);
      expect(metrics.hotCacheMisses).toBeGreaterThanOrEqual(1);
    });

    test("tracks hot cache size", async () => {
      await metaIndex.query("React");
      await metaIndex.query("Agent");
      const metrics = metaIndex.getMetrics();
      expect(metrics.hotCacheSize).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Cache Hit Rate ───────────────────────────────────────

  describe("Cache hit rate", () => {
    test("getCacheHitRate returns 0 initially", () => {
      expect(metaIndex.getCacheHitRate()).toBe(0);
    });

    test("getCacheHitRate increases with cache hits", async () => {
      await metaIndex.query("React");
      await metaIndex.query("React");
      const rate = metaIndex.getCacheHitRate();
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(1);
    });
  });
});
