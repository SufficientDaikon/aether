// -----------------------------------------------------------------
// AETHER Structured Observability Logger
//
// JSON-structured logging with automatic context propagation,
// JSONL audit trail for ACP messages, LLM call instrumentation,
// scoped loggers, and log querying API.
// Wraps SynapseLogger — does NOT replace it.
// -----------------------------------------------------------------

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { SynapseLogger } from "./logger.ts";
import type {
  StructuredLogEntry,
  LLMCallRecord,
  LogQueryFilter,
  ACPEnvelope,
} from "./types.ts";

// -----------------------------------------------------------------
// Config
// -----------------------------------------------------------------

export interface StructuredLoggerConfig {
  /** Path for JSONL audit log file */
  auditLogPath: string;
  /** Path for JSONL structured log file */
  structuredLogPath: string;
  /** Max in-memory entries retained for querying (default: 5000) */
  maxRetainedEntries: number;
  /** Flush interval in ms (default: 2000) */
  flushIntervalMs: number;
  /** Also forward to SynapseLogger (default: true) */
  forwardToSynapse: boolean;
}

const DEFAULT_CONFIG: StructuredLoggerConfig = {
  auditLogPath: ".aether/logs/audit.jsonl",
  structuredLogPath: ".aether/logs/structured.jsonl",
  maxRetainedEntries: 5000,
  flushIntervalMs: 2000,
  forwardToSynapse: true,
};

// -----------------------------------------------------------------
// LLM Stats
// -----------------------------------------------------------------

export interface LLMStats {
  totalCalls: number;
  totalTokens: number;
  averageLatencyMs: number;
  errorRate: number;
  byProvider: Record<
    string,
    { calls: number; tokens: number; avgLatencyMs: number }
  >;
  byAgent: Record<string, { calls: number; tokens: number }>;
}

// -----------------------------------------------------------------
// Scoped Logger
// -----------------------------------------------------------------

export class ScopedLogger {
  private parent: StructuredLogger;
  private source: string;
  private fixedContext: StructuredLogEntry["context"];

  constructor(
    parent: StructuredLogger,
    source: string,
    context: StructuredLogEntry["context"],
  ) {
    this.parent = parent;
    this.source = source;
    this.fixedContext = context;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.parent.log({
      level: "debug",
      source: this.source,
      message,
      context: { ...this.fixedContext },
      data,
    });
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.parent.log({
      level: "info",
      source: this.source,
      message,
      context: { ...this.fixedContext },
      data,
    });
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.parent.log({
      level: "warn",
      source: this.source,
      message,
      context: { ...this.fixedContext },
      data,
    });
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.parent.log({
      level: "error",
      source: this.source,
      message,
      context: { ...this.fixedContext },
      data,
    });
  }

  /** Time an async function and log its duration */
  async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      this.parent.log({
        level: "info",
        source: this.source,
        message: label,
        context: { ...this.fixedContext },
        durationMs,
      });
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      this.parent.log({
        level: "error",
        source: this.source,
        message: label + " (failed)",
        context: { ...this.fixedContext },
        durationMs,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  /** Create a child scope with additional context */
  child(
    additionalContext: Partial<StructuredLogEntry["context"]>,
  ): ScopedLogger {
    return new ScopedLogger(this.parent, this.source, {
      ...this.fixedContext,
      ...additionalContext,
    });
  }
}

// -----------------------------------------------------------------
// Structured Logger
// -----------------------------------------------------------------

export class StructuredLogger {
  private synapseLogger: SynapseLogger;
  private config: StructuredLoggerConfig;

  /** In-memory ring buffer of structured entries */
  private entries: StructuredLogEntry[] = [];

  /** In-memory LLM call records */
  private llmCalls: LLMCallRecord[] = [];

  /** JSONL audit buffer (ACP messages) */
  private auditBuffer: string[] = [];

  /** JSONL structured log buffer */
  private structuredBuffer: string[] = [];

  /** Flush timer handle */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the logger has been closed */
  private closed = false;

  constructor(
    synapseLogger: SynapseLogger,
    config?: Partial<StructuredLoggerConfig>,
  ) {
    this.synapseLogger = synapseLogger;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure log directories exist
    this.ensureDir(this.config.structuredLogPath);
    this.ensureDir(this.config.auditLogPath);

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.config.flushIntervalMs);

    // Unref timer so it doesn't prevent process exit
    if (
      this.flushTimer &&
      typeof this.flushTimer === "object" &&
      "unref" in this.flushTimer
    ) {
      (this.flushTimer as { unref: () => void }).unref();
    }
  }

  // ── Structured Logging API ─────────────────────────────────

  /** Log a structured entry */
  log(entry: Omit<StructuredLogEntry, "timestamp">): void {
    if (this.closed) return;

    const fullEntry: StructuredLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      context: entry.context ?? {},
    };

    // Add to ring buffer
    this.entries.push(fullEntry);
    if (this.entries.length > this.config.maxRetainedEntries) {
      this.entries = this.entries.slice(-this.config.maxRetainedEntries);
    }

    // Serialize to JSONL buffer
    try {
      this.structuredBuffer.push(JSON.stringify(fullEntry));
    } catch {
      // Skip unserializable entries
    }

    // Forward to SynapseLogger
    if (this.config.forwardToSynapse) {
      const method = fullEntry.level as keyof Pick<
        SynapseLogger,
        "debug" | "info" | "warn" | "error"
      >;
      this.synapseLogger[method](
        fullEntry.source,
        fullEntry.message,
        fullEntry.data,
      );
    }
  }

  /** Convenience: debug */
  debug(
    source: string,
    message: string,
    context?: StructuredLogEntry["context"],
    data?: Record<string, unknown>,
  ): void {
    this.log({ level: "debug", source, message, context: context ?? {}, data });
  }

  /** Convenience: info */
  info(
    source: string,
    message: string,
    context?: StructuredLogEntry["context"],
    data?: Record<string, unknown>,
  ): void {
    this.log({ level: "info", source, message, context: context ?? {}, data });
  }

  /** Convenience: warn */
  warn(
    source: string,
    message: string,
    context?: StructuredLogEntry["context"],
    data?: Record<string, unknown>,
  ): void {
    this.log({ level: "warn", source, message, context: context ?? {}, data });
  }

  /** Convenience: error */
  error(
    source: string,
    message: string,
    context?: StructuredLogEntry["context"],
    data?: Record<string, unknown>,
  ): void {
    this.log({
      level: "error",
      source,
      message,
      context: context ?? {},
      data,
    });
  }

  // ── Scoped Logger Factory ──────────────────────────────────

  /** Create a scoped logger bound to a specific context */
  scoped(
    context: StructuredLogEntry["context"],
    source?: string,
  ): ScopedLogger {
    return new ScopedLogger(this, source ?? "scoped", context);
  }

  /** Create a scoped logger for a specific subsystem */
  forSubsystem(source: string): ScopedLogger {
    return new ScopedLogger(this, source, {});
  }

  // ── ACP Audit Trail ────────────────────────────────────────

  /** Append an ACP envelope to the JSONL audit log */
  auditACPMessage(envelope: ACPEnvelope): void {
    if (this.closed) return;

    try {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        type: "acp_message",
        msgId: envelope.msgId,
        sender: envelope.sender,
        receiver: envelope.receiver,
        msgType: envelope.msgType,
        trace: envelope.trace,
        meta: {
          schemaId: envelope.meta.schemaId,
          retryCount: envelope.meta.retryCount,
        },
      };
      this.auditBuffer.push(JSON.stringify(auditEntry));
    } catch {
      // Skip unserializable
    }
  }

  // ── LLM Call Instrumentation ───────────────────────────────

  /** Record an LLM call */
  recordLLMCall(record: Omit<LLMCallRecord, "timestamp">): void {
    const fullRecord: LLMCallRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    };
    this.llmCalls.push(fullRecord);

    // Also log as structured entry
    this.log({
      level: record.success ? "info" : "warn",
      source: "llm",
      message: `LLM call to ${record.provider}/${record.model}`,
      context: {
        agentId: record.agentId,
        taskId: record.taskId,
      },
      data: {
        provider: record.provider,
        model: record.model,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        attempt: record.attempt,
        success: record.success,
        error: record.error,
      },
      durationMs: record.latencyMs,
    });
  }

  /** Get LLM call statistics */
  getLLMStats(): LLMStats {
    const calls = this.llmCalls;

    if (calls.length === 0) {
      return {
        totalCalls: 0,
        totalTokens: 0,
        averageLatencyMs: 0,
        errorRate: 0,
        byProvider: {},
        byAgent: {},
      };
    }

    let totalTokens = 0;
    let totalLatency = 0;
    let errorCount = 0;
    const byProvider: LLMStats["byProvider"] = {};
    const byAgent: LLMStats["byAgent"] = {};

    for (const call of calls) {
      totalTokens += call.totalTokens;
      totalLatency += call.latencyMs;
      if (!call.success) errorCount++;

      // By provider
      if (!byProvider[call.provider]) {
        byProvider[call.provider] = { calls: 0, tokens: 0, avgLatencyMs: 0 };
      }
      const p = byProvider[call.provider];
      p.calls++;
      p.tokens += call.totalTokens;
      p.avgLatencyMs =
        (p.avgLatencyMs * (p.calls - 1) + call.latencyMs) / p.calls;

      // By agent
      if (!byAgent[call.agentId]) {
        byAgent[call.agentId] = { calls: 0, tokens: 0 };
      }
      const a = byAgent[call.agentId];
      a.calls++;
      a.tokens += call.totalTokens;
    }

    return {
      totalCalls: calls.length,
      totalTokens,
      averageLatencyMs: Math.round(totalLatency / calls.length),
      errorRate: errorCount / calls.length,
      byProvider,
      byAgent,
    };
  }

  // ── Log Querying ───────────────────────────────────────────

  /** Query structured log entries */
  query(filter: LogQueryFilter): StructuredLogEntry[] {
    let results = this.entries;

    if (filter.level) {
      results = results.filter((e) => e.level === filter.level);
    }
    if (filter.source) {
      results = results.filter((e) => e.source === filter.source);
    }
    if (filter.taskId) {
      results = results.filter((e) => e.context.taskId === filter.taskId);
    }
    if (filter.workflowId) {
      results = results.filter(
        (e) => e.context.workflowId === filter.workflowId,
      );
    }
    if (filter.agentId) {
      results = results.filter((e) => e.context.agentId === filter.agentId);
    }
    if (filter.since) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until) {
      results = results.filter((e) => e.timestamp <= filter.until!);
    }
    if (filter.limit && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /** Get entries for a specific task */
  getTaskLog(taskId: string): StructuredLogEntry[] {
    return this.query({ taskId });
  }

  /** Get entries for a specific workflow */
  getWorkflowLog(workflowId: string): StructuredLogEntry[] {
    return this.query({ workflowId });
  }

  /** Get the raw audit buffer contents (for testing) */
  getAuditBuffer(): string[] {
    return [...this.auditBuffer];
  }

  /** Get the raw structured buffer contents (for testing) */
  getStructuredBuffer(): string[] {
    return [...this.structuredBuffer];
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Flush buffers to disk */
  async flush(): Promise<void> {
    // Flush structured log
    if (this.structuredBuffer.length > 0) {
      const entries = this.structuredBuffer;
      this.structuredBuffer = [];
      try {
        appendFileSync(
          this.config.structuredLogPath,
          entries.join("\n") + "\n",
        );
      } catch {
        // Best effort — don't crash
      }
    }

    // Flush audit log
    if (this.auditBuffer.length > 0) {
      const entries = this.auditBuffer;
      this.auditBuffer = [];
      try {
        appendFileSync(this.config.auditLogPath, entries.join("\n") + "\n");
      } catch {
        // Best effort
      }
    }
  }

  /** Graceful close: flush + stop timer */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }

  // ── Private ────────────────────────────────────────────────

  private ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // Best effort
      }
    }
  }
}
