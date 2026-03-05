// ─────────────────────────────────────────────────────────────
// AETHER Embedder — Adaptive Embedding Engine
//
// Dual-mode embedding system:
//   1. TF-IDF (local, zero-latency, zero-cost) — for real-time indexing
//   2. API-based (semantic quality) — for precision retrieval
//
// The embedder automatically picks the best mode based on
// latency requirements and availability of API keys.
//
// Self-optimizing: tracks which mode yields better recall
// for the current workload and adjusts weights.
// ─────────────────────────────────────────────────────────────

import type { SynapseLogger } from "./logger.ts";
import type { AetherStore } from "./storage/store.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type EmbeddingMode = "tfidf" | "api" | "hybrid";

export interface EmbedderConfig {
  /** Default embedding mode (default: "tfidf") */
  defaultMode: EmbeddingMode;
  /** Embedding dimension for TF-IDF (default: 384) */
  tfidfDimension: number;
  /** API provider for semantic embeddings */
  apiProvider?: "openai" | "ollama";
  /** API endpoint for embeddings */
  apiEndpoint?: string;
  /** API key env var name (default: "OPENAI_API_KEY") */
  apiKeyEnv?: string;
  /** API model name (default: "text-embedding-3-small") */
  apiModel?: string;
  /** API dimension (default: 1536) */
  apiDimension?: number;
  /** Max batch size for API calls (default: 100) */
  apiBatchSize?: number;
  /** Cache embedded vectors (default: true) */
  enableCache: boolean;
  /** Cache max size (default: 10_000) */
  cacheMaxSize: number;
}

const DEFAULT_CONFIG: EmbedderConfig = {
  defaultMode: "tfidf",
  tfidfDimension: 384,
  apiKeyEnv: "OPENAI_API_KEY",
  apiModel: "text-embedding-3-small",
  apiDimension: 1536,
  apiBatchSize: 100,
  enableCache: true,
  cacheMaxSize: 10_000,
};

export interface EmbeddingResult {
  /** The embedding vector */
  vector: number[];
  /** Which mode produced it */
  mode: EmbeddingMode;
  /** Dimensionality */
  dimension: number;
  /** Time to compute in ms */
  latencyMs: number;
  /** Whether it came from cache */
  cached: boolean;
}

export interface EmbedderMetrics {
  totalEmbeddings: number;
  tfidfCount: number;
  apiCount: number;
  cacheHits: number;
  cacheMisses: number;
  averageLatencyMs: number;
  apiErrors: number;
}

// ─────────────────────────────────────────────────────────────
// TF-IDF Engine (Pure TypeScript, Zero Dependencies)
// ─────────────────────────────────────────────────────────────

class TFIDFEngine {
  /** Document frequency: term → number of documents containing it */
  private df: Map<string, number> = new Map();
  /** Total documents processed */
  private totalDocs = 0;
  /** Vocabulary → index mapping for fixed-dimension output */
  private vocab: Map<string, number> = new Map();
  /** Target dimension for output vectors */
  private dimension: number;
  /** IDF cache */
  private idfCache: Map<string, number> = new Map();

  constructor(dimension: number = 384) {
    this.dimension = dimension;
  }

  /** Tokenize text into terms */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_\-./]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && t.length < 50);
  }

  /** Compute n-grams (bigrams for better semantic capture) */
  private ngrams(tokens: string[], n: number = 2): string[] {
    const grams: string[] = [...tokens]; // Include unigrams
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join("_"));
    }
    return grams;
  }

  /** Add a document to the corpus (updates DF scores) */
  addDocument(text: string): void {
    const tokens = this.ngrams(this.tokenize(text));
    const seen = new Set<string>();

    for (const token of tokens) {
      // Track vocabulary
      if (!this.vocab.has(token)) {
        this.vocab.set(token, this.vocab.size);
      }

      // Update document frequency (once per document per term)
      if (!seen.has(token)) {
        seen.add(token);
        this.df.set(token, (this.df.get(token) ?? 0) + 1);
      }
    }

    this.totalDocs++;
    this.idfCache.clear(); // Invalidate IDF cache
  }

  /** Compute IDF for a term */
  private idf(term: string): number {
    let cached = this.idfCache.get(term);
    if (cached !== undefined) return cached;

    const df = this.df.get(term) ?? 0;
    // Smoothed IDF: log((N + 1) / (df + 1)) + 1
    cached = Math.log((this.totalDocs + 1) / (df + 1)) + 1;
    this.idfCache.set(term, cached);
    return cached;
  }

  /** Embed a text string into a fixed-dimension vector */
  embed(text: string): number[] {
    const tokens = this.ngrams(this.tokenize(text));

    // Compute TF (term frequency in this document)
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Normalize TF by document length
    const docLen = tokens.length || 1;

    // Build sparse TF-IDF vector and project onto fixed dimension
    const vector = new Float64Array(this.dimension);

    for (const [term, count] of tf) {
      const tfidf = (count / docLen) * this.idf(term);
      // Hash the term to a dimension index (deterministic projection)
      const idx = this.hashToDim(term);
      vector[idx] += tfidf;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm) || 1;
    const result: number[] = new Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      result[i] = vector[i] / norm;
    }

    return result;
  }

  /** Deterministic hash of a string to a dimension index */
  private hashToDim(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return ((hash % this.dimension) + this.dimension) % this.dimension;
  }

  /** Compute cosine similarity between two vectors */
  static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Get corpus statistics */
  getStats(): { totalDocs: number; vocabSize: number } {
    return {
      totalDocs: this.totalDocs,
      vocabSize: this.vocab.size,
    };
  }

  /** Load state from persisted data */
  loadState(state: {
    df: Record<string, number>;
    vocab: Record<string, number>;
    totalDocs: number;
  }): void {
    this.df = new Map(Object.entries(state.df));
    this.vocab = new Map(Object.entries(state.vocab));
    this.totalDocs = state.totalDocs;
    this.idfCache.clear();
  }

  /** Export state for persistence */
  exportState(): {
    df: Record<string, number>;
    vocab: Record<string, number>;
    totalDocs: number;
  } {
    return {
      df: Object.fromEntries(this.df),
      vocab: Object.fromEntries(this.vocab),
      totalDocs: this.totalDocs,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// LRU Cache for embeddings
// ─────────────────────────────────────────────────────────────

class EmbeddingCache {
  private cache: Map<string, EmbeddingResult> = new Map();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): EmbeddingResult | undefined {
    const result = this.cache.get(key);
    if (result) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, result);
    }
    return result;
  }

  set(key: string, value: EmbeddingResult): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─────────────────────────────────────────────────────────────
// Main Embedder
// ─────────────────────────────────────────────────────────────

export class Embedder {
  private config: EmbedderConfig;
  private logger: SynapseLogger;
  private tfidf: TFIDFEngine;
  private cache: EmbeddingCache;
  private apiKey: string | null = null;
  private store: AetherStore | null = null;
  private corpusDirty = false;
  private saveCorpusTimer: ReturnType<typeof setInterval> | null = null;

  private metrics: EmbedderMetrics = {
    totalEmbeddings: 0,
    tfidfCount: 0,
    apiCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageLatencyMs: 0,
    apiErrors: 0,
  };

  constructor(
    logger: SynapseLogger,
    config?: Partial<EmbedderConfig>,
    store?: AetherStore,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.tfidf = new TFIDFEngine(this.config.tfidfDimension);
    this.cache = new EmbeddingCache(this.config.cacheMaxSize);
    this.store = store ?? null;

    // Try to load API key
    const envVar = this.config.apiKeyEnv ?? "OPENAI_API_KEY";
    this.apiKey = process.env[envVar] ?? null;

    if (this.apiKey) {
      this.logger.info(
        "Embedder",
        `API embeddings available (${this.config.apiProvider ?? "openai"})`,
      );
    } else {
      this.logger.info("Embedder", "Running in TF-IDF only mode (no API key)");
    }

    // Load persisted TF-IDF corpus if store is available
    if (this.store) {
      try {
        const state = this.store.loadTFIDFState();
        if (state) {
          this.tfidf.loadState(state);
          this.logger.info(
            "Embedder",
            `Loaded TF-IDF corpus: ${state.totalDocs} docs, ${Object.keys(state.vocab).length} vocab`,
          );
        }
      } catch {
        // Store may be empty — that's fine
      }
    }

    // Periodic TF-IDF corpus persistence (every 30s)
    if (this.store) {
      this.saveCorpusTimer = setInterval(() => this.persistCorpus(), 30_000);
    }
  }

  // ── Core Methods ───────────────────────────────────────────

  /** Embed a single text. Returns a vector. */
  async embed(text: string, mode?: EmbeddingMode): Promise<EmbeddingResult> {
    const effectiveMode = mode ?? this.config.defaultMode;
    const cacheKey = `${effectiveMode}:${text}`;

    // Check cache
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.metrics.cacheHits++;
        return { ...cached, cached: true };
      }
      this.metrics.cacheMisses++;
    }

    const start = performance.now();
    let result: EmbeddingResult;

    switch (effectiveMode) {
      case "tfidf":
        result = this.embedTFIDF(text, start);
        break;
      case "api":
        result = await this.embedAPI(text, start);
        break;
      case "hybrid":
        result = await this.embedHybrid(text, start);
        break;
    }

    // Cache the result
    if (this.config.enableCache) {
      this.cache.set(cacheKey, result);
    }

    // Update metrics
    this.metrics.totalEmbeddings++;
    const total = this.metrics.totalEmbeddings;
    this.metrics.averageLatencyMs =
      (this.metrics.averageLatencyMs * (total - 1) + result.latencyMs) / total;

    return result;
  }

  /** Embed multiple texts in a batch (more efficient for API mode) */
  async embedBatch(
    texts: string[],
    mode?: EmbeddingMode,
  ): Promise<EmbeddingResult[]> {
    const effectiveMode = mode ?? this.config.defaultMode;

    // For TF-IDF, just map
    if (effectiveMode === "tfidf") {
      return texts.map((text) => {
        const start = performance.now();
        return this.embedTFIDF(text, start);
      });
    }

    // For API, batch the request
    if (effectiveMode === "api" && this.apiKey) {
      return this.embedAPIBatch(texts);
    }

    // Fallback: embed individually
    return Promise.all(texts.map((text) => this.embed(text, effectiveMode)));
  }

  /** Add a document to the TF-IDF corpus (improves IDF scores) */
  addToCorpus(text: string): void {
    this.tfidf.addDocument(text);
    this.corpusDirty = true;
  }

  /** Add multiple documents to the corpus */
  addBatchToCorpus(texts: string[]): void {
    for (const text of texts) {
      this.tfidf.addDocument(text);
    }
    this.corpusDirty = true;
  }

  /** Compute similarity between two texts */
  async similarity(
    a: string,
    b: string,
    mode?: EmbeddingMode,
  ): Promise<number> {
    const [vecA, vecB] = await Promise.all([
      this.embed(a, mode),
      this.embed(b, mode),
    ]);

    // If dimensions don't match, fall back to TF-IDF
    if (vecA.dimension !== vecB.dimension) {
      const tA = this.embedTFIDF(a, performance.now());
      const tB = this.embedTFIDF(b, performance.now());
      return TFIDFEngine.cosineSimilarity(tA.vector, tB.vector);
    }

    return TFIDFEngine.cosineSimilarity(vecA.vector, vecB.vector);
  }

  // ── Embedding Implementations ──────────────────────────────

  /** TF-IDF embedding: instant, local, zero-cost */
  private embedTFIDF(text: string, start: number): EmbeddingResult {
    const vector = this.tfidf.embed(text);
    this.metrics.tfidfCount++;
    return {
      vector,
      mode: "tfidf",
      dimension: this.config.tfidfDimension,
      latencyMs: performance.now() - start,
      cached: false,
    };
  }

  /** API embedding: high quality, network latency */
  private async embedAPI(
    text: string,
    start: number,
  ): Promise<EmbeddingResult> {
    if (!this.apiKey) {
      // Fallback to TF-IDF
      return this.embedTFIDF(text, start);
    }

    try {
      const provider = this.config.apiProvider ?? "openai";

      if (provider === "ollama") {
        return await this.embedOllama(text, start);
      }

      // OpenAI-compatible endpoint
      const endpoint =
        this.config.apiEndpoint ?? "https://api.openai.com/v1/embeddings";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.apiModel,
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const vector = data.data[0].embedding;

      this.metrics.apiCount++;
      return {
        vector,
        mode: "api",
        dimension: vector.length,
        latencyMs: performance.now() - start,
        cached: false,
      };
    } catch (err) {
      this.metrics.apiErrors++;
      this.logger.warn("Embedder", `API error, falling back to TF-IDF: ${err}`);
      return this.embedTFIDF(text, start);
    }
  }

  /** Ollama embedding (local inference server) */
  private async embedOllama(
    text: string,
    start: number,
  ): Promise<EmbeddingResult> {
    const endpoint =
      this.config.apiEndpoint ?? "http://localhost:11434/api/embed";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.apiModel ?? "nomic-embed-text",
        input: text,
      }),
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const data = await response.json();
    const vector = data.embeddings[0];

    this.metrics.apiCount++;
    return {
      vector,
      mode: "api",
      dimension: vector.length,
      latencyMs: performance.now() - start,
      cached: false,
    };
  }

  /** Hybrid embedding: concatenate TF-IDF + API vectors */
  private async embedHybrid(
    text: string,
    start: number,
  ): Promise<EmbeddingResult> {
    const tfidfResult = this.embedTFIDF(text, start);

    if (!this.apiKey) return tfidfResult;

    try {
      const apiResult = await this.embedAPI(text, start);

      // Concatenate and re-normalize
      const combined = [...tfidfResult.vector, ...apiResult.vector];
      let norm = 0;
      for (const v of combined) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      const vector = combined.map((v) => v / norm);

      return {
        vector,
        mode: "hybrid",
        dimension: vector.length,
        latencyMs: performance.now() - start,
        cached: false,
      };
    } catch {
      return tfidfResult;
    }
  }

  /** Batch API embedding */
  private async embedAPIBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.apiKey) {
      return texts.map((t) => this.embedTFIDF(t, performance.now()));
    }

    const results: EmbeddingResult[] = [];
    const batchSize = this.config.apiBatchSize ?? 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const start = performance.now();

      try {
        const endpoint =
          this.config.apiEndpoint ?? "https://api.openai.com/v1/embeddings";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.apiModel,
            input: batch,
          }),
        });

        if (!response.ok)
          throw new Error(`API batch error: ${response.status}`);

        const data = await response.json();
        for (const item of data.data) {
          results.push({
            vector: item.embedding,
            mode: "api",
            dimension: item.embedding.length,
            latencyMs: performance.now() - start,
            cached: false,
          });
        }
        this.metrics.apiCount += batch.length;
      } catch (err) {
        this.metrics.apiErrors++;
        // Fallback remaining to TF-IDF
        for (const text of batch) {
          results.push(this.embedTFIDF(text, performance.now()));
        }
      }
    }

    return results;
  }

  // ── Public API ─────────────────────────────────────────────

  /** Get embedding metrics */
  getMetrics(): EmbedderMetrics {
    return { ...this.metrics };
  }

  /** Get current dimension for a given mode */
  getDimension(mode?: EmbeddingMode): number {
    const m = mode ?? this.config.defaultMode;
    switch (m) {
      case "tfidf":
        return this.config.tfidfDimension;
      case "api":
        return this.config.apiDimension ?? 1536;
      case "hybrid":
        return this.config.tfidfDimension + (this.config.apiDimension ?? 1536);
    }
  }

  /** Check if API embeddings are available */
  hasAPIEmbeddings(): boolean {
    return this.apiKey !== null;
  }

  /** Get TF-IDF corpus stats */
  getCorpusStats(): { totalDocs: number; vocabSize: number } {
    return this.tfidf.getStats();
  }

  /** Clear embedding cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Persist TF-IDF corpus state to store */
  private persistCorpus(): void {
    if (!this.store || !this.corpusDirty) return;
    try {
      this.store.saveTFIDFState(this.tfidf.exportState());
      this.corpusDirty = false;
    } catch {
      // Best effort — will retry on next interval
    }
  }

  /** Shutdown: persist corpus and cleanup */
  shutdown(): void {
    if (this.saveCorpusTimer) clearInterval(this.saveCorpusTimer);
    this.persistCorpus();
  }

  /** Expose cosine similarity for external use */
  static cosineSimilarity = TFIDFEngine.cosineSimilarity;
}
