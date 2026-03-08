// ─────────────────────────────────────────────────────────────
// AETHER SQLite Store — bun:sqlite + sqlite-vec Implementation
//
// Single-file database at .aether/aether.db.
// WAL mode for concurrent reads, prepared statements cached,
// all writes transactional.
// ─────────────────────────────────────────────────────────────

import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";
import { mkdirSync, statSync } from "node:fs";

import type {
  AetherStore,
  VectorResult,
  TaskMetrics,
  MessageMetrics,
  TFIDFState,
  NetSnapshot,
} from "./store.ts";
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
// Schema version — bump when schema changes
// ─────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 4;

// ─────────────────────────────────────────────────────────────
// Vector namespaces
// ─────────────────────────────────────────────────────────────

const VECTOR_NAMESPACES = [
  "agents",
  "code",
  "messages",
  "docs",
  "tasks",
  "meta",
] as const;

// ─────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────

export class SQLiteStore implements AetherStore {
  private db!: Database;
  private dbPath: string;
  private vectorDimension: number;

  constructor(aetherDir: string, vectorDimension: number = 384) {
    mkdirSync(aetherDir, { recursive: true });
    this.dbPath = join(aetherDir, "aether.db");
    this.vectorDimension = vectorDimension;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async init(): Promise<void> {
    this.db = new Database(this.dbPath);

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Performance pragmas
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA busy_timeout = 5000");

    // Run migrations
    this.migrate();
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        // Checkpoint WAL before closing
        this.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        // DB may already be closing
      }
      this.db.close();
      this.db = null as any;
    }
  }

  // ── Migration ──────────────────────────────────────────────

  private migrate(): void {
    const currentVersion = this.getSchemaVersion();
    if (currentVersion >= SCHEMA_VERSION) return;

    this.db.run("BEGIN TRANSACTION");
    try {
      if (currentVersion < 1) this.migrateV1();
      if (currentVersion < 2) this.migrateV2();
      if (currentVersion < 3) this.migrateV3();
      if (currentVersion < 4) this.migrateV4();

      this.db.run(
        "INSERT OR REPLACE INTO _migrations (version, applied_at) VALUES (?, datetime('now'))",
        [SCHEMA_VERSION],
      );
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db
        .query("SELECT MAX(version) as v FROM _migrations")
        .get() as { v: number } | null;
      return row?.v ?? 0;
    } catch {
      return 0;
    }
  }

  private migrateV1(): void {
    // Migrations table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Agents
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tier TEXT NOT NULL,
        sections TEXT NOT NULL DEFAULT '[]',
        capabilities TEXT NOT NULL DEFAULT '[]',
        dependencies TEXT NOT NULL DEFAULT '[]',
        llm_requirement TEXT NOT NULL DEFAULT 'haiku',
        format TEXT NOT NULL DEFAULT 'markdown',
        escalation_target TEXT,
        file_path TEXT NOT NULL DEFAULT '',
        transport TEXT,
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','active','busy','error','offline')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_agents_tier ON agents(tier)");
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)",
    );

    // Task results
    this.db.run(`
      CREATE TABLE IF NOT EXISTS task_results (
        request_id TEXT PRIMARY KEY,
        executor TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success','failure','partial','escalated')),
        output TEXT,
        duration INTEGER NOT NULL,
        tokens_used INTEGER DEFAULT 0,
        description TEXT,
        requester TEXT,
        priority INTEGER DEFAULT 3,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_tasks_created ON task_results(created_at)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_tasks_status ON task_results(status)",
    );

    // Escalation records
    this.db.run(`
      CREATE TABLE IF NOT EXISTS escalation_records (
        agent_id TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        last_escalation INTEGER NOT NULL DEFAULT 0,
        reasons TEXT NOT NULL DEFAULT '[]',
        master_gate_blocked INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Messages
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        sender TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT,
        summary TEXT NOT NULL,
        priority INTEGER DEFAULT 3,
        correlation_id TEXT,
        content_hash TEXT NOT NULL,
        ttl INTEGER,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages(correlation_id)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)",
    );
    this.db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_hash ON messages(content_hash)",
    );

    // KV store
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at)",
    );

    // Vector tables (one per namespace)
    for (const ns of VECTOR_NAMESPACES) {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_${ns} USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${this.vectorDimension}],
          +source_id TEXT,
          +content_type TEXT,
          +text_content TEXT,
          +metadata TEXT,
          +created_at TEXT
        )
      `);
    }

    // FTS5 tables (one per namespace)
    for (const ns of VECTOR_NAMESPACES) {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_${ns} USING fts5(
          id,
          text_content,
          content_type
        )
      `);
    }

    // TF-IDF state (singleton)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tfidf_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        df TEXT NOT NULL DEFAULT '{}',
        vocab TEXT NOT NULL DEFAULT '{}',
        total_docs INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // InteractionNet snapshot (singleton)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS net_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        nodes TEXT NOT NULL,
        wires TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Metrics / counters
    this.db.run(`
      CREATE TABLE IF NOT EXISTS metrics (
        name TEXT PRIMARY KEY,
        value REAL NOT NULL DEFAULT 0,
        type TEXT NOT NULL CHECK (type IN ('counter','gauge')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Master escalation counter (singleton)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS master_escalation (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        count INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.run(
      "INSERT OR IGNORE INTO master_escalation (id, count) VALUES (1, 0)",
    );
  }

  // ── Agents ─────────────────────────────────────────────────

  saveAgent(agent: AgentDefinition): void {
    this.db.run(
      `INSERT OR REPLACE INTO agents (id, name, tier, sections, capabilities, dependencies,
        llm_requirement, format, escalation_target, file_path, transport, status, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        agent.id,
        agent.name,
        agent.tier,
        JSON.stringify(agent.sections),
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.dependencies),
        agent.llmRequirement,
        agent.format,
        agent.escalationTarget,
        agent.filePath,
        agent.transport ? JSON.stringify(agent.transport) : null,
        agent.status,
        JSON.stringify(agent.metadata),
      ],
    );
  }

  getAgent(id: string): AgentDefinition | null {
    const row = this.db
      .query("SELECT * FROM agents WHERE id = ?")
      .get(id) as any;
    return row ? this.rowToAgent(row) : null;
  }

  getAllAgents(): AgentDefinition[] {
    const rows = this.db.query("SELECT * FROM agents").all() as any[];
    return rows.map((r) => this.rowToAgent(r));
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    this.db.run(
      "UPDATE agents SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [status, id],
    );
  }

  deleteAgent(id: string): void {
    this.db.run("DELETE FROM agents WHERE id = ?", [id]);
  }

  findAgentsBySection(section: RegistrySection): AgentDefinition[] {
    // JSON array LIKE check — sections is stored as JSON array e.g. '["FRONTEND","TOOLS"]'
    const rows = this.db
      .query("SELECT * FROM agents WHERE sections LIKE ?")
      .all(`%"${section}"%`) as any[];
    return rows.map((r) => this.rowToAgent(r));
  }

  findAgentsByCapability(capability: string): AgentDefinition[] {
    const needle = `%${capability.toLowerCase()}%`;
    const rows = this.db
      .query("SELECT * FROM agents WHERE LOWER(capabilities) LIKE ?")
      .all(needle) as any[];
    return rows.map((r) => this.rowToAgent(r));
  }

  findAgentsByTier(tier: AgentTier): AgentDefinition[] {
    const rows = this.db
      .query("SELECT * FROM agents WHERE tier = ?")
      .all(tier) as any[];
    return rows.map((r) => this.rowToAgent(r));
  }

  private rowToAgent(row: any): AgentDefinition {
    return {
      id: row.id,
      name: row.name,
      tier: row.tier,
      sections: JSON.parse(row.sections),
      capabilities: JSON.parse(row.capabilities),
      dependencies: JSON.parse(row.dependencies),
      llmRequirement: row.llm_requirement,
      format: row.format,
      escalationTarget: row.escalation_target,
      filePath: row.file_path,
      transport: row.transport ? JSON.parse(row.transport) : undefined,
      status: row.status,
      metadata: JSON.parse(row.metadata),
    };
  }

  // ── Tasks ──────────────────────────────────────────────────

  saveTaskResult(
    result: TaskResult,
    description?: string,
    requester?: string,
    priority?: number,
  ): void {
    this.db.run(
      `INSERT OR REPLACE INTO task_results
        (request_id, executor, status, output, duration, tokens_used, description, requester, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.requestId,
        result.executor,
        result.status,
        JSON.stringify(result.output),
        result.duration,
        result.tokensUsed ?? 0,
        description ?? null,
        requester ?? null,
        priority ?? 3,
      ],
    );
  }

  getTaskResult(id: string): TaskResult | null {
    const row = this.db
      .query("SELECT * FROM task_results WHERE request_id = ?")
      .get(id) as any;
    return row ? this.rowToTaskResult(row) : null;
  }

  getRecentTasks(limit: number): TaskResult[] {
    const rows = this.db
      .query("SELECT * FROM task_results ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => this.rowToTaskResult(r));
  }

  getTaskMetrics(): TaskMetrics {
    const row = this.db
      .query(
        `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) as escalated,
          COALESCE(SUM(tokens_used), 0) as total_tokens,
          COALESCE(SUM(duration), 0) as total_duration,
          COALESCE(AVG(duration), 0) as avg_latency
        FROM task_results
      `,
      )
      .get() as any;

    return {
      totalTasks: row.total ?? 0,
      successful: row.successful ?? 0,
      failed: row.failed ?? 0,
      escalated: row.escalated ?? 0,
      totalTokens: row.total_tokens ?? 0,
      totalDuration: row.total_duration ?? 0,
      averageLatency: row.avg_latency ?? 0,
    };
  }

  private rowToTaskResult(row: any): TaskResult {
    return {
      requestId: row.request_id,
      executor: row.executor,
      status: row.status,
      output: JSON.parse(row.output),
      duration: row.duration,
      tokensUsed: row.tokens_used || undefined,
    };
  }

  // ── Escalation ─────────────────────────────────────────────

  saveEscalationRecord(agentId: string, record: EscalationRecord): void {
    this.db.run(
      `INSERT OR REPLACE INTO escalation_records (agent_id, count, last_escalation, reasons)
       VALUES (?, ?, ?, ?)`,
      [
        agentId,
        record.count,
        record.lastEscalation,
        JSON.stringify(record.reasons),
      ],
    );
  }

  getEscalationRecord(agentId: string): EscalationRecord | null {
    const row = this.db
      .query("SELECT * FROM escalation_records WHERE agent_id = ?")
      .get(agentId) as any;
    if (!row) return null;
    return {
      agentId: row.agent_id,
      count: row.count,
      lastEscalation: row.last_escalation,
      reasons: JSON.parse(row.reasons),
    };
  }

  clearEscalationRecord(agentId: string): void {
    this.db.run("DELETE FROM escalation_records WHERE agent_id = ?", [agentId]);
  }

  getMasterEscalationCount(): number {
    const row = this.db
      .query("SELECT count FROM master_escalation WHERE id = 1")
      .get() as any;
    return row?.count ?? 0;
  }

  incrementMasterEscalationCount(): void {
    this.db.run("UPDATE master_escalation SET count = count + 1 WHERE id = 1");
  }

  // ── Messages ───────────────────────────────────────────────

  saveMessage(msg: HighwayMessage): void {
    const contentHash = this.hashContent(msg);
    this.db.run(
      `INSERT OR IGNORE INTO messages
        (id, channel, sender, type, payload, summary, priority, correlation_id, content_hash, ttl, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.channel,
        msg.sender,
        msg.type,
        JSON.stringify(msg.payload),
        msg.summary,
        msg.priority,
        msg.correlationId ?? null,
        contentHash,
        msg.ttl ?? null,
        msg.timestamp,
      ],
    );
  }

  getRecentMessages(channel: string, limit: number): HighwayMessage[] {
    const query =
      channel === "*"
        ? "SELECT * FROM messages ORDER BY created_at DESC LIMIT ?"
        : "SELECT * FROM messages WHERE channel = ? ORDER BY created_at DESC LIMIT ?";
    const params = channel === "*" ? [limit] : [channel, limit];
    const rows = this.db.query(query).all(...params) as any[];
    return rows.map((r) => this.rowToMessage(r)).reverse();
  }

  getMessagesByCorrelation(correlationId: string): HighwayMessage[] {
    const rows = this.db
      .query(
        "SELECT * FROM messages WHERE correlation_id = ? ORDER BY created_at ASC",
      )
      .all(correlationId) as any[];
    return rows.map((r) => this.rowToMessage(r));
  }

  isMessageDuplicate(contentHash: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM messages WHERE content_hash = ? LIMIT 1")
      .get(contentHash) as any;
    return row !== null;
  }

  getMessageMetrics(): MessageMetrics {
    const totalRow = this.db
      .query("SELECT COUNT(*) as c FROM messages")
      .get() as any;

    const channelRows = this.db
      .query("SELECT channel, COUNT(*) as c FROM messages GROUP BY channel")
      .all() as any[];
    const messagesByChannel: Record<string, number> = {};
    for (const r of channelRows) messagesByChannel[r.channel] = r.c;

    const typeRows = this.db
      .query("SELECT type, COUNT(*) as c FROM messages GROUP BY type")
      .all() as any[];
    const messagesByType: Record<string, number> = {};
    for (const r of typeRows) messagesByType[r.type] = r.c;

    return {
      totalMessages: totalRow?.c ?? 0,
      messagesByChannel,
      messagesByType,
      duplicatesBlocked: 0, // Tracked in-memory by MemoryHighway
    };
  }

  private rowToMessage(row: any): HighwayMessage {
    return {
      id: row.id,
      channel: row.channel,
      sender: row.sender,
      type: row.type,
      payload: JSON.parse(row.payload),
      summary: row.summary,
      priority: row.priority,
      correlationId: row.correlation_id ?? undefined,
      ttl: row.ttl ?? undefined,
      timestamp: row.created_at,
    };
  }

  private hashContent(msg: HighwayMessage): string {
    const input = `${msg.channel}:${msg.sender}:${msg.summary}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 16777619) | 0;
    }
    return hash.toString(36);
  }

  // ── KV Store ───────────────────────────────────────────────

  kvSet(key: string, value: unknown, ttlMs?: number): void {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.db.run(
      "INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)",
      [key, JSON.stringify(value), expiresAt],
    );
  }

  kvGet(key: string): unknown | null {
    const row = this.db
      .query("SELECT value, expires_at FROM kv_store WHERE key = ?")
      .get(key) as any;
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
      // Lazily clean expired entry
      this.db.run("DELETE FROM kv_store WHERE key = ?", [key]);
      return null;
    }
    return JSON.parse(row.value);
  }

  kvDelete(key: string): boolean {
    const result = this.db.run("DELETE FROM kv_store WHERE key = ?", [key]);
    return result.changes > 0;
  }

  // ── Vectors ────────────────────────────────────────────────

  vectorUpsert(
    namespace: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
    text: string,
  ): void {
    this.validateNamespace(namespace);
    const float32 = new Float32Array(vector);

    // Delete existing if present (upsert)
    this.db.run(`DELETE FROM vec_${namespace} WHERE id = ?`, [id]);

    this.db.run(
      `INSERT INTO vec_${namespace} (id, embedding, source_id, content_type, text_content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        id,
        float32 as any,
        (metadata.sourceId as string) ?? id,
        (metadata.contentType as string) ?? "text",
        text.slice(0, 2000),
        JSON.stringify(metadata),
      ],
    );
  }

  vectorQuery(
    namespace: string,
    queryVector: number[],
    topK: number,
    _filter?: Record<string, unknown>,
  ): VectorResult[] {
    this.validateNamespace(namespace);
    const float32 = new Float32Array(queryVector);

    const rows = this.db
      .query(
        `SELECT id, distance, source_id, content_type, text_content, metadata
         FROM vec_${namespace}
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(float32 as any, topK) as any[];

    return rows.map((r) => ({
      id: r.id,
      // sqlite-vec vec0 uses L2 (Euclidean) distance by default.
      // For L2-normalized vectors: L2² = 2·(1 − cos_sim),
      // so cos_sim = 1 − L2²/2.
      score: 1 - (r.distance * r.distance) / 2,
      namespace,
      sourceId: r.source_id,
      contentType: r.content_type,
      text: r.text_content,
      metadata: JSON.parse(r.metadata),
    }));
  }

  vectorDelete(namespace: string, id: string): void {
    this.validateNamespace(namespace);
    this.db.run(`DELETE FROM vec_${namespace} WHERE id = ?`, [id]);
  }

  vectorCount(namespace: string): number {
    this.validateNamespace(namespace);
    const row = this.db
      .query(`SELECT COUNT(*) as c FROM vec_${namespace}`)
      .get() as any;
    return row?.c ?? 0;
  }

  // ── FTS5 ───────────────────────────────────────────────────

  ftsUpsert(
    namespace: string,
    id: string,
    text: string,
    contentType: string,
  ): void {
    this.validateNamespace(namespace);
    // Delete existing entry if present, then insert
    this.db.run(`DELETE FROM fts_${namespace} WHERE id = ?`, [id]);
    this.db.run(
      `INSERT INTO fts_${namespace} (id, text_content, content_type) VALUES (?, ?, ?)`,
      [id, text, contentType],
    );
  }

  ftsQuery(
    namespace: string,
    query: string,
    limit: number,
  ): Array<{ id: string; text: string; rank: number }> {
    this.validateNamespace(namespace);
    // Sanitize FTS query: escape special chars
    const sanitized = query.replace(/['"*()]/g, " ").trim();
    if (!sanitized) return [];

    const rows = this.db
      .query(
        `SELECT id, text_content, rank
         FROM fts_${namespace}
         WHERE fts_${namespace} MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      text: r.text_content,
      rank: r.rank,
    }));
  }

  // ── TF-IDF State ───────────────────────────────────────────

  saveTFIDFState(state: TFIDFState): void {
    this.db.run(
      `INSERT OR REPLACE INTO tfidf_state (id, df, vocab, total_docs, updated_at)
       VALUES (1, ?, ?, ?, datetime('now'))`,
      [JSON.stringify(state.df), JSON.stringify(state.vocab), state.totalDocs],
    );
  }

  loadTFIDFState(): TFIDFState | null {
    const row = this.db
      .query("SELECT * FROM tfidf_state WHERE id = 1")
      .get() as any;
    if (!row) return null;
    return {
      df: JSON.parse(row.df),
      vocab: JSON.parse(row.vocab),
      totalDocs: row.total_docs,
    };
  }

  // ── InteractionNet Snapshots ───────────────────────────────

  saveNetSnapshot(nodes: INetNode[], wires: Wire[]): void {
    this.db.run(
      `INSERT OR REPLACE INTO net_snapshots (id, nodes, wires, created_at)
       VALUES (1, ?, ?, datetime('now'))`,
      [JSON.stringify(nodes), JSON.stringify(wires)],
    );
  }

  loadNetSnapshot(): NetSnapshot | null {
    const row = this.db
      .query("SELECT * FROM net_snapshots WHERE id = 1")
      .get() as any;
    if (!row) return null;
    return {
      nodes: JSON.parse(row.nodes),
      wires: JSON.parse(row.wires),
    };
  }

  clearNetSnapshot(): void {
    this.db.run("DELETE FROM net_snapshots WHERE id = 1");
  }

  // ── Metrics ────────────────────────────────────────────────

  incrementCounter(name: string, delta: number = 1): void {
    this.db.run(
      `INSERT INTO metrics (name, value, type, updated_at) VALUES (?, ?, 'counter', datetime('now'))
       ON CONFLICT(name) DO UPDATE SET value = value + ?, updated_at = datetime('now')`,
      [name, delta, delta],
    );
  }

  getCounter(name: string): number {
    const row = this.db
      .query("SELECT value FROM metrics WHERE name = ? AND type = 'counter'")
      .get(name) as any;
    return row?.value ?? 0;
  }

  setGauge(name: string, value: number): void {
    this.db.run(
      `INSERT INTO metrics (name, value, type, updated_at) VALUES (?, ?, 'gauge', datetime('now'))
       ON CONFLICT(name) DO UPDATE SET value = ?, updated_at = datetime('now')`,
      [name, value, value],
    );
  }

  getGauge(name: string): number {
    const row = this.db
      .query("SELECT value FROM metrics WHERE name = ? AND type = 'gauge'")
      .get(name) as any;
    return row?.value ?? 0;
  }

  // ── Maintenance ────────────────────────────────────────────

  trimMessages(keepCount: number): number {
    const result = this.db.run(
      `DELETE FROM messages WHERE created_at < (
        SELECT created_at FROM messages ORDER BY created_at DESC LIMIT 1 OFFSET ?
      )`,
      [keepCount],
    );
    return result.changes;
  }

  cleanExpiredKV(): number {
    const result = this.db.run(
      "DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at < ?",
      [Date.now()],
    );
    return result.changes;
  }

  getDBSizeBytes(): number {
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private validateNamespace(ns: string): void {
    if (!VECTOR_NAMESPACES.includes(ns as any)) {
      throw new Error(
        `Invalid vector namespace: ${ns}. Must be one of: ${VECTOR_NAMESPACES.join(", ")}`,
      );
    }
  }

  // ── V2 Migration ──────────────────────────────────────────────

  private migrateV2(): void {
    // Conversations
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        participants TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','aborted')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Conversation messages
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id)",
    );

    // Entity knowledge graph
    this.db.run(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('file','module','api','concept','person','config')),
        first_seen TEXT DEFAULT (datetime('now')),
        last_updated TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)",
    );

    // Entity facts
    this.db.run(`
      CREATE TABLE IF NOT EXISTS entity_facts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        fact TEXT NOT NULL,
        source_task TEXT,
        confidence REAL DEFAULT 1.0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_entity_facts_entity ON entity_facts(entity_id)",
    );

    // Workflow checkpoints (durable execution)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        state TEXT NOT NULL,
        conversation_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_checkpoints_workflow ON workflow_checkpoints(workflow_id)",
    );

    // File ownership rules
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_ownership (
        pattern TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        rule_type TEXT NOT NULL CHECK (rule_type IN ('owns','watches')),
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_ownership_agent ON file_ownership(agent_id)",
    );

    // Progress tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS progress_events (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        output_hash TEXT,
        tokens_used INTEGER DEFAULT 0,
        duration INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_progress_workflow ON progress_events(workflow_id)",
    );
  }

  // ── Conversations (V2) ────────────────────────────────────────

  createConversation(
    id: string,
    participants: string[],
    state?: Record<string, unknown>,
  ): void {
    this.db.run(
      `INSERT OR REPLACE INTO conversations (id, participants, state, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))`,
      [id, JSON.stringify(participants), JSON.stringify(state ?? {})],
    );
  }

  getConversation(id: string): {
    id: string;
    participants: string[];
    state: Record<string, unknown>;
    status: ConversationStatus;
    createdAt: string;
    updatedAt: string;
  } | null {
    const row = this.db
      .query("SELECT * FROM conversations WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      participants: JSON.parse(row.participants),
      state: JSON.parse(row.state),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateConversationStatus(id: string, status: ConversationStatus): void {
    this.db.run(
      "UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [status, id],
    );
  }

  updateConversationState(id: string, state: Record<string, unknown>): void {
    this.db.run(
      "UPDATE conversations SET state = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(state), id],
    );
  }

  addConversationMessage(msg: ConversationMessage): void {
    this.db.run(
      `INSERT OR REPLACE INTO conversation_messages
        (id, conversation_id, agent_id, role, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.conversationId,
        msg.agentId,
        msg.role,
        msg.content,
        JSON.stringify(msg.metadata),
        msg.createdAt,
      ],
    );
  }

  getConversationMessages(
    conversationId: string,
    limit?: number,
  ): ConversationMessage[] {
    const query = limit
      ? "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
      : "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC";
    const params = limit ? [conversationId, limit] : [conversationId];
    const rows = this.db.query(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      agentId: r.agent_id,
      role: r.role,
      content: r.content,
      metadata: JSON.parse(r.metadata),
      createdAt: r.created_at,
    }));
  }

  getConversationsByStatus(status: ConversationStatus): Array<{
    id: string;
    participants: string[];
    state: Record<string, unknown>;
    status: ConversationStatus;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.db
      .query(
        "SELECT * FROM conversations WHERE status = ? ORDER BY updated_at DESC",
      )
      .all(status) as any[];
    return rows.map((r) => ({
      id: r.id,
      participants: JSON.parse(r.participants),
      state: JSON.parse(r.state),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  trimConversationMessages(conversationId: string, keepCount: number): number {
    const result = this.db.run(
      `DELETE FROM conversation_messages WHERE conversation_id = ? AND created_at < (
        SELECT created_at FROM conversation_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC LIMIT 1 OFFSET ?
      )`,
      [conversationId, conversationId, keepCount],
    );
    return result.changes;
  }

  // ── Entities (V2) ─────────────────────────────────────────────

  saveEntity(entity: Entity): void {
    this.db.run(
      `INSERT OR REPLACE INTO entities (id, name, type, first_seen, last_updated)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.name,
        entity.type,
        entity.firstSeen,
        entity.lastUpdated,
      ],
    );
  }

  getEntity(id: string): Entity | null {
    const row = this.db
      .query("SELECT * FROM entities WHERE id = ?")
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      firstSeen: row.first_seen,
      lastUpdated: row.last_updated,
    };
  }

  findEntitiesByType(type: EntityType): Entity[] {
    const rows = this.db
      .query("SELECT * FROM entities WHERE type = ?")
      .all(type) as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      firstSeen: r.first_seen,
      lastUpdated: r.last_updated,
    }));
  }

  findEntitiesByName(name: string): Entity[] {
    const rows = this.db
      .query("SELECT * FROM entities WHERE name LIKE ?")
      .all(`%${name}%`) as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      firstSeen: r.first_seen,
      lastUpdated: r.last_updated,
    }));
  }

  deleteEntity(id: string): void {
    this.db.run("DELETE FROM entity_facts WHERE entity_id = ?", [id]);
    this.db.run("DELETE FROM entities WHERE id = ?", [id]);
  }

  addEntityFact(fact: EntityFact): void {
    this.db.run(
      `INSERT OR REPLACE INTO entity_facts (id, entity_id, fact, source_task, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        fact.id,
        fact.entityId,
        fact.fact,
        fact.sourceTask ?? null,
        fact.confidence,
        fact.createdAt,
      ],
    );
  }

  getEntityFacts(entityId: string): EntityFact[] {
    const rows = this.db
      .query(
        "SELECT * FROM entity_facts WHERE entity_id = ? ORDER BY created_at DESC",
      )
      .all(entityId) as any[];
    return rows.map((r) => ({
      id: r.id,
      entityId: r.entity_id,
      fact: r.fact,
      sourceTask: r.source_task ?? undefined,
      confidence: r.confidence,
      createdAt: r.created_at,
    }));
  }

  getRecentEntityFacts(limit: number): EntityFact[] {
    const rows = this.db
      .query("SELECT * FROM entity_facts ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      entityId: r.entity_id,
      fact: r.fact,
      sourceTask: r.source_task ?? undefined,
      confidence: r.confidence,
      createdAt: r.created_at,
    }));
  }

  // ── Workflow Checkpoints (V2) ──────────────────────────────────

  saveCheckpoint(checkpoint: WorkflowCheckpoint): void {
    this.db.run(
      `INSERT OR REPLACE INTO workflow_checkpoints (id, workflow_id, step_index, state, conversation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        checkpoint.id,
        checkpoint.workflowId,
        checkpoint.stepIndex,
        JSON.stringify(checkpoint.state),
        checkpoint.conversationId ?? null,
        checkpoint.createdAt,
      ],
    );
  }

  getLatestCheckpoint(workflowId: string): WorkflowCheckpoint | null {
    const row = this.db
      .query(
        "SELECT * FROM workflow_checkpoints WHERE workflow_id = ? ORDER BY step_index DESC LIMIT 1",
      )
      .get(workflowId) as any;
    if (!row) return null;
    return {
      id: row.id,
      workflowId: row.workflow_id,
      stepIndex: row.step_index,
      state: JSON.parse(row.state),
      conversationId: row.conversation_id ?? undefined,
      createdAt: row.created_at,
    };
  }

  getCheckpoints(workflowId: string): WorkflowCheckpoint[] {
    const rows = this.db
      .query(
        "SELECT * FROM workflow_checkpoints WHERE workflow_id = ? ORDER BY step_index ASC",
      )
      .all(workflowId) as any[];
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      stepIndex: r.step_index,
      state: JSON.parse(r.state),
      conversationId: r.conversation_id ?? undefined,
      createdAt: r.created_at,
    }));
  }

  deleteCheckpoints(workflowId: string): void {
    this.db.run("DELETE FROM workflow_checkpoints WHERE workflow_id = ?", [
      workflowId,
    ]);
  }

  getIncompleteWorkflowIds(): string[] {
    const rows = this.db
      .query(
        `SELECT DISTINCT workflow_id FROM workflow_checkpoints
         WHERE workflow_id NOT IN (
           SELECT workflow_id FROM workflow_checkpoints
           WHERE state LIKE '%"completed":true%'
         )
         ORDER BY created_at DESC`,
      )
      .all() as any[];
    return rows.map((r) => r.workflow_id);
  }

  // ── File Ownership (V2) ────────────────────────────────────────

  saveFileOwnership(rule: FileOwnershipRule): void {
    this.db.run(
      `INSERT OR REPLACE INTO file_ownership (pattern, agent_id, rule_type, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [rule.pattern, rule.agentId, rule.ruleType],
    );
  }

  getFileOwnershipByAgent(agentId: string): FileOwnershipRule[] {
    const rows = this.db
      .query("SELECT * FROM file_ownership WHERE agent_id = ?")
      .all(agentId) as any[];
    return rows.map((r) => ({
      pattern: r.pattern,
      agentId: r.agent_id,
      ruleType: r.rule_type,
    }));
  }

  findOwners(filePath: string): FileOwnershipRule[] {
    // Fetch all rules and match against the file path using glob-like matching
    const rows = this.db.query("SELECT * FROM file_ownership").all() as any[];
    return rows
      .filter((r) => this.matchGlob(r.pattern, filePath))
      .map((r) => ({
        pattern: r.pattern,
        agentId: r.agent_id,
        ruleType: r.rule_type,
      }));
  }

  deleteFileOwnership(agentId: string): void {
    this.db.run("DELETE FROM file_ownership WHERE agent_id = ?", [agentId]);
  }

  /** Simple glob pattern matcher for file ownership rules */
  private matchGlob(pattern: string, path: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, "{{DOUBLESTAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/\{\{DOUBLESTAR\}\}/g, ".*")
      .replace(/\?/g, "[^/]");
    return new RegExp(`^${regex}$`).test(path);
  }

  // ── Progress Events (V2) ───────────────────────────────────────

  saveProgressEvent(event: ProgressEvent): void {
    this.db.run(
      `INSERT OR REPLACE INTO progress_events
        (id, workflow_id, step_index, agent_id, output_hash, tokens_used, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.workflowId,
        event.stepIndex,
        event.agentId,
        event.outputHash ?? null,
        event.tokensUsed,
        event.duration,
        event.createdAt,
      ],
    );
  }

  getProgressEvents(workflowId: string): ProgressEvent[] {
    const rows = this.db
      .query(
        "SELECT * FROM progress_events WHERE workflow_id = ? ORDER BY step_index ASC",
      )
      .all(workflowId) as any[];
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      stepIndex: r.step_index,
      agentId: r.agent_id,
      outputHash: r.output_hash ?? undefined,
      tokensUsed: r.tokens_used,
      duration: r.duration,
      createdAt: r.created_at,
    }));
  }

  getLatestProgressEvent(workflowId: string): ProgressEvent | null {
    const row = this.db
      .query(
        "SELECT * FROM progress_events WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(workflowId) as any;
    if (!row) return null;
    return {
      id: row.id,
      workflowId: row.workflow_id,
      stepIndex: row.step_index,
      agentId: row.agent_id,
      outputHash: row.output_hash ?? undefined,
      tokensUsed: row.tokens_used,
      duration: row.duration,
      createdAt: row.created_at,
    };
  }

  deleteProgressEvents(workflowId: string): void {
    this.db.run("DELETE FROM progress_events WHERE workflow_id = ?", [
      workflowId,
    ]);
  }

  // ── V3 Migration ──────────────────────────────────────────────

  private migrateV3(): void {
    // Add file_mtime column to agents table for smart sync
    this.db.run(`ALTER TABLE agents ADD COLUMN file_mtime INTEGER DEFAULT 0`);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_agents_filepath ON agents(file_path)",
    );
  }

  private migrateV4(): void {
    // Remove the CHECK constraint on agents.tier to support extensible tiers.
    // SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we recreate the table.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents_v4 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tier TEXT NOT NULL,
        sections TEXT NOT NULL DEFAULT '[]',
        capabilities TEXT NOT NULL DEFAULT '[]',
        dependencies TEXT NOT NULL DEFAULT '[]',
        llm_requirement TEXT NOT NULL DEFAULT 'haiku',
        format TEXT NOT NULL DEFAULT 'markdown',
        escalation_target TEXT,
        file_path TEXT NOT NULL DEFAULT '',
        transport TEXT,
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','active','busy','error','offline')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        file_mtime INTEGER DEFAULT 0
      )
    `);
    this.db.run(`INSERT OR IGNORE INTO agents_v4 SELECT * FROM agents`);
    this.db.run(`DROP TABLE agents`);
    this.db.run(`ALTER TABLE agents_v4 RENAME TO agents`);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_agents_tier ON agents(tier)");
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_agents_filepath ON agents(file_path)",
    );
  }

  // ── Agent Mtime Tracking (V3) ────────────────────────────────────

  saveAgentWithMtime(agent: AgentDefinition, mtime: number): void {
    this.db.run(
      `INSERT OR REPLACE INTO agents (id, name, tier, sections, capabilities, dependencies,
        llm_requirement, format, escalation_target, file_path, transport, status, metadata, file_mtime, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        agent.id,
        agent.name,
        agent.tier,
        JSON.stringify(agent.sections),
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.dependencies),
        agent.llmRequirement,
        agent.format,
        agent.escalationTarget,
        agent.filePath,
        agent.transport ? JSON.stringify(agent.transport) : null,
        agent.status,
        JSON.stringify(agent.metadata),
        mtime,
      ],
    );
  }

  getAgentMtime(filePath: string): number | null {
    const row = this.db
      .query("SELECT file_mtime FROM agents WHERE file_path = ?")
      .get(filePath) as any;
    return row?.file_mtime ?? null;
  }

  getAllAgentFileMtimes(): Array<{
    id: string;
    filePath: string;
    mtime: number;
  }> {
    const rows = this.db
      .query(
        "SELECT id, file_path, file_mtime FROM agents WHERE file_path != ''",
      )
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      mtime: r.file_mtime ?? 0,
    }));
  }
}
