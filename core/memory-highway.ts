// ─────────────────────────────────────────────────────────────
// AETHER Memory Highway — RAG-Integrated Message Bus
//
// Every message that flows through the system is automatically
// indexed for retrieval. This creates a "memory" layer where
// agents can recall past interactions, decisions, and context.
//
// Features:
//   - Pub/sub channels for agent communication
//   - Automatic RAG indexing of all messages
//   - Deduplication via content hashing
//   - Priority-based message routing
//   - Conversation threading (correlationId)
//   - Real-time search of message history
//   - KV store for fast state (persistent via AetherStore, or in-memory fallback)
// ─────────────────────────────────────────────────────────────

import type { SynapseLogger } from "./logger.ts";
import type { RAGIndex } from "./rag-index.ts";
import type { RAGMetaIndex } from "./rag-meta-index.ts";
import type { RAGQueryResult } from "./rag-index.ts";
import type { AetherStore } from "./storage/store.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface HighwayMessage {
  /** Unique message ID */
  id: string;
  /** Channel name (e.g., "tasks", "results", "escalations") */
  channel: string;
  /** Sender agent ID */
  sender: string;
  /** Message type */
  type: "task" | "result" | "event" | "query" | "broadcast" | "escalation";
  /** Message payload */
  payload: unknown;
  /** Human-readable summary (for RAG indexing) */
  summary: string;
  /** Priority (0-5, higher = more important) */
  priority: number;
  /** Correlation ID for threading */
  correlationId?: string;
  /** Time to live in ms (auto-expire) */
  ttl?: number;
  /** Timestamp */
  timestamp: number;
}

export type MessageHandler = (message: HighwayMessage) => void | Promise<void>;

export interface HighwayConfig {
  /** Enable RAG indexing of messages (default: true) */
  enableRAG: boolean;
  /** Enable deduplication (default: true) */
  enableDedup: boolean;
  /** Dedup window in ms (default: 5_000) */
  dedupWindowMs: number;
  /** Max messages to retain in memory (default: 10_000) */
  maxRetainedMessages: number;
  /** KV store TTL for state entries in ms (default: 3_600_000 = 1 hour) */
  kvTTL: number;
  /** Index only messages above this priority (default: 1) */
  indexMinPriority: number;
}

const DEFAULT_CONFIG: HighwayConfig = {
  enableRAG: true,
  enableDedup: true,
  dedupWindowMs: 5_000,
  maxRetainedMessages: 10_000,
  kvTTL: 3_600_000,
  indexMinPriority: 1,
};

export interface HighwayMetrics {
  totalMessages: number;
  messagesByChannel: Record<string, number>;
  messagesByType: Record<string, number>;
  duplicatesBlocked: number;
  ragIndexed: number;
  totalSubscriptions: number;
  kvEntries: number;
  averageLatencyMs: number;
}

// ─────────────────────────────────────────────────────────────
// Memory Highway
// ─────────────────────────────────────────────────────────────

export class MemoryHighway {
  private config: HighwayConfig;
  private logger: SynapseLogger;
  private ragIndex: RAGIndex | null;
  private metaIndex: RAGMetaIndex | null;

  /** Channel → subscriber handlers */
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();

  /** Wildcard subscribers (receive ALL messages) */
  private wildcardSubs: Set<MessageHandler> = new Set();

  /** Persistent store (optional, for cross-session persistence) */
  private store: AetherStore | null;

  /** In-memory KV fallback when no store is configured */
  private kvMap: Map<string, unknown> = new Map();

  /** Recent message hashes for deduplication */
  private recentHashes: Map<string, number> = new Map();

  /** Message history ring buffer */
  private history: HighwayMessage[] = [];
  private historyIndex = 0;

  private idCounter = 0;

  private metrics: HighwayMetrics = {
    totalMessages: 0,
    messagesByChannel: {},
    messagesByType: {},
    duplicatesBlocked: 0,
    ragIndexed: 0,
    totalSubscriptions: 0,
    kvEntries: 0,
    averageLatencyMs: 0,
  };

  constructor(
    logger: SynapseLogger,
    ragIndex?: RAGIndex | null,
    metaIndex?: RAGMetaIndex | null,
    config?: Partial<HighwayConfig>,
    store?: AetherStore,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.ragIndex = ragIndex ?? null;
    this.metaIndex = metaIndex ?? null;
    this.store = store ?? null;

    // Periodic dedup hash cleanup
    setInterval(() => this.cleanDedupHashes(), this.config.dedupWindowMs * 2);
  }

  // ── Publishing ─────────────────────────────────────────────

  /** Publish a message to a channel */
  async publish(
    channel: string,
    type: HighwayMessage["type"],
    payload: unknown,
    options?: {
      summary?: string;
      sender?: string;
      priority?: number;
      correlationId?: string;
      ttl?: number;
    },
  ): Promise<HighwayMessage> {
    const start = performance.now();

    const message: HighwayMessage = {
      id: `msg-${++this.idCounter}-${Date.now().toString(36)}`,
      channel,
      sender: options?.sender ?? "system",
      type,
      payload,
      summary:
        options?.summary ??
        (typeof payload === "string"
          ? payload
          : JSON.stringify(payload).slice(0, 200)),
      priority: options?.priority ?? 3,
      correlationId: options?.correlationId,
      ttl: options?.ttl,
      timestamp: Date.now(),
    };

    // Compute content hash for dedup and store
    const hash = this.hashMessage(message);

    // Deduplication check
    if (this.config.enableDedup) {
      const isDuplicate = this.store
        ? this.store.isMessageDuplicate(hash)
        : this.recentHashes.has(hash);
      if (isDuplicate) {
        this.metrics.duplicatesBlocked++;
        return message; // Silently drop duplicate
      }
      this.recentHashes.set(hash, Date.now());
    }

    // Store in history
    this.addToHistory(message);

    // Persist to store if available
    this.store?.saveMessage(message);

    // RAG index the message
    if (
      this.config.enableRAG &&
      this.ragIndex &&
      message.priority >= this.config.indexMinPriority
    ) {
      try {
        await this.ragIndex.indexMessage(
          message.id,
          message.summary,
          message.sender,
          message.channel,
          message.priority,
        );
        this.metrics.ragIndexed++;

        // Invalidate meta-index cache for messages namespace
        if (this.metaIndex) {
          this.metaIndex.invalidateNamespace("messages");
        }
      } catch (err) {
        this.logger.warn("MemoryHighway", `RAG indexing failed: ${err}`);
      }
    }

    // Deliver to channel subscribers
    const channelSubs = this.subscriptions.get(channel);
    if (channelSubs) {
      const deliveries = Array.from(channelSubs).map((handler) =>
        this.safeDeliver(handler, message),
      );
      await Promise.allSettled(deliveries);
    }

    // Deliver to wildcard subscribers
    if (this.wildcardSubs.size > 0) {
      const deliveries = Array.from(this.wildcardSubs).map((handler) =>
        this.safeDeliver(handler, message),
      );
      await Promise.allSettled(deliveries);
    }

    // Update metrics
    this.metrics.totalMessages++;
    this.metrics.messagesByChannel[channel] =
      (this.metrics.messagesByChannel[channel] ?? 0) + 1;
    this.metrics.messagesByType[type] =
      (this.metrics.messagesByType[type] ?? 0) + 1;

    const latencyMs = performance.now() - start;
    this.metrics.averageLatencyMs =
      (this.metrics.averageLatencyMs * (this.metrics.totalMessages - 1) +
        latencyMs) /
      this.metrics.totalMessages;

    return message;
  }

  /** Broadcast a message to ALL channels */
  async broadcast(
    type: HighwayMessage["type"],
    payload: unknown,
    options?: { summary?: string; sender?: string; priority?: number },
  ): Promise<HighwayMessage> {
    return this.publish("*", type, payload, {
      ...options,
      priority: options?.priority ?? 4, // Broadcasts are high priority
    });
  }

  // ── Subscribing ────────────────────────────────────────────

  /** Subscribe to a channel. Returns an unsubscribe function. */
  subscribe(channel: string, handler: MessageHandler): () => void {
    if (channel === "*") {
      this.wildcardSubs.add(handler);
      this.metrics.totalSubscriptions++;
      return () => {
        this.wildcardSubs.delete(handler);
        this.metrics.totalSubscriptions--;
      };
    }

    let subs = this.subscriptions.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscriptions.set(channel, subs);
    }
    subs.add(handler);
    this.metrics.totalSubscriptions++;

    return () => {
      subs!.delete(handler);
      if (subs!.size === 0) this.subscriptions.delete(channel);
      this.metrics.totalSubscriptions--;
    };
  }

  /** Subscribe to a channel and receive only the first N messages */
  subscribeOnce(channel: string, handler: MessageHandler): () => void {
    const unsub = this.subscribe(channel, (msg) => {
      unsub();
      handler(msg);
    });
    return unsub;
  }

  // ── KV State Store ─────────────────────────────────────────

  /** Set a key-value pair in the state store */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    if (this.store) {
      this.store.kvSet(key, value, ttl);
    } else {
      this.kvMap.set(key, value);
    }
    this.metrics.kvEntries++;
  }

  /** Get a value from the state store */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (this.store) {
      return this.store.kvGet(key) as T | undefined;
    }
    return this.kvMap.get(key) as T | undefined;
  }

  /** Delete a key from the state store */
  async del(key: string): Promise<boolean> {
    if (this.store) {
      this.store.kvDelete(key);
      this.metrics.kvEntries--;
      return true;
    }
    const result = this.kvMap.delete(key);
    if (result) this.metrics.kvEntries--;
    return result;
  }

  /** Check if a key exists */
  async has(key: string): Promise<boolean> {
    const value = this.store ? this.store.kvGet(key) : this.kvMap.get(key);
    return value !== null && value !== undefined;
  }

  // ── Memory Search ──────────────────────────────────────────

  /** Search message history using RAG */
  async recall(query: string, topK: number = 5): Promise<RAGQueryResult[]> {
    if (this.metaIndex) {
      return this.metaIndex.smartQuery(query, topK);
    }
    if (this.ragIndex) {
      return this.ragIndex.query(query, { namespace: "messages", topK });
    }
    // Fallback: simple substring search on history
    return this.searchHistory(query, topK);
  }

  /** Get conversation thread by correlation ID */
  getThread(correlationId: string): HighwayMessage[] {
    if (this.store) {
      return this.store.getMessagesByCorrelation(correlationId);
    }
    return this.history.filter((m) => m.correlationId === correlationId);
  }

  /** Get recent messages for a channel */
  getRecent(channel: string, limit: number = 10): HighwayMessage[] {
    if (this.store) {
      return this.store.getRecentMessages(channel, limit);
    }
    const messages =
      channel === "*"
        ? this.history
        : this.history.filter((m) => m.channel === channel);
    return messages.slice(-limit);
  }

  // ── History Management ─────────────────────────────────────

  /** Add message to ring buffer history */
  private addToHistory(message: HighwayMessage): void {
    if (this.history.length >= this.config.maxRetainedMessages) {
      // Overwrite oldest
      this.history[this.historyIndex % this.config.maxRetainedMessages] =
        message;
    } else {
      this.history.push(message);
    }
    this.historyIndex++;
  }

  /** Simple substring search fallback */
  private searchHistory(query: string, topK: number): RAGQueryResult[] {
    const needle = query.toLowerCase();
    const results: RAGQueryResult[] = [];

    for (const msg of this.history) {
      const text = msg.summary.toLowerCase();
      if (text.includes(needle)) {
        results.push({
          id: msg.id,
          text: msg.summary,
          score: 0.5 + msg.priority * 0.1,
          namespace: "messages",
          metadata: {
            namespace: "messages",
            text: msg.summary,
            sourceId: msg.id,
            contentType: "message",
            createdAt: msg.timestamp,
            updatedAt: msg.timestamp,
            boost: 1.0,
          },
        });
      }
      if (results.length >= topK) break;
    }

    return results;
  }

  // ── Helpers ────────────────────────────────────────────────

  /** Safely deliver message to handler (catch errors) */
  private async safeDeliver(
    handler: MessageHandler,
    message: HighwayMessage,
  ): Promise<void> {
    try {
      await handler(message);
    } catch (err) {
      this.logger.error(
        "MemoryHighway",
        `Handler error on ${message.channel}: ${err}`,
      );
    }
  }

  /** Hash a message for deduplication */
  private hashMessage(message: HighwayMessage): string {
    // FNV-1a hash of channel + sender + summary
    const input = `${message.channel}:${message.sender}:${message.summary}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 16777619) | 0;
    }
    return hash.toString(36);
  }

  /** Clean expired dedup hashes */
  private cleanDedupHashes(): void {
    const cutoff = Date.now() - this.config.dedupWindowMs;
    for (const [hash, timestamp] of this.recentHashes) {
      if (timestamp < cutoff) {
        this.recentHashes.delete(hash);
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────

  /** Get highway metrics */
  getMetrics(): HighwayMetrics {
    return { ...this.metrics };
  }

  /** Get active channel names */
  getChannels(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /** Get message history length */
  get historyLength(): number {
    return this.history.length;
  }

  /** Clear all state */
  async clear(): Promise<void> {
    this.history = [];
    this.historyIndex = 0;
    this.recentHashes.clear();
    this.kvMap.clear();
    this.metrics.kvEntries = 0;
    this.logger.info("MemoryHighway", "Cleared all state");
  }
}
