// -----------------------------------------------------------------
// AETHER RAG Index -- sqlite-vec + FTS5 Powered Vector Search
//
// Wraps the AetherStore (sqlite-vec + FTS5) with AETHER features:
//   - Multiple namespaces (agents, code, messages, docs)
//   - Automatic embedding via the Embedder engine
//   - Metadata filtering (by agent tier, section, timestamp)
//   - Batch operations for bulk indexing
//   - Hybrid retrieval: vector similarity + FTS5 BM25
//
// Durability is handled by SQLite — no dirty tracking or
// auto-save timers needed.  Every write is immediately persisted.
// -----------------------------------------------------------------

import { Embedder, type EmbeddingResult } from "./embedder.ts";
import type { SynapseLogger } from "./logger.ts";
import type { AetherStore, VectorResult } from "./storage/store.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/** Supported index namespaces */
export type IndexNamespace =
  | "agents" // Agent definitions and capabilities
  | "code" // Source code chunks
  | "messages" // Conversation history
  | "docs" // Documentation
  | "tasks" // Task history and results
  | "meta"; // Meta-index entries (index of indexes)

/** Metadata stored with each indexed item */
export interface RAGMetadata extends Record<string, unknown> {
  /** Source namespace */
  namespace: string;
  /** Original content text (for display) */
  text: string;
  /** Source identifier (agent ID, file path, message ID) */
  sourceId: string;
  /** Content type */
  contentType: string;
  /** Unix timestamp of creation */
  createdAt: number;
  /** Unix timestamp of last update */
  updatedAt: number;
  /** Relevance score boost (higher = more relevant) */
  boost: number;
}

/** Agent-specific metadata */
export interface AgentMetadata extends RAGMetadata {
  contentType: "agent";
  tier: string;
  section: string;
  capabilities: string;
}

/** Code-specific metadata */
export interface CodeMetadata extends RAGMetadata {
  contentType: "code";
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
}

/** Message metadata */
export interface MessageMetadata extends RAGMetadata {
  contentType: "message";
  sender: string;
  channel: string;
  priority: number;
}

export interface RAGIndexConfig {
  /** Default number of results to return (default: 5) */
  defaultTopK: number;
  /** Minimum similarity score to include (default: 0.1) */
  minScore: number;
  /** Whether to use BM25 for keyword search (default: true) */
  enableBM25: boolean;
}

const DEFAULT_CONFIG: RAGIndexConfig = {
  defaultTopK: 5,
  minScore: 0.1,
  enableBM25: true,
};

export interface RAGQueryOptions {
  /** Number of results */
  topK?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Metadata filter */
  filter?: Record<string, unknown>;
  /** Boost BM25 keyword matches */
  useBM25?: boolean;
  /** Specific namespace to search */
  namespace?: IndexNamespace;
}

export interface RAGQueryResult {
  /** Unique ID of the indexed item */
  id: string;
  /** Original text content */
  text: string;
  /** Similarity score (0-1) */
  score: number;
  /** Source namespace */
  namespace: IndexNamespace;
  /** Full metadata */
  metadata: RAGMetadata;
}

export interface RAGIndexMetrics {
  totalItems: number;
  itemsByNamespace: Record<IndexNamespace, number>;
  totalQueries: number;
  averageQueryMs: number;
  averageResultCount: number;
  cacheBenefit: number;
}

const ALL_NAMESPACES: IndexNamespace[] = [
  "agents",
  "code",
  "messages",
  "docs",
  "tasks",
  "meta",
];

// -----------------------------------------------------------------
// RAG Index
// -----------------------------------------------------------------

export class RAGIndex {
  private config: RAGIndexConfig;
  private logger: SynapseLogger;
  private embedder: Embedder;
  private store: AetherStore | null;
  private initialized = false;

  private metrics: RAGIndexMetrics = {
    totalItems: 0,
    itemsByNamespace: {
      agents: 0,
      code: 0,
      messages: 0,
      docs: 0,
      tasks: 0,
      meta: 0,
    },
    totalQueries: 0,
    averageQueryMs: 0,
    averageResultCount: 0,
    cacheBenefit: 0,
  };

  constructor(
    embedder: Embedder,
    logger: SynapseLogger,
    config?: Partial<RAGIndexConfig>,
    store?: AetherStore,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embedder = embedder;
    this.logger = logger;
    this.store = store ?? null;
  }

  // -- Lifecycle -------------------------------------------------

  /** Initialize the index — mark ready and load namespace stats */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.initialized = true;
    this.logger.info(
      "RAGIndex",
      `Initialized ${ALL_NAMESPACES.length} namespaces`,
    );

    // Load current counts from the store
    await this.refreshStats();
  }

  /** Shut down — nothing to flush; SQLite handles durability */
  async shutdown(): Promise<void> {
    this.initialized = false;
    this.logger.info("RAGIndex", "Shut down");
  }

  // -- Indexing ---------------------------------------------------

  /** Index a single item */
  async index(
    namespace: IndexNamespace,
    text: string,
    metadata: Partial<RAGMetadata> & { sourceId: string },
    id?: string,
  ): Promise<string> {
    this.ensureInitialized();

    // Add to TF-IDF corpus BEFORE embedding so IDF weights are
    // consistent between index-time and query-time vectors.
    this.embedder.addToCorpus(text);

    const embedding = await this.embedder.embed(text);

    const now = Date.now();
    const itemId =
      id ?? `${namespace}-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const fullMetadata: RAGMetadata = {
      ...metadata,
      namespace,
      text: text.slice(0, 2000), // Cap stored text to prevent bloat
      sourceId: metadata.sourceId,
      contentType: metadata.contentType ?? "text",
      createdAt: metadata.createdAt ?? now,
      updatedAt: now,
      boost: metadata.boost ?? 1.0,
    };

    if (this.store) {
      this.store.vectorUpsert(
        namespace,
        itemId,
        embedding.vector,
        fullMetadata as unknown as Record<string, unknown>,
        fullMetadata.text,
      );

      this.store.ftsUpsert(
        namespace,
        itemId,
        fullMetadata.text,
        fullMetadata.contentType,
      );
    }

    this.metrics.totalItems++;
    this.metrics.itemsByNamespace[namespace]++;

    return itemId;
  }

  /** Index multiple items in batch (much faster than individual calls) */
  async indexBatch(
    namespace: IndexNamespace,
    items: Array<{
      text: string;
      metadata: Partial<RAGMetadata> & { sourceId: string };
      id?: string;
    }>,
  ): Promise<string[]> {
    this.ensureInitialized();

    const texts = items.map((i) => i.text);

    // Add to corpus BEFORE embedding so IDF weights are consistent
    // between index-time and query-time vectors.
    this.embedder.addBatchToCorpus(texts);

    // Batch embed
    const embeddings = await this.embedder.embedBatch(texts);

    const now = Date.now();
    const ids: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemId =
        item.id ??
        `${namespace}-${now}-${i}-${Math.random().toString(36).slice(2, 8)}`;

      const fullMetadata: RAGMetadata = {
        ...item.metadata,
        namespace,
        text: item.text.slice(0, 2000),
        sourceId: item.metadata.sourceId,
        contentType: item.metadata.contentType ?? "text",
        createdAt: item.metadata.createdAt ?? now,
        updatedAt: now,
        boost: item.metadata.boost ?? 1.0,
      };

      if (this.store) {
        this.store.vectorUpsert(
          namespace,
          itemId,
          embeddings[i].vector,
          fullMetadata as unknown as Record<string, unknown>,
          fullMetadata.text,
        );

        this.store.ftsUpsert(
          namespace,
          itemId,
          fullMetadata.text,
          fullMetadata.contentType,
        );
      }

      ids.push(itemId);
    }

    this.metrics.totalItems += ids.length;
    this.metrics.itemsByNamespace[namespace] += ids.length;

    return ids;
  }

  // -- Querying ---------------------------------------------------

  /** Query the index with natural language */
  async query(
    text: string,
    options?: RAGQueryOptions,
  ): Promise<RAGQueryResult[]> {
    this.ensureInitialized();

    const topK = options?.topK ?? this.config.defaultTopK;
    const minScore = options?.minScore ?? this.config.minScore;
    const useBM25 = options?.useBM25 ?? this.config.enableBM25;
    const start = performance.now();

    // Embed the query
    const queryEmbedding = await this.embedder.embed(text);

    // Determine which namespaces to search
    const namespacesToSearch: IndexNamespace[] = options?.namespace
      ? [options.namespace]
      : ALL_NAMESPACES;

    // Accumulate results keyed by id for dedup + score merging
    const resultMap = new Map<
      string,
      { vectorScore: number; ftsScore: number; result: RAGQueryResult }
    >();

    if (this.store) {
      // -- Vector search across namespaces --------------------------
      for (const ns of namespacesToSearch) {
        try {
          const vectorHits: VectorResult[] = this.store.vectorQuery(
            ns,
            queryEmbedding.vector,
            topK,
            options?.filter,
          );

          for (const hit of vectorHits) {
            resultMap.set(hit.id, {
              vectorScore: hit.score,
              ftsScore: 0,
              result: {
                id: hit.id,
                text: hit.text,
                score: hit.score,
                namespace: ns,
                metadata: {
                  namespace: hit.namespace,
                  text: hit.text,
                  sourceId: hit.sourceId,
                  contentType: hit.contentType,
                  createdAt: (hit.metadata.createdAt as number) ?? 0,
                  updatedAt: (hit.metadata.updatedAt as number) ?? 0,
                  boost: (hit.metadata.boost as number) ?? 1.0,
                  ...hit.metadata,
                },
              },
            });
          }
        } catch {
          // Namespace might be empty — skip
        }
      }

      // -- FTS5 search (optional BM25 pass) -------------------------
      if (useBM25) {
        for (const ns of namespacesToSearch) {
          try {
            const ftsHits = this.store.ftsQuery(ns, text, topK);

            for (const ftsHit of ftsHits) {
              // Normalise FTS rank to a 0-1 score.
              // SQLite FTS5 rank is negative (lower = better).
              // We invert and clamp to [0, 1].
              const normalizedFtsScore = Math.min(
                1.0,
                Math.max(0, 1.0 / (1.0 + Math.abs(ftsHit.rank))),
              );

              const existing = resultMap.get(ftsHit.id);
              if (existing) {
                // Merge: record FTS score alongside the vector score
                existing.ftsScore = normalizedFtsScore;
              } else {
                // FTS-only hit (no vector match) — still include it
                resultMap.set(ftsHit.id, {
                  vectorScore: 0,
                  ftsScore: normalizedFtsScore,
                  result: {
                    id: ftsHit.id,
                    text: ftsHit.text,
                    score: normalizedFtsScore,
                    namespace: ns,
                    metadata: {
                      namespace: ns,
                      text: ftsHit.text,
                      sourceId: "",
                      contentType: "",
                      createdAt: 0,
                      updatedAt: 0,
                      boost: 1.0,
                    },
                  },
                });
              }
            }
          } catch {
            // FTS query may fail on empty table — skip
          }
        }
      }
    }

    // -- Merge scores & apply boost ---------------------------------
    let allResults: RAGQueryResult[] = [];

    for (const entry of resultMap.values()) {
      const combinedScore = useBM25
        ? entry.vectorScore * 0.7 + entry.ftsScore * 0.3
        : entry.vectorScore;

      const boost = (entry.result.metadata.boost as number) ?? 1.0;
      const finalScore = combinedScore * boost;

      if (finalScore < minScore) continue;

      allResults.push({
        ...entry.result,
        score: finalScore,
      });
    }

    // Sort by score descending and take top K
    allResults.sort((a, b) => b.score - a.score);
    allResults = allResults.slice(0, topK);

    // Update metrics
    const queryMs = performance.now() - start;
    this.metrics.totalQueries++;
    this.metrics.averageQueryMs =
      (this.metrics.averageQueryMs * (this.metrics.totalQueries - 1) +
        queryMs) /
      this.metrics.totalQueries;
    this.metrics.averageResultCount =
      (this.metrics.averageResultCount * (this.metrics.totalQueries - 1) +
        allResults.length) /
      this.metrics.totalQueries;

    return allResults;
  }

  /** Find similar items to an existing item */
  async findSimilar(
    namespace: IndexNamespace,
    itemId: string,
    topK: number = 5,
  ): Promise<RAGQueryResult[]> {
    this.ensureInitialized();

    // Retrieve the item so we can re-use its vector / text
    const existing = await this.get(namespace, itemId);
    if (!existing) return [];

    // Re-embed the stored text so we can query by vector
    const embedding = await this.embedder.embed(existing.text);

    if (!this.store) return [];

    const vectorHits = this.store.vectorQuery(
      namespace,
      embedding.vector,
      topK + 1, // +1 because the item itself will match
    );

    return vectorHits
      .filter((r) => r.id !== itemId)
      .slice(0, topK)
      .map((r) => ({
        id: r.id,
        text: r.text,
        score: r.score,
        namespace,
        metadata: {
          namespace: r.namespace,
          text: r.text,
          sourceId: r.sourceId,
          contentType: r.contentType,
          createdAt: (r.metadata.createdAt as number) ?? 0,
          updatedAt: (r.metadata.updatedAt as number) ?? 0,
          boost: (r.metadata.boost as number) ?? 1.0,
          ...r.metadata,
        },
      }));
  }

  // -- CRUD -------------------------------------------------------

  /** Get an item by ID */
  async get(
    namespace: IndexNamespace,
    id: string,
  ): Promise<RAGQueryResult | null> {
    this.ensureInitialized();

    if (!this.store) return null;

    // Use a vector query with topK=1 filtered by specific id
    // (AetherStore doesn't expose getItem directly; query for it)
    const hits = this.store.vectorQuery(namespace, [], 1, { id });
    if (hits.length === 0) return null;

    const hit = hits[0];
    return {
      id: hit.id,
      text: hit.text,
      score: 1.0,
      namespace,
      metadata: {
        namespace: hit.namespace,
        text: hit.text,
        sourceId: hit.sourceId,
        contentType: hit.contentType,
        createdAt: (hit.metadata.createdAt as number) ?? 0,
        updatedAt: (hit.metadata.updatedAt as number) ?? 0,
        boost: (hit.metadata.boost as number) ?? 1.0,
        ...hit.metadata,
      },
    };
  }

  /** Delete an item by ID */
  async delete(namespace: IndexNamespace, id: string): Promise<boolean> {
    this.ensureInitialized();

    if (!this.store) return false;

    try {
      this.store.vectorDelete(namespace, id);
      this.metrics.totalItems--;
      this.metrics.itemsByNamespace[namespace]--;
      return true;
    } catch {
      return false;
    }
  }

  /** List all items in a namespace */
  async list(
    namespace: IndexNamespace,
    filter?: Record<string, unknown>,
  ): Promise<RAGQueryResult[]> {
    this.ensureInitialized();

    if (!this.store) return [];

    // Retrieve all by querying with a zero vector and a large topK
    const hits = this.store.vectorQuery(namespace, [], 10_000, filter);

    return hits.map((hit) => ({
      id: hit.id,
      text: hit.text,
      score: 1.0,
      namespace,
      metadata: {
        namespace: hit.namespace,
        text: hit.text,
        sourceId: hit.sourceId,
        contentType: hit.contentType,
        createdAt: (hit.metadata.createdAt as number) ?? 0,
        updatedAt: (hit.metadata.updatedAt as number) ?? 0,
        boost: (hit.metadata.boost as number) ?? 1.0,
        ...hit.metadata,
      },
    }));
  }

  // -- Agent Indexing Helpers -------------------------------------

  /** Index an agent definition for capability search */
  async indexAgent(agent: {
    id: string;
    tier: string;
    sections: string[];
    capabilities: string[];
    description?: string;
  }): Promise<string> {
    const text = [
      `Agent: ${agent.id}`,
      `Tier: ${agent.tier}`,
      `Sections: ${agent.sections.join(", ")}`,
      `Capabilities: ${agent.capabilities.join(", ")}`,
      agent.description ?? "",
    ]
      .filter(Boolean)
      .join("\n");

    return this.index(
      "agents",
      text,
      {
        sourceId: agent.id,
        contentType: "agent",
        boost:
          (
            {
              sentinel: 2.0,
              forge: 1.8,
              master: 1.5,
              manager: 1.2,
              worker: 1.0,
            } as Record<string, number>
          )[agent.tier] ?? 1.0,
      },
      agent.id,
    );
  }

  /** Index a code chunk for code search */
  async indexCode(
    filePath: string,
    code: string,
    language: string,
    startLine: number,
    endLine: number,
  ): Promise<string> {
    const text = `${filePath}:${startLine}-${endLine}\n${code}`;
    return this.index(
      "code",
      text,
      {
        sourceId: filePath,
        contentType: "code",
      },
      `code-${filePath}-${startLine}`,
    );
  }

  /** Index a message for conversation search */
  async indexMessage(
    messageId: string,
    content: string,
    sender: string,
    channel: string,
    priority: number = 3,
  ): Promise<string> {
    return this.index(
      "messages",
      content,
      {
        sourceId: messageId,
        contentType: "message",
        boost: priority >= 4 ? 1.3 : 1.0,
      },
      messageId,
    );
  }

  // -- Stats ------------------------------------------------------

  /** Refresh metrics from the store */
  private async refreshStats(): Promise<void> {
    if (!this.store) return;

    let total = 0;
    for (const ns of ALL_NAMESPACES) {
      try {
        const count = this.store.vectorCount(ns);
        this.metrics.itemsByNamespace[ns] = count;
        total += count;
      } catch {
        // Empty namespace — leave at zero
      }
    }
    this.metrics.totalItems = total;
  }

  // -- Utilities --------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("RAGIndex not initialized. Call initialize() first.");
    }
  }

  /** Get metrics */
  getMetrics(): RAGIndexMetrics {
    return { ...this.metrics };
  }

  /** Get underlying embedder */
  getEmbedder(): Embedder {
    return this.embedder;
  }
}
