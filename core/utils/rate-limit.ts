// ─────────────────────────────────────────────────────────────
// GitHub API Rate Limit Handler
// R11.3 — GitHubRateLimiter class
// ─────────────────────────────────────────────────────────────

/** Configuration for GitHubRateLimiter */
export interface RateLimiterConfig {
  /** Only inspect rate-limit headers every N requests (default: 10) */
  checkInterval?: number;
  /** Pause when remaining requests fall below this threshold (default: 100) */
  threshold?: number;
  /** Injectable sleep function — useful for testing without real delays */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Subset of headers returned by GitHub API responses */
export interface GitHubRateLimitHeaders {
  "x-ratelimit-remaining"?: string;
  "x-ratelimit-reset"?: string;
  [key: string]: string | undefined;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

/**
 * Manages GitHub API rate limiting by inspecting `X-RateLimit-*` response headers
 * and pausing execution when the quota is nearly exhausted.
 *
 * Call `checkResponse()` after every GitHub API request. Headers are only
 * parsed every `checkInterval` requests to minimise overhead.
 *
 * @example
 * const limiter = new GitHubRateLimiter({ threshold: 50 });
 * const res = await fetch("https://api.github.com/repos/...");
 * await limiter.checkResponse(Object.fromEntries(res.headers));
 */
export class GitHubRateLimiter {
  private requestCount = 0;
  private readonly checkInterval: number;
  private readonly threshold: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(config: RateLimiterConfig = {}) {
    this.checkInterval = config.checkInterval ?? 10;
    this.threshold = config.threshold ?? 100;
    this.sleepFn = config.sleepFn ?? DEFAULT_SLEEP;
  }

  /**
   * Record a completed request and, every `checkInterval` requests, inspect the
   * supplied headers. Sleeps until the rate-limit resets when remaining < threshold.
   *
   * Missing or malformed headers are silently ignored.
   *
   * @param headers Response headers from a GitHub API call
   */
  async checkResponse(headers: GitHubRateLimitHeaders): Promise<void> {
    this.requestCount++;

    if (this.requestCount % this.checkInterval !== 0) return;

    // Normalize to lowercase for case-insensitive matching
    const normalized: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(headers)) {
      normalized[k.toLowerCase()] = v;
    }

    const remainingStr = normalized["x-ratelimit-remaining"];
    const resetStr = normalized["x-ratelimit-reset"];

    if (remainingStr === undefined || resetStr === undefined) return;

    const remaining = parseInt(remainingStr, 10);
    const resetEpoch = parseInt(resetStr, 10);

    if (isNaN(remaining) || isNaN(resetEpoch)) return;

    if (remaining < this.threshold) {
      const resetMs = resetEpoch * 1000;
      const now = Date.now();
      const waitMs = Math.max(0, resetMs - now);

      if (waitMs > 0) {
        console.log(
          `[GitHubRateLimiter] Rate limit low (${remaining} remaining). ` +
            `Waiting ${waitMs}ms until reset at ${new Date(resetMs).toISOString()}`
        );
        await this.sleepFn(waitMs);
      }
    }
  }

  /** Total requests tracked since construction or last `reset()` */
  getRequestCount(): number {
    return this.requestCount;
  }

  /** Reset the internal request counter to zero */
  reset(): void {
    this.requestCount = 0;
  }
}
