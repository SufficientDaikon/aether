// ─────────────────────────────────────────────────────────────
// AETHER Synapse Logger
// Fast, structured, buffered logger that writes to
// .aether/synapse.log using Bun-native file APIs.
// ─────────────────────────────────────────────────────────────

import { mkdirSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Numeric severity for filtering (higher = more severe). */
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** ANSI-free upper-case labels, fixed width for alignment. */
const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

export class SynapseLogger {
  /** Absolute path to the log file. */
  private logFile: string;
  /** Minimum severity to record. */
  private level: LogLevel;
  /** In-memory buffer; flushed periodically and on close. */
  private buffer: string[] = [];
  /** Handle to the periodic flush timer. */
  private flushInterval: Timer | null = null;
  /** Flush cadence in ms. */
  private readonly FLUSH_INTERVAL_MS = 1_000;
  /** Guard against concurrent flushes. */
  private flushing = false;
  /** Whether the logger has been closed. */
  private closed = false;
  /** Maximum number of flush retry attempts before giving up. */
  private readonly MAX_FLUSH_RETRIES = 3;
  /** Delay in ms between flush retry attempts. */
  private readonly FLUSH_RETRY_DELAY_MS = 250;

  constructor(logDir: string, level: LogLevel = "info") {
    this.level = level;

    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    this.logFile = join(logDir, "synapse.log");

    // Start periodic flush
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        // Fallback: dump to stderr so we don't lose error visibility
        console.error("[SynapseLogger] flush error:", err);
      });
    }, this.FLUSH_INTERVAL_MS);

    // Unref the timer so it doesn't prevent process exit in short-lived scripts
    if (
      this.flushInterval &&
      typeof this.flushInterval === "object" &&
      "unref" in this.flushInterval
    ) {
      (this.flushInterval as { unref: () => void }).unref();
    }
  }

  // ───────────────── Public API ─────────────────

  /** Log at DEBUG level. */
  debug(source: string, message: string, data?: unknown): void {
    this.log("debug", source, message, data);
  }

  /** Log at INFO level. */
  info(source: string, message: string, data?: unknown): void {
    this.log("info", source, message, data);
  }

  /** Log at WARN level. */
  warn(source: string, message: string, data?: unknown): void {
    this.log("warn", source, message, data);
  }

  /** Log at ERROR level. */
  error(source: string, message: string, data?: unknown): void {
    this.log("error", source, message, data);
  }

  /**
   * Graceful shutdown: flush remaining buffer and stop the timer.
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush — fall back to sync emergency flush if async fails
    try {
      await this.flush();
    } catch {
      this.emergencyFlush();
    }
  }

  /**
   * Synchronous emergency flush for shutdown paths.
   * Uses appendFileSync — blocks the event loop but guarantees data hits disk.
   */
  emergencyFlush(): void {
    if (this.buffer.length === 0) return;
    const entries = this.buffer;
    this.buffer = [];
    const payload = entries.join("\n") + "\n";
    try {
      appendFileSync(this.logFile, payload);
    } catch {
      // Last resort — dump to stderr
      for (const entry of entries) {
        console.error(entry);
      }
    }
  }

  // ───────────────── Internals ─────────────────

  /**
   * Format and buffer a log entry.
   *
   * Format: `[ISO_TIMESTAMP] [LEVEL] [SOURCE] message {json_data}`
   */
  private log(
    level: LogLevel,
    source: string,
    message: string,
    data?: unknown,
  ): void {
    if (this.closed) return;

    // Level gate
    if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[this.level]) return;

    const timestamp = new Date().toISOString();
    const label = LEVEL_LABEL[level];

    let line = `[${timestamp}] [${label}] [${source}] ${message}`;

    if (data !== undefined) {
      try {
        const serialised =
          typeof data === "string" ? data : JSON.stringify(data);
        line += ` ${serialised}`;
      } catch {
        line += ` [unserializable data]`;
      }
    }

    this.buffer.push(line);

    // Also emit to stderr for error-level messages for immediate visibility
    if (level === "error") {
      console.error(line);
    }
  }

  /**
   * Flush the in-memory buffer to disk using Bun.write (append mode).
   * Uses a guard to prevent overlapping flushes.
   * Retries up to MAX_FLUSH_RETRIES times before falling back to stderr.
   */
  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    // Swap buffer so new writes don't contend
    const entries = this.buffer;
    this.buffer = [];

    try {
      const payload = entries.join("\n") + "\n";

      let lastErr: unknown;
      for (let attempt = 1; attempt <= this.MAX_FLUSH_RETRIES; attempt++) {
        try {
          // Append-only write — O(payload) not O(file) per flush
          const file = Bun.file(this.logFile);
          const exists = await file.exists();

          if (exists) {
            // Use node:fs appendFile for true append (no read-entire-file)
            const { appendFile } = await import("node:fs/promises");
            await appendFile(this.logFile, payload);
          } else {
            // First write — create the file
            await Bun.write(this.logFile, payload);
          }

          // Success — exit the retry loop
          return;
        } catch (err) {
          lastErr = err;
          console.error(
            `[SynapseLogger] flush attempt ${attempt}/${this.MAX_FLUSH_RETRIES} failed:`,
            err,
          );

          // Wait before retrying (skip delay on the last attempt)
          if (attempt < this.MAX_FLUSH_RETRIES) {
            await new Promise((r) => setTimeout(r, this.FLUSH_RETRY_DELAY_MS));
          }
        }
      }

      // All retries exhausted — dump to stderr so entries aren't lost
      console.error(
        `[SynapseLogger] all ${this.MAX_FLUSH_RETRIES} flush attempts failed, dumping ${entries.length} entries to stderr. Last error:`,
        lastErr,
      );
      for (const entry of entries) {
        console.error(entry);
      }
    } finally {
      this.flushing = false;
    }
  }
}
