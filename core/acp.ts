// -----------------------------------------------------------------
// AETHER Agent Communication Protocol (ACP) Bus
//
// Typed message envelope on top of MemoryHighway with schema
// validation, request-response futures, acknowledgments,
// dead-letter queue, and communication graph tracking.
// -----------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { MemoryHighway, HighwayMessage } from "./memory-highway.ts";
import type { SynapseLogger } from "./logger.ts";
import type {
  ACPMessageType,
  ACPEnvelope,
  ACPTrace,
  ACPMeta,
  CommEdge,
  DeadLetter,
  OutputSchema,
} from "./types.ts";
import type { SchemaValidator } from "./schema.ts";

// -----------------------------------------------------------------
// Config
// -----------------------------------------------------------------

export interface ACPConfig {
  /** Default request timeout in ms (default: 30_000) */
  defaultRequestTimeoutMs: number;
  /** Max retries before dead-lettering (default: 3) */
  maxRetries: number;
  /** Enable communication graph tracking (default: true) */
  trackCommGraph: boolean;
  /** Enable acknowledgment tracking (default: true) */
  trackAcknowledgments: boolean;
  /** Max dead letters to retain (default: 100) */
  maxDeadLetters: number;
}

const DEFAULT_CONFIG: ACPConfig = {
  defaultRequestTimeoutMs: 30_000,
  maxRetries: 3,
  trackCommGraph: true,
  trackAcknowledgments: true,
  maxDeadLetters: 100,
};

// -----------------------------------------------------------------
// ACP Metrics
// -----------------------------------------------------------------

export interface ACPMetrics {
  totalSent: number;
  totalReceived: number;
  totalAcknowledged: number;
  totalDeadLettered: number;
  pendingRequests: number;
  commEdges: number;
}

// -----------------------------------------------------------------
// ACP Bus
// -----------------------------------------------------------------

/** Handler for incoming ACP messages */
export type ACPHandler = (envelope: ACPEnvelope) => void | Promise<void>;

export class ACPBus {
  private highway: MemoryHighway;
  private logger: SynapseLogger;
  private config: ACPConfig;
  private schemaValidator: SchemaValidator | null = null;

  /** Registered schemas for validation */
  private schemas: Map<string, OutputSchema> = new Map();

  /** Per-agent subscriptions */
  private agentHandlers: Map<string, Set<ACPHandler>> = new Map();

  /** Per-type subscriptions */
  private typeHandlers: Map<ACPMessageType, Set<ACPHandler>> = new Map();

  /** Pending request-response futures */
  private pendingRequests: Map<
    string,
    {
      resolve: (env: ACPEnvelope) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  /** Communication graph edges */
  private commEdges: Map<string, CommEdge> = new Map();

  /** Unacknowledged messages */
  private unacknowledged: Map<string, ACPEnvelope> = new Map();

  /** Dead letter queue */
  private deadLetters: DeadLetter[] = [];

  /** Highway unsubscribe handle */
  private unsubscribe: (() => void) | null = null;

  /** Metrics */
  private metrics: ACPMetrics = {
    totalSent: 0,
    totalReceived: 0,
    totalAcknowledged: 0,
    totalDeadLettered: 0,
    pendingRequests: 0,
    commEdges: 0,
  };

  constructor(
    highway: MemoryHighway,
    logger: SynapseLogger,
    config?: Partial<ACPConfig>,
  ) {
    this.highway = highway;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Optionally set a schema validator for content validation */
  setSchemaValidator(validator: SchemaValidator): void {
    this.schemaValidator = validator;
  }

  // ── Send API ────────────────────────────────────────────────

  /** Send a validated ACP message */
  async send(params: {
    sender: string;
    receiver: string;
    msgType: ACPMessageType;
    content: unknown;
    meta?: Partial<ACPMeta>;
    trace?: Partial<ACPTrace>;
    /** Optional pre-generated message ID (used by request-response) */
    msgId?: string;
  }): Promise<ACPEnvelope> {
    const msgId = params.msgId ?? randomUUID();
    const now = new Date().toISOString();

    const envelope: ACPEnvelope = {
      msgId,
      timestamp: now,
      sender: params.sender,
      receiver: params.receiver,
      msgType: params.msgType,
      content: params.content,
      meta: {
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        ...params.meta,
      },
      trace: {
        hopCount: 0,
        hops: [params.sender],
        policyTags: [],
        ...params.trace,
      },
      acknowledged: false,
    };

    // Validate against schema if schemaId is set
    if (envelope.meta.schemaId && this.schemas.has(envelope.meta.schemaId)) {
      const validation = this.validate(envelope);
      if (!validation.valid) {
        this.logger.warn(
          "ACPBus",
          `Schema validation failed for ${msgId}: ${validation.errors.join(", ")}`,
        );
      }
    }

    // Record communication edge
    if (this.config.trackCommGraph) {
      this.recordCommEdge(params.sender, params.receiver, params.msgType);
    }

    // Track for acknowledgment
    if (this.config.trackAcknowledgments) {
      this.unacknowledged.set(msgId, envelope);
    }

    // Publish via MemoryHighway
    try {
      const hwMsg = await this.highway.publish(
        `acp:${params.receiver}`,
        "event",
        envelope,
        {
          sender: params.sender,
          summary: `ACP ${params.msgType}: ${params.sender} → ${params.receiver}`,
          priority: 3,
          correlationId: params.trace?.taskId,
        },
      );
      envelope.highwayMsgId = hwMsg.id;
    } catch (err) {
      // Failed to publish — dead-letter if retries exhausted
      if (envelope.meta.retryCount >= envelope.meta.maxRetries) {
        this.addDeadLetter(
          envelope,
          err instanceof Error ? err.message : String(err),
        );
      }
      throw err;
    }

    this.metrics.totalSent++;

    return envelope;
  }

  /** Send and await a typed response (request-response pattern) */
  async request(
    params: {
      sender: string;
      receiver: string;
      msgType: ACPMessageType;
      content: unknown;
      meta?: Partial<ACPMeta>;
      trace?: Partial<ACPTrace>;
    },
    timeoutMs?: number,
  ): Promise<ACPEnvelope> {
    const timeout = timeoutMs ?? this.config.defaultRequestTimeoutMs;

    // Pre-generate message ID so we can register the pending request
    // BEFORE sending — avoids race condition when highway delivery is
    // synchronous and the response arrives before pendingRequests.set().
    const requestId = randomUUID();

    // Set expectsResponse in meta
    const meta: Partial<ACPMeta> = {
      ...params.meta,
      expectsResponse: "result" as ACPMessageType,
      responseTimeoutMs: timeout,
    };

    // Register the pending request FIRST so a synchronous response
    // from the highway subscriber is captured correctly.
    const responsePromise = new Promise<ACPEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.metrics.pendingRequests--;
        reject(
          new Error(`ACP request timeout after ${timeout}ms: ${requestId}`),
        );
      }, timeout);

      // Unref timer so it doesn't prevent process exit
      if (timer && typeof timer === "object" && "unref" in timer) {
        (timer as { unref: () => void }).unref();
      }

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.metrics.pendingRequests++;
    });

    // Now send the request — any synchronous response will find the
    // pending entry already in place.
    await this.send({ ...params, meta, msgId: requestId });

    return responsePromise;
  }

  /** Acknowledge receipt of a message */
  async acknowledge(msgId: string, agentId: string): Promise<void> {
    const envelope = this.unacknowledged.get(msgId);
    if (envelope) {
      envelope.acknowledged = true;
      this.unacknowledged.delete(msgId);
      this.metrics.totalAcknowledged++;
    }

    // Send ack message
    await this.send({
      sender: agentId,
      receiver: envelope?.sender ?? "system",
      msgType: "ack",
      content: { acknowledgedMsgId: msgId },
      trace: envelope?.trace ? { ...envelope.trace } : undefined,
    });
  }

  // ── Subscribe API ───────────────────────────────────────────

  /** Subscribe an agent to messages targeted at it */
  subscribeAgent(agentId: string, handler: ACPHandler): () => void {
    let handlers = this.agentHandlers.get(agentId);
    if (!handlers) {
      handlers = new Set();
      this.agentHandlers.set(agentId, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) this.agentHandlers.delete(agentId);
    };
  }

  /** Subscribe to all messages of a specific type */
  subscribeByType(msgType: ACPMessageType, handler: ACPHandler): () => void {
    let handlers = this.typeHandlers.get(msgType);
    if (!handlers) {
      handlers = new Set();
      this.typeHandlers.set(msgType, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) this.typeHandlers.delete(msgType);
    };
  }

  // ── Schema Validation ───────────────────────────────────────

  /** Register a schema for content validation */
  registerSchema(schemaId: string, schema: OutputSchema): void {
    this.schemas.set(schemaId, schema);
  }

  /** Validate an envelope against its registered schema */
  validate(envelope: ACPEnvelope): { valid: boolean; errors: string[] } {
    const schemaId = envelope.meta.schemaId;
    if (!schemaId) {
      return { valid: true, errors: [] };
    }

    const schema = this.schemas.get(schemaId);
    if (!schema) {
      return {
        valid: false,
        errors: [`Schema not found: ${schemaId}`],
      };
    }

    // Use SchemaValidator if available
    if (this.schemaValidator) {
      const contentStr =
        typeof envelope.content === "string"
          ? envelope.content
          : JSON.stringify(envelope.content);
      return this.schemaValidator.validate(contentStr, schema);
    }

    // Basic validation fallback
    if (schema.type === "object" && typeof envelope.content !== "object") {
      return {
        valid: false,
        errors: ["Content is not an object"],
      };
    }

    return { valid: true, errors: [] };
  }

  // ── Dead Letter Queue ───────────────────────────────────────

  /** Get all dead letters */
  getDeadLetters(): DeadLetter[] {
    return [...this.deadLetters];
  }

  /** Retry a dead-lettered message */
  async retryDeadLetter(msgId: string): Promise<boolean> {
    const idx = this.deadLetters.findIndex((dl) => dl.envelope.msgId === msgId);
    if (idx === -1) return false;

    const deadLetter = this.deadLetters[idx];
    this.deadLetters.splice(idx, 1);

    try {
      deadLetter.envelope.meta.retryCount++;
      await this.send({
        sender: deadLetter.envelope.sender,
        receiver: deadLetter.envelope.receiver,
        msgType: deadLetter.envelope.msgType,
        content: deadLetter.envelope.content,
        meta: deadLetter.envelope.meta,
        trace: deadLetter.envelope.trace,
      });
      return true;
    } catch {
      // Re-add to dead letter queue
      this.addDeadLetter(deadLetter.envelope, "Retry failed");
      return false;
    }
  }

  // ── Communication Graph ─────────────────────────────────────

  /** Get the full communication graph */
  getCommGraph(): CommEdge[] {
    return [...this.commEdges.values()];
  }

  /** Get incoming and outgoing edges for an agent */
  getAgentEdges(agentId: string): {
    incoming: CommEdge[];
    outgoing: CommEdge[];
  } {
    const incoming: CommEdge[] = [];
    const outgoing: CommEdge[] = [];

    for (const edge of this.commEdges.values()) {
      if (edge.to === agentId) incoming.push({ ...edge });
      if (edge.from === agentId) outgoing.push({ ...edge });
    }

    return { incoming, outgoing };
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /** Start the ACP bus — subscribe to MemoryHighway wildcard */
  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.highway.subscribe("*", (msg: HighwayMessage) => {
      this.handleHighwayMessage(msg);
    });

    this.logger.debug("ACPBus", "Started — subscribed to MemoryHighway");
  }

  /** Stop the ACP bus */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Clean up pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("ACPBus stopped"));
    }
    this.pendingRequests.clear();
    this.metrics.pendingRequests = 0;

    this.logger.debug("ACPBus", "Stopped");
  }

  /** Get ACP bus metrics */
  getMetrics(): ACPMetrics {
    return {
      ...this.metrics,
      commEdges: this.commEdges.size,
    };
  }

  /** Get count of unacknowledged messages */
  getUnacknowledgedCount(): number {
    return this.unacknowledged.size;
  }

  // ── Private ─────────────────────────────────────────────────

  /** Handle incoming MemoryHighway message */
  private handleHighwayMessage(msg: HighwayMessage): void {
    // Only process ACP-channel messages
    if (typeof msg.channel !== "string" || !msg.channel.startsWith("acp:")) {
      return;
    }

    // Extract envelope from payload
    const envelope = msg.payload as ACPEnvelope;
    if (!envelope || !envelope.msgId || !envelope.msgType) {
      return;
    }

    this.metrics.totalReceived++;

    // Check if this is a response to a pending request
    if (
      envelope.trace?.parentMsgId &&
      this.pendingRequests.has(envelope.trace.parentMsgId)
    ) {
      const pending = this.pendingRequests.get(envelope.trace.parentMsgId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(envelope.trace.parentMsgId);
      this.metrics.pendingRequests--;
      pending.resolve(envelope);
      return;
    }

    // Deliver to agent-targeted handlers
    const targetAgent = msg.channel.slice(4); // strip "acp:"
    const agentHandlers = this.agentHandlers.get(targetAgent);
    if (agentHandlers) {
      for (const handler of agentHandlers) {
        try {
          const result = handler(envelope);
          if (result instanceof Promise) {
            result.catch((err) => {
              this.logger.warn(
                "ACPBus",
                `Agent handler error for ${targetAgent}: ${err}`,
              );
              this.addDeadLetter(
                envelope,
                err instanceof Error ? err.message : String(err),
              );
            });
          }
        } catch (err) {
          this.logger.warn(
            "ACPBus",
            `Agent handler error for ${targetAgent}: ${err}`,
          );
          this.addDeadLetter(
            envelope,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // Deliver to type-targeted handlers
    const typeHandlers = this.typeHandlers.get(envelope.msgType);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          const result = handler(envelope);
          if (result instanceof Promise) {
            result.catch(() => {});
          }
        } catch {
          // Best effort for type handlers
        }
      }
    }
  }

  /** Record a communication edge */
  private recordCommEdge(
    from: string,
    to: string,
    msgType: ACPMessageType,
  ): void {
    const key = `${from}->${to}:${msgType}`;
    const existing = this.commEdges.get(key);

    if (existing) {
      existing.count++;
      existing.lastAt = new Date().toISOString();
    } else {
      this.commEdges.set(key, {
        from,
        to,
        msgType,
        count: 1,
        lastAt: new Date().toISOString(),
      });
    }
  }

  /** Add a message to the dead-letter queue */
  private addDeadLetter(envelope: ACPEnvelope, reason: string): void {
    this.deadLetters.push({
      envelope,
      reason,
      failedAt: new Date().toISOString(),
      attempts: envelope.meta.retryCount + 1,
    });

    // Trim if over limit
    if (this.deadLetters.length > this.config.maxDeadLetters) {
      this.deadLetters = this.deadLetters.slice(-this.config.maxDeadLetters);
    }

    this.metrics.totalDeadLettered++;

    this.logger.warn(
      "ACPBus",
      `Dead-lettered message ${envelope.msgId}: ${reason}`,
    );
  }
}
