// ─────────────────────────────────────────────────────────────
// Fallback Event Logger & Degradation Tracker
// R10.3 — FallbackLogger class
// ─────────────────────────────────────────────────────────────

/** A single recorded fallback event */
export interface FallbackEvent {
  /** The model that was originally attempted */
  originalModel: string;
  /** The model used as a fallback */
  fallbackModel: string;
  /** Human-readable reason for the fallback (e.g. error message) */
  reason: string;
  /** Unix timestamp in milliseconds when the event occurred */
  timestamp: number;
  /** Latency of the failed original attempt in milliseconds */
  latency: number;
}

/** Per-model statistics */
export interface ModelStats {
  /** Total number of times this model triggered a fallback */
  totalFallbacks: number;
  /** Whether this model is currently in a degraded/cooldown state */
  isDegraded: boolean;
  /** Unix timestamp (ms) until which the model is degraded, if applicable */
  degradedUntil?: number;
}

/** Aggregate statistics returned by getStats() */
export interface FallbackStats {
  /** Total fallback events logged across all models */
  totalEvents: number;
  /** Per-model aggregated statistics */
  modelStats: Record<string, ModelStats>;
  /** The 20 most recently logged events */
  recentEvents: FallbackEvent[];
}

/** Failures within this window count towards degradation */
const DEGRADED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
/** Minimum failures in the window to trigger degraded status */
const DEGRADED_THRESHOLD = 3;
/** How long a degraded model stays in cooldown */
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
/** Maximum events retained in memory */
const MAX_EVENTS = 1000;

/**
 * Logs model fallback events and tracks degradation.
 *
 * A model is marked **degraded** when it accumulates ≥3 failures within any
 * rolling 5-minute window. It enters a 5-minute cooldown before being
 * considered healthy again.
 *
 * @example
 * const logger = new FallbackLogger();
 * const start = Date.now();
 * try {
 *   return await model.send(prompt);
 * } catch (err) {
 *   logger.log({
 *     originalModel: "claude-opus-4-6", fallbackModel: "gpt-4o",
 *     reason: err.message, timestamp: Date.now(), latency: Date.now() - start,
 *   });
 * }
 * if (logger.isDegraded("claude-opus-4-6")) { /* skip this model *\/ }
 */
export class FallbackLogger {
  private events: FallbackEvent[] = [];
  /** Maps model ID → timestamps of recent failures (within the sliding window) */
  private modelFailureTimestamps: Map<string, number[]> = new Map();
  /** Maps model ID → Unix ms timestamp when degradation expires */
  private degradedUntilMap: Map<string, number> = new Map();

  /**
   * Record a fallback event and update degradation tracking for the original model.
   */
  log(event: FallbackEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    this._trackFailure(event.originalModel, event.timestamp);
    console.log(
      `[FallbackLogger] ${event.originalModel} → ${event.fallbackModel} | ` +
        `reason: ${event.reason} | latency: ${event.latency}ms`
    );
  }

  /**
   * Check whether a model is currently degraded.
   * Automatically clears expired degradation entries.
   *
   * @param model Model identifier
   * @param now   Override for current time (default: `Date.now()`)
   */
  isDegraded(model: string, now = Date.now()): boolean {
    const until = this.degradedUntilMap.get(model);
    if (until === undefined) return false;
    if (now >= until) {
      this.degradedUntilMap.delete(model);
      return false;
    }
    return true;
  }

  /**
   * Return aggregate fallback statistics.
   */
  getStats(): FallbackStats {
    const now = Date.now();
    const modelStats: Record<string, ModelStats> = {};

    for (const event of this.events) {
      const m = event.originalModel;
      if (!modelStats[m]) {
        modelStats[m] = { totalFallbacks: 0, isDegraded: false };
      }
      modelStats[m].totalFallbacks++;
    }

    for (const [model, stats] of Object.entries(modelStats)) {
      stats.isDegraded = this.isDegraded(model, now);
      const until = this.degradedUntilMap.get(model);
      if (until !== undefined) stats.degradedUntil = until;
    }

    return {
      totalEvents: this.events.length,
      modelStats,
      recentEvents: this.events.slice(-20),
    };
  }

  /** Clear all events and degradation state */
  clear(): void {
    this.events = [];
    this.modelFailureTimestamps.clear();
    this.degradedUntilMap.clear();
  }

  private _trackFailure(model: string, timestamp: number): void {
    const windowStart = timestamp - DEGRADED_WINDOW_MS;
    const prior = this.modelFailureTimestamps.get(model) ?? [];
    const recent = prior.filter(t => t >= windowStart);
    recent.push(timestamp);
    this.modelFailureTimestamps.set(model, recent);

    if (recent.length >= DEGRADED_THRESHOLD) {
      const until = timestamp + COOLDOWN_MS;
      this.degradedUntilMap.set(model, until);
      console.warn(
        `[FallbackLogger] Model "${model}" marked degraded until ${new Date(until).toISOString()}`
      );
    }
  }
}
