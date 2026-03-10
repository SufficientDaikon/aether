// ─────────────────────────────────────────────────────────────
// Retry with Exponential Backoff
// R11.1 — retryWithBackoff() generic async retry wrapper
// ─────────────────────────────────────────────────────────────

/** Default error patterns (class name or message substrings) that trigger a retry */
export const DEFAULT_RETRYABLE_ERRORS: string[] = [
  "ThrottlingException",
  "ServiceUnavailable",
  "ECONNRESET",
  "ETIMEDOUT",
  "429",
  "503",
  "502",
];

/** Configuration for retryWithBackoff */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds; doubles each attempt (default: 1000) */
  baseDelay?: number;
  /** Hard cap on delay before jitter is applied (default: 8000) */
  maxDelay?: number;
  /** Error class names or message substrings that should trigger a retry */
  retryableErrors?: string[];
  /**
   * Called before each retry sleep.
   * @param attempt  1-based retry attempt number
   * @param error    The error that triggered the retry
   * @param delayMs  The planned sleep duration (after jitter)
   */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Injectable sleep function — useful for testing without real delays */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

/**
 * Checks whether an error matches any retryable pattern by testing against
 * the error's `name`, `constructor.name`, and `message`.
 */
function isRetryable(error: Error, patterns: string[]): boolean {
  const subject = [error.name, error.constructor.name, error.message]
    .filter(Boolean)
    .join(" ");
  return patterns.some(p => subject.includes(p));
}

/** Applies ±20% random jitter. Multiplier is sampled from [0.8, 1.2]. */
function withJitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

/**
 * Wraps an async function with exponential backoff retry logic.
 *
 * Delay formula: `jitter(min(baseDelay * 2^attempt, maxDelay))`
 *
 * Not retried when the error doesn't match `retryableErrors`, or when
 * `maxRetries` attempts have already been made.
 *
 * @param fn     Async operation to retry
 * @param config Retry configuration
 * @returns      Result from the first successful invocation
 * @throws       Last error when retries are exhausted, or first non-retryable error
 *
 * @example
 * const data = await retryWithBackoff(() => fetch("https://api.github.com/..."), {
 *   maxRetries: 3,
 *   baseDelay: 500,
 *   onRetry: (n, err) => console.warn(`Retry #${n}: ${err.message}`),
 * });
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 8000,
    retryableErrors = DEFAULT_RETRYABLE_ERRORS,
    onRetry,
    sleepFn = DEFAULT_SLEEP,
  } = config;

  let lastError!: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !isRetryable(lastError, retryableErrors)) {
        throw lastError;
      }

      const rawDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const delay = withJitter(rawDelay);

      onRetry?.(attempt + 1, lastError, delay);
      await sleepFn(delay);
    }
  }

  throw lastError;
}
