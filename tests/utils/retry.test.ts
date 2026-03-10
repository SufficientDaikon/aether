// ─────────────────────────────────────────────────────────────
// Retry Tests
// tests/utils/retry.test.ts
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "bun:test";
import {
  retryWithBackoff,
  DEFAULT_RETRYABLE_ERRORS,
} from "../../core/utils/retry.ts";

describe("retryWithBackoff", () => {
  it("returns result immediately when fn succeeds on first call", async () => {
    const result = await retryWithBackoff(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("retries on a retryable error and returns result on success", async () => {
    let calls = 0;
    const sleepCalls: number[] = [];

    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("429 too many requests");
        return "success";
      },
      {
        baseDelay: 10,
        maxDelay: 100,
        sleepFn: async ms => {
          sleepCalls.push(ms);
        },
      }
    );

    expect(result).toBe("success");
    expect(calls).toBe(3);
    expect(sleepCalls.length).toBe(2);
  });

  it("does NOT retry a non-retryable error", async () => {
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("ValidationError: bad input");
        },
        { baseDelay: 10, sleepFn: async () => {} }
      )
    ).rejects.toThrow("ValidationError");

    expect(calls).toBe(1);
  });

  it("exhausts all retries then throws the last error", async () => {
    let calls = 0;
    const sleepCalls: number[] = [];

    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("503 service unavailable");
        },
        {
          maxRetries: 3,
          baseDelay: 10,
          sleepFn: async ms => {
            sleepCalls.push(ms);
          },
        }
      )
    ).rejects.toThrow("503 service unavailable");

    expect(calls).toBe(4); // initial attempt + 3 retries
    expect(sleepCalls.length).toBe(3);
  });

  it("calls onRetry with correct attempt number, error, and delay", async () => {
    const onRetryCalls: Array<{ attempt: number; msg: string; delay: number }> =
      [];

    await expect(
      retryWithBackoff(
        async () => {
          throw new Error("429 rate limited");
        },
        {
          maxRetries: 2,
          baseDelay: 10,
          sleepFn: async () => {},
          onRetry: (attempt, error, delay) =>
            onRetryCalls.push({ attempt, msg: error.message, delay }),
        }
      )
    ).rejects.toThrow();

    expect(onRetryCalls.length).toBe(2);
    expect(onRetryCalls[0].attempt).toBe(1);
    expect(onRetryCalls[1].attempt).toBe(2);
    expect(onRetryCalls[0].msg).toContain("429");
  });

  it("applies exponential backoff with ±20% jitter", async () => {
    const sleepCalls: number[] = [];

    await expect(
      retryWithBackoff(
        async () => {
          throw new Error("ECONNRESET");
        },
        {
          maxRetries: 2,
          baseDelay: 100,
          maxDelay: 10000,
          sleepFn: async ms => {
            sleepCalls.push(ms);
          },
        }
      )
    ).rejects.toThrow();

    // attempt 0 → jitter(100 * 2^0) = jitter(100) ∈ [80, 120]
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(80);
    expect(sleepCalls[0]).toBeLessThanOrEqual(120);
    // attempt 1 → jitter(100 * 2^1) = jitter(200) ∈ [160, 240]
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(160);
    expect(sleepCalls[1]).toBeLessThanOrEqual(240);
  });

  it("caps delay at maxDelay (before jitter)", async () => {
    const sleepCalls: number[] = [];

    await expect(
      retryWithBackoff(
        async () => {
          throw new Error("503 error");
        },
        {
          maxRetries: 5,
          baseDelay: 1000,
          maxDelay: 200,
          sleepFn: async ms => {
            sleepCalls.push(ms);
          },
        }
      )
    ).rejects.toThrow();

    // Raw cap is 200; with +20% jitter the max actual value is 240
    for (const delay of sleepCalls) {
      expect(delay).toBeLessThanOrEqual(240);
    }
  });

  it("matches by error class name (constructor.name / name property)", async () => {
    class ThrottlingException extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "ThrottlingException";
      }
    }

    let calls = 0;
    const sleepCalls: number[] = [];

    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 2) throw new ThrottlingException("limit exceeded");
        return "ok";
      },
      {
        baseDelay: 10,
        sleepFn: async ms => {
          sleepCalls.push(ms);
        },
      }
    );

    expect(result).toBe("ok");
    expect(sleepCalls.length).toBe(1);
  });

  it("supports custom retryableErrors patterns", async () => {
    let calls = 0;

    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 2) throw new Error("MyCustomTransientError: please retry");
        return "done";
      },
      {
        retryableErrors: ["MyCustomTransientError"],
        baseDelay: 10,
        sleepFn: async () => {},
      }
    );

    expect(result).toBe("done");
    expect(calls).toBe(2);
  });

  it("DEFAULT_RETRYABLE_ERRORS contains expected patterns", () => {
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("ThrottlingException");
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("ServiceUnavailable");
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("ECONNRESET");
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("ETIMEDOUT");
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("429");
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("503");
    expect(DEFAULT_RETRYABLE_ERRORS).toContain("502");
  });

  it("wraps non-Error thrown values in an Error", async () => {
    await expect(
      retryWithBackoff(async () => {
        throw "raw string error";
      }, { retryableErrors: [], sleepFn: async () => {} })
    ).rejects.toThrow("raw string error");
  });
});
