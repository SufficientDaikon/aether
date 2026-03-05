// ─────────────────────────────────────────────────────────────
// AETHER Store — Persistence Interface
//
// Defines the contract for all persistent storage operations.
// Every subsystem consumes this interface, decoupling business
// logic from the storage backend (SQLite, Postgres, etc.).
// ─────────────────────────────────────────────────────────────

import type {
  AgentDefinition,
  AgentStatus,
  AgentTier,
  RegistrySection,
  TaskResult,
  EscalationRecord,
  ConversationMessage,
  ConversationStatus,
  EntityType,
  Entity,
  EntityFact,
  WorkflowCheckpoint,
  FileOwnershipRule,
  ProgressEvent,
} from "../types.ts";
import type { HighwayMessage } from "../memory-highway.ts";
import type { INetNode, Wire } from "../interaction-net.ts";

// ─────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────

/** Result from a vector similarity query */
export interface VectorResult {
  id: string;
  score: number;
  namespace: string;
  sourceId: string;
  contentType: string;
  text: string;
  metadata: Record<string, unknown>;
}

/** Aggregate task metrics */
export interface TaskMetrics {
  totalTasks: number;
  successful: number;
  failed: number;
  escalated: number;
  totalTokens: number;
  totalDuration: number;
  averageLatency: number;
}

/** Aggregate message metrics */
export interface MessageMetrics {
  totalMessages: number;
  messagesByChannel: Record<string, number>;
  messagesByType: Record<string, number>;
  duplicatesBlocked: number;
}

/** TF-IDF corpus state for persistence */
export interface TFIDFState {
  df: Record<string, number>;
  vocab: Record<string, number>;
  totalDocs: number;
}

/** InteractionNet checkpoint */
export interface NetSnapshot {
  nodes: INetNode[];
  wires: Wire[];
}

// ─────────────────────────────────────────────────────────────
// Store Interface
// ─────────────────────────────────────────────────────────────

export interface AetherStore {
  // ── Lifecycle ──────────────────────────────────────────────

  /** Initialize the store (create tables, run migrations) */
  init(): Promise<void>;

  /** Close the store gracefully (flush WAL, release handles) */
  close(): Promise<void>;

  // ── Agents ─────────────────────────────────────────────────

  /** Persist an agent definition (insert or update) */
  saveAgent(agent: AgentDefinition): void;

  /** Get a single agent by ID */
  getAgent(id: string): AgentDefinition | null;

  /** Get all registered agents */
  getAllAgents(): AgentDefinition[];

  /** Update only the status field of an agent */
  updateAgentStatus(id: string, status: AgentStatus): void;

  /** Delete an agent from the store */
  deleteAgent(id: string): void;

  /** Find agents by registry section */
  findAgentsBySection(section: RegistrySection): AgentDefinition[];

  /** Find agents by capability substring match */
  findAgentsByCapability(capability: string): AgentDefinition[];

  /** Find agents by tier */
  findAgentsByTier(tier: AgentTier): AgentDefinition[];

  // ── Tasks ──────────────────────────────────────────────────

  /** Persist a task execution result */
  saveTaskResult(
    result: TaskResult,
    description?: string,
    requester?: string,
    priority?: number,
  ): void;

  /** Get a task result by request ID */
  getTaskResult(id: string): TaskResult | null;

  /** Get the N most recent task results */
  getRecentTasks(limit: number): TaskResult[];

  /** Get aggregate task metrics */
  getTaskMetrics(): TaskMetrics;

  // ── Escalation ─────────────────────────────────────────────

  /** Persist an escalation record for an agent */
  saveEscalationRecord(agentId: string, record: EscalationRecord): void;

  /** Get the escalation record for an agent */
  getEscalationRecord(agentId: string): EscalationRecord | null;

  /** Delete escalation record (circuit reset) */
  clearEscalationRecord(agentId: string): void;

  /** Get the master escalation counter */
  getMasterEscalationCount(): number;

  /** Increment the master escalation counter */
  incrementMasterEscalationCount(): void;

  // ── Messages (MemoryHighway) ───────────────────────────────

  /** Persist a highway message */
  saveMessage(msg: HighwayMessage): void;

  /** Get recent messages for a channel (or all if channel is "*") */
  getRecentMessages(channel: string, limit: number): HighwayMessage[];

  /** Get all messages with a given correlation ID */
  getMessagesByCorrelation(correlationId: string): HighwayMessage[];

  /** Check if a content hash already exists (dedup) */
  isMessageDuplicate(contentHash: string): boolean;

  /** Get aggregate message metrics */
  getMessageMetrics(): MessageMetrics;

  // ── KV Store ───────────────────────────────────────────────

  /** Set a key-value pair with optional TTL in milliseconds */
  kvSet(key: string, value: unknown, ttlMs?: number): void;

  /** Get a value by key (returns null if expired or missing) */
  kvGet(key: string): unknown | null;

  /** Delete a key */
  kvDelete(key: string): boolean;

  // ── Vectors (replaces Vectra) ──────────────────────────────

  /** Upsert a vector embedding with metadata */
  vectorUpsert(
    namespace: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
    text: string,
  ): void;

  /** Query vectors by similarity, returning top-K results */
  vectorQuery(
    namespace: string,
    queryVector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): VectorResult[];

  /** Delete a vector by ID */
  vectorDelete(namespace: string, id: string): void;

  /** Count vectors in a namespace */
  vectorCount(namespace: string): number;

  // ── Full-Text Search (FTS5) ────────────────────────────────

  /** Upsert an FTS entry alongside its vector */
  ftsUpsert(
    namespace: string,
    id: string,
    text: string,
    contentType: string,
  ): void;

  /** Full-text search within a namespace */
  ftsQuery(
    namespace: string,
    query: string,
    limit: number,
  ): Array<{
    id: string;
    text: string;
    rank: number;
  }>;

  // ── Embedder Corpus ────────────────────────────────────────

  /** Save the TF-IDF engine state */
  saveTFIDFState(state: TFIDFState): void;

  /** Load the TF-IDF engine state (null if never saved) */
  loadTFIDFState(): TFIDFState | null;

  // ── InteractionNet Snapshots ───────────────────────────────

  /** Save a checkpoint of the current interaction net state */
  saveNetSnapshot(nodes: INetNode[], wires: Wire[]): void;

  /** Load the last interaction net checkpoint */
  loadNetSnapshot(): NetSnapshot | null;

  /** Clear the saved snapshot */
  clearNetSnapshot(): void;

  // ── Metrics / Counters ─────────────────────────────────────

  /** Increment a named counter by delta (default 1) */
  incrementCounter(name: string, delta?: number): void;

  /** Get the current value of a counter */
  getCounter(name: string): number;

  /** Set a gauge to an absolute value */
  setGauge(name: string, value: number): void;

  /** Get the current value of a gauge */
  getGauge(name: string): number;

  // ── Maintenance ────────────────────────────────────────────

  /** Trim message history to keep only the last N messages */
  trimMessages(keepCount: number): number;

  /** Clean expired KV entries */
  cleanExpiredKV(): number;

  /** Get database file size in bytes */
  getDBSizeBytes(): number;

  // ── Conversations (V2) ────────────────────────────────────────

  /** Create a new conversation */
  createConversation(
    id: string,
    participants: string[],
    state?: Record<string, unknown>,
  ): void;

  /** Get a conversation by ID */
  getConversation(id: string): {
    id: string;
    participants: string[];
    state: Record<string, unknown>;
    status: ConversationStatus;
    createdAt: string;
    updatedAt: string;
  } | null;

  /** Update conversation status */
  updateConversationStatus(id: string, status: ConversationStatus): void;

  /** Update conversation state */
  updateConversationState(id: string, state: Record<string, unknown>): void;

  /** Add a message to a conversation */
  addConversationMessage(msg: ConversationMessage): void;

  /** Get messages for a conversation (ordered by creation time) */
  getConversationMessages(
    conversationId: string,
    limit?: number,
  ): ConversationMessage[];

  /** Get conversations by status */
  getConversationsByStatus(status: ConversationStatus): Array<{
    id: string;
    participants: string[];
    state: Record<string, unknown>;
    status: ConversationStatus;
    createdAt: string;
    updatedAt: string;
  }>;

  /** Trim messages in a conversation to keep last N */
  trimConversationMessages(conversationId: string, keepCount: number): number;

  // ── Entities (V2) ─────────────────────────────────────────────

  /** Save or update an entity */
  saveEntity(entity: Entity): void;

  /** Get an entity by ID */
  getEntity(id: string): Entity | null;

  /** Find entities by type */
  findEntitiesByType(type: EntityType): Entity[];

  /** Find entities by name (substring match) */
  findEntitiesByName(name: string): Entity[];

  /** Delete an entity and its facts */
  deleteEntity(id: string): void;

  /** Add a fact to an entity */
  addEntityFact(fact: EntityFact): void;

  /** Get all facts for an entity */
  getEntityFacts(entityId: string): EntityFact[];

  /** Get recent entity facts across all entities */
  getRecentEntityFacts(limit: number): EntityFact[];

  // ── Workflow Checkpoints (V2) ──────────────────────────────────

  /** Save a workflow checkpoint */
  saveCheckpoint(checkpoint: WorkflowCheckpoint): void;

  /** Get the latest checkpoint for a workflow */
  getLatestCheckpoint(workflowId: string): WorkflowCheckpoint | null;

  /** Get all checkpoints for a workflow */
  getCheckpoints(workflowId: string): WorkflowCheckpoint[];

  /** Delete all checkpoints for a workflow */
  deleteCheckpoints(workflowId: string): void;

  /** Get incomplete workflow IDs (have checkpoints but no completion) */
  getIncompleteWorkflowIds(): string[];

  // ── File Ownership (V2) ────────────────────────────────────────

  /** Save a file ownership rule */
  saveFileOwnership(rule: FileOwnershipRule): void;

  /** Get file ownership rules for an agent */
  getFileOwnershipByAgent(agentId: string): FileOwnershipRule[];

  /** Find agents that own a given file path */
  findOwners(filePath: string): FileOwnershipRule[];

  /** Delete file ownership rules for an agent */
  deleteFileOwnership(agentId: string): void;

  // ── Progress Events (V2) ───────────────────────────────────────

  /** Record a progress event */
  saveProgressEvent(event: ProgressEvent): void;

  /** Get progress events for a workflow */
  getProgressEvents(workflowId: string): ProgressEvent[];

  /** Get the latest progress event for a workflow */
  getLatestProgressEvent(workflowId: string): ProgressEvent | null;

  /** Delete progress events for a workflow */
  deleteProgressEvents(workflowId: string): void;

  // ── Agent Mtime Tracking (V3) ────────────────────────────────────

  /** Save an agent with file modification time */
  saveAgentWithMtime(agent: AgentDefinition, mtime: number): void;

  /** Get the stored mtime for an agent's file path */
  getAgentMtime(filePath: string): number | null;

  /** Get all agent file paths and their stored mtimes */
  getAllAgentFileMtimes(): Array<{ id: string; filePath: string; mtime: number }>;
}
