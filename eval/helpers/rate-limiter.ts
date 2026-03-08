// ─────────────────────────────────────────────────────────────
// AETHER Eval — Rate Limiter
// Sliding window RPM limiter for Gemini API calls
// ─────────────────────────────────────────────────────────────

export interface RateLimiterConfig {
  maxRequestsPerMinute: number;
  minIntervalMs: number;
  backoffBaseMs: number;
  maxBackoffMs: number;
  maxRetries: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequestsPerMinute: 8,
  minIntervalMs: 7_500,
  backoffBaseMs: 15_000,
  maxBackoffMs: 120_000,
  maxRetries: 5,
};

export class RateLimiter {
  private config: RateLimiterConfig;
  private lastCallTimestamp = 0;
  private callTimestamps: number[] = [];
  private consecutiveFailures = 0;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Wait until it's safe to make the next API call */
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    // Prune timestamps older than 60s
    this.callTimestamps = this.callTimestamps.filter((t) => now - t < 60_000);

    // If at RPM limit, wait until oldest call falls outside window
    if (this.callTimestamps.length >= this.config.maxRequestsPerMinute) {
      const oldestInWindow = this.callTimestamps[0];
      const waitUntil = oldestInWindow + 60_000;
      const waitMs = waitUntil - Date.now();
      if (waitMs > 0) {
        console.log(
          `[RateLimiter] RPM limit reached, waiting ${Math.round(waitMs)}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    // Enforce minimum interval
    const elapsed = Date.now() - this.lastCallTimestamp;
    if (elapsed < this.config.minIntervalMs) {
      const gapMs = this.config.minIntervalMs - elapsed;
      await new Promise((r) => setTimeout(r, gapMs));
    }

    this.lastCallTimestamp = Date.now();
    this.callTimestamps.push(this.lastCallTimestamp);
  }

  /** Get exponential backoff duration for a 429 error */
  getBackoffMs(): number {
    this.consecutiveFailures++;
    const backoff = Math.min(
      this.config.backoffBaseMs * Math.pow(2, this.consecutiveFailures - 1),
      this.config.maxBackoffMs,
    );
    // Add 0-25% jitter
    return backoff + Math.random() * backoff * 0.25;
  }

  /** Signal a successful call */
  onSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /** Check if we should retry after a 429 */
  shouldRetry(): boolean {
    return this.consecutiveFailures < this.config.maxRetries;
  }

  getStats(): {
    totalCalls: number;
    consecutiveFailures: number;
    callsInLastMinute: number;
  } {
    const now = Date.now();
    return {
      totalCalls: this.callTimestamps.length,
      consecutiveFailures: this.consecutiveFailures,
      callsInLastMinute: this.callTimestamps.filter((t) => now - t < 60_000)
        .length,
    };
  }
}
