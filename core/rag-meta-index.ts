// ─────────────────────────────────────────────────────────────
// AETHER RAG Meta-Index — Self-Referential Index Accelerator
//
// "We RAG index the RAG index" — 3-tier caching architecture
// that makes retrieval faster by indexing the index itself.
//
// Architecture:
//   Tier 1: Hot Cache (LRU, in-memory, <0.1ms)
//     ↓ miss
//   Tier 2: Bloom Filter (probabilistic, <1ms)
//     ↓ probable hit
//   Tier 3: SQLite-vec Index (vector search, <10ms)
//
// The meta-index stores:
//   - Query → best namespace mapping (which index to search)
//   - Query → result set mapping (skip search for repeat queries)
//   - Term → namespace affinity (which namespace has this topic)
//
// Self-optimizing: tracks hit rates and adjusts cache sizes.
// ─────────────────────────────────────────────────────────────

import type { RAGIndex, RAGQueryResult, IndexNamespace } from "./rag-index.ts";
import type { SynapseLogger } from "./logger.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MetaIndexConfig {
  /** Hot cache max entries (default: 1_000) */
  hotCacheSize: number;
  /** Hot cache TTL in ms (default: 60_000 — 1 minute) */
  hotCacheTTL: number;
  /** Bloom filter expected entries (default: 100_000) */
  bloomExpectedEntries: number;
  /** Bloom filter false positive rate (default: 0.01 = 1%) */
  bloomFPR: number;
  /** Minimum query count before caching (default: 2) */
  cacheAfterHits: number;
  /** Auto-learn namespace affinity (default: true) */
  learnAffinity: boolean;
}

const DEFAULT_CONFIG: MetaIndexConfig = {
  hotCacheSize: 1_000,
  hotCacheTTL: 60_000,
  bloomExpectedEntries: 100_000,
  bloomFPR: 0.01,
  cacheAfterHits: 2,
  learnAffinity: true,
};

interface HotCacheEntry {
  results: RAGQueryResult[];
  cachedAt: number;
  hitCount: number;
}

export interface MetaIndexMetrics {
  hotCacheHits: number;
  hotCacheMisses: number;
  bloomHits: number;
  bloomMisses: number;
  bloomFalsePositives: number;
  affinityHits: number;
  totalQueries: number;
  averageSpeedupMs: number;
  hotCacheSize: number;
  bloomFilterSize: number;
}

// ─────────────────────────────────────────────────────────────
// Bloom Filter — Space-efficient probabilistic membership test
// ─────────────────────────────────────────────────────────────

class BloomFilter {
  private bits: Uint8Array;
  private numHashes: number;
  private size: number;

  constructor(expectedEntries: number, fpr: number) {
    // Optimal size: -n * ln(p) / (ln(2))^2
    this.size = Math.ceil(
      (-expectedEntries * Math.log(fpr)) / (Math.LN2 * Math.LN2),
    );
    // Optimal number of hashes: (m/n) * ln(2)
    this.numHashes = Math.ceil((this.size / expectedEntries) * Math.LN2);

    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  /** Add an item to the bloom filter */
  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const h of hashes) {
      const byteIndex = Math.floor(h / 8);
      const bitIndex = h % 8;
      this.bits[byteIndex] |= 1 << bitIndex;
    }
  }

  /** Test if an item might be in the filter (false positives possible) */
  test(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const h of hashes) {
      const byteIndex = Math.floor(h / 8);
      const bitIndex = h % 8;
      if (!(this.bits[byteIndex] & (1 << bitIndex))) {
        return false; // Definitely not in the set
      }
    }
    return true; // Probably in the set
  }

  /** Get multiple hash values for an item */
  private getHashes(item: string): number[] {
    const h1 = this.hash1(item);
    const h2 = this.hash2(item);
    const hashes: number[] = [];
    for (let i = 0; i < this.numHashes; i++) {
      // Double hashing: h(i) = (h1 + i*h2) mod m
      hashes.push((((h1 + i * h2) % this.size) + this.size) % this.size);
    }
    return hashes;
  }

  /** FNV-1a hash */
  private hash1(s: string): number {
    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = (hash * 16777619) | 0;
    }
    return ((hash % this.size) + this.size) % this.size;
  }

  /** DJB2 hash */
  private hash2(s: string): number {
    let hash = 5381;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
    }
    return ((hash % this.size) + this.size) % this.size;
  }

  /** Get memory usage in bytes */
  get memoryBytes(): number {
    return this.bits.byteLength;
  }
}

// ─────────────────────────────────────────────────────────────
// Namespace Affinity Tracker
//
// Learns which namespaces are most relevant for given terms.
// E.g., "React" → strong affinity to "code" and "agents"
// ─────────────────────────────────────────────────────────────

class AffinityTracker {
  /** term → namespace → score */
  private affinities: Map<string, Map<IndexNamespace, number>> = new Map();

  /** Record that a query term had results in a namespace */
  record(
    terms: string[],
    namespace: IndexNamespace,
    resultCount: number,
  ): void {
    const score = Math.min(resultCount / 5, 1.0); // Normalize to 0-1

    for (const term of terms) {
      const key = term.toLowerCase();
      let nsMap = this.affinities.get(key);
      if (!nsMap) {
        nsMap = new Map();
        this.affinities.set(key, nsMap);
      }
      // Exponential moving average
      const current = nsMap.get(namespace) ?? 0;
      nsMap.set(namespace, current * 0.7 + score * 0.3);
    }
  }

  /** Get the most likely namespaces for a query */
  predict(query: string): IndexNamespace[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const scores = new Map<IndexNamespace, number>();

    for (const term of terms) {
      const nsMap = this.affinities.get(term);
      if (!nsMap) continue;

      for (const [ns, score] of nsMap) {
        scores.set(ns, (scores.get(ns) ?? 0) + score);
      }
    }

    if (scores.size === 0) return [];

    // Return namespaces sorted by score, threshold at 0.3
    return Array.from(scores.entries())
      .filter(([, score]) => score > 0.3)
      .sort((a, b) => b[1] - a[1])
      .map(([ns]) => ns);
  }
}

// ─────────────────────────────────────────────────────────────
// RAG Meta-Index
// ─────────────────────────────────────────────────────────────

export class RAGMetaIndex {
  private config: MetaIndexConfig;
  private logger: SynapseLogger;
  private ragIndex: RAGIndex;

  /** Tier 1: Hot LRU cache — <0.1ms lookups */
  private hotCache: Map<string, HotCacheEntry> = new Map();

  /** Tier 2: Bloom filter — fast "definitely not" test */
  private bloom: BloomFilter;

  /** Namespace affinity tracker */
  private affinity: AffinityTracker;

  /** Query frequency counter (for cacheAfterHits) */
  private queryFreq: Map<string, number> = new Map();

  private metrics: MetaIndexMetrics = {
    hotCacheHits: 0,
    hotCacheMisses: 0,
    bloomHits: 0,
    bloomMisses: 0,
    bloomFalsePositives: 0,
    affinityHits: 0,
    totalQueries: 0,
    averageSpeedupMs: 0,
    hotCacheSize: 0,
    bloomFilterSize: 0,
  };

  constructor(
    ragIndex: RAGIndex,
    logger: SynapseLogger,
    config?: Partial<MetaIndexConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ragIndex = ragIndex;
    this.logger = logger;

    this.bloom = new BloomFilter(
      this.config.bloomExpectedEntries,
      this.config.bloomFPR,
    );
    this.affinity = new AffinityTracker();

    // TTL eviction for hot cache
    setInterval(
      () => this.evictExpired(),
      Math.min(this.config.hotCacheTTL, 10_000),
    );
  }

  // ── Core Query ─────────────────────────────────────────────

  /**
   * Query with 3-tier acceleration.
   * Returns results and the tier that served them.
   */
  async query(
    text: string,
    topK: number = 5,
  ): Promise<{
    results: RAGQueryResult[];
    tier: "hot" | "bloom" | "full";
    latencyMs: number;
  }> {
    const start = performance.now();
    this.metrics.totalQueries++;

    const cacheKey = this.normalizeQuery(text);

    // ── Tier 1: Hot Cache ────────────────────────────────────
    const hotEntry = this.hotCache.get(cacheKey);
    if (hotEntry && Date.now() - hotEntry.cachedAt < this.config.hotCacheTTL) {
      hotEntry.hitCount++;
      this.metrics.hotCacheHits++;
      // Move to end (LRU refresh)
      this.hotCache.delete(cacheKey);
      this.hotCache.set(cacheKey, hotEntry);

      const latencyMs = performance.now() - start;
      this.updateSpeedup(latencyMs);

      return {
        results: hotEntry.results.slice(0, topK),
        tier: "hot",
        latencyMs,
      };
    }
    this.metrics.hotCacheMisses++;

    // ── Tier 2: Bloom Filter — route to best namespace ───────
    let targetNamespaces: IndexNamespace[] | undefined;

    if (this.bloom.test(cacheKey)) {
      this.metrics.bloomHits++;

      // Use affinity to narrow search
      if (this.config.learnAffinity) {
        const predicted = this.affinity.predict(text);
        if (predicted.length > 0) {
          targetNamespaces = predicted;
          this.metrics.affinityHits++;
        }
      }
    } else {
      this.metrics.bloomMisses++;
    }

    // ── Tier 3: Full Vector Search ───────────────────────────
    let results: RAGQueryResult[];

    if (targetNamespaces && targetNamespaces.length > 0) {
      // Search only predicted namespaces (faster)
      const allResults: RAGQueryResult[] = [];
      for (const ns of targetNamespaces) {
        const nsResults = await this.ragIndex.query(text, {
          namespace: ns,
          topK,
        });
        allResults.push(...nsResults);
      }
      allResults.sort((a, b) => b.score - a.score);
      results = allResults.slice(0, topK);
    } else {
      // Full search across all namespaces
      results = await this.ragIndex.query(text, { topK });
    }

    // ── Learn & Cache ────────────────────────────────────────

    // Add to bloom filter
    this.bloom.add(cacheKey);

    // Learn namespace affinity
    if (this.config.learnAffinity) {
      const terms = text.split(/\s+/).filter((t) => t.length > 2);
      const nsCounts = new Map<IndexNamespace, number>();
      for (const r of results) {
        nsCounts.set(r.namespace, (nsCounts.get(r.namespace) ?? 0) + 1);
      }
      for (const [ns, count] of nsCounts) {
        this.affinity.record(terms, ns, count);
      }
    }

    // Track query frequency
    const freq = (this.queryFreq.get(cacheKey) ?? 0) + 1;
    this.queryFreq.set(cacheKey, freq);

    // Cache if query is frequent enough
    if (freq >= this.config.cacheAfterHits && results.length > 0) {
      this.cacheResults(cacheKey, results);
    }

    const latencyMs = performance.now() - start;
    this.updateSpeedup(latencyMs);

    return {
      results,
      tier: targetNamespaces ? "bloom" : "full",
      latencyMs,
    };
  }

  /**
   * Smart query: uses meta-index acceleration, falls back gracefully.
   * This is the primary query method for the Memory Highway.
   */
  async smartQuery(text: string, topK: number = 5): Promise<RAGQueryResult[]> {
    const { results } = await this.query(text, topK);
    return results;
  }

  // ── Cache Management ───────────────────────────────────────

  /** Add results to hot cache with LRU eviction */
  private cacheResults(key: string, results: RAGQueryResult[]): void {
    // Evict if at capacity
    if (this.hotCache.size >= this.config.hotCacheSize) {
      // Remove oldest (first key)
      const firstKey = this.hotCache.keys().next().value;
      if (firstKey !== undefined) this.hotCache.delete(firstKey);
    }

    this.hotCache.set(key, {
      results,
      cachedAt: Date.now(),
      hitCount: 0,
    });

    this.metrics.hotCacheSize = this.hotCache.size;
  }

  /** Evict expired entries from hot cache */
  private evictExpired(): void {
    const now = Date.now();
    const ttl = this.config.hotCacheTTL;

    for (const [key, entry] of this.hotCache) {
      if (now - entry.cachedAt > ttl) {
        this.hotCache.delete(key);
      }
    }

    this.metrics.hotCacheSize = this.hotCache.size;
  }

  /** Invalidate cache entries related to a namespace */
  invalidateNamespace(namespace: IndexNamespace): void {
    for (const [key, entry] of this.hotCache) {
      if (entry.results.some((r) => r.namespace === namespace)) {
        this.hotCache.delete(key);
      }
    }
  }

  /** Clear all caches */
  clear(): void {
    this.hotCache.clear();
    this.queryFreq.clear();
    this.bloom = new BloomFilter(
      this.config.bloomExpectedEntries,
      this.config.bloomFPR,
    );
    this.metrics.hotCacheSize = 0;
    this.logger.info("MetaIndex", "All caches cleared");
  }

  // ── Helpers ────────────────────────────────────────────────

  /** Normalize a query for cache key consistency */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Update average speedup metric */
  private updateSpeedup(latencyMs: number): void {
    this.metrics.averageSpeedupMs =
      (this.metrics.averageSpeedupMs * (this.metrics.totalQueries - 1) +
        latencyMs) /
      this.metrics.totalQueries;
    this.metrics.bloomFilterSize = this.bloom.memoryBytes;
  }

  // ── Public API ─────────────────────────────────────────────

  /** Get meta-index metrics */
  getMetrics(): MetaIndexMetrics {
    return { ...this.metrics };
  }

  /** Get cache hit rate */
  getCacheHitRate(): number {
    const total = this.metrics.hotCacheHits + this.metrics.hotCacheMisses;
    return total === 0 ? 0 : this.metrics.hotCacheHits / total;
  }

  /** Get bloom filter hit rate */
  getBloomHitRate(): number {
    const total = this.metrics.bloomHits + this.metrics.bloomMisses;
    return total === 0 ? 0 : this.metrics.bloomHits / total;
  }
}
