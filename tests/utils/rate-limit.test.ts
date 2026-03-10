// ─────────────────────────────────────────────────────────────
// GitHub Rate Limiter Tests
// tests/utils/rate-limit.test.ts
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "bun:test";
import { GitHubRateLimiter } from "../../core/utils/rate-limit.ts";

describe("GitHubRateLimiter", () => {
  it("does not sleep before checkInterval is reached", async () => {
    const sleepCalls: number[] = [];
    const limiter = new GitHubRateLimiter({
      checkInterval: 10,
      threshold: 100,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    const headers = {
      "x-ratelimit-remaining": "5",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
    };

    for (let i = 0; i < 9; i++) {
      await limiter.checkResponse(headers);
    }

    expect(sleepCalls.length).toBe(0);
    expect(limiter.getRequestCount()).toBe(9);
  });

  it("sleeps when remaining < threshold on the Nth request", async () => {
    const sleepCalls: number[] = [];
    const resetEpoch = Math.floor((Date.now() + 5000) / 1000); // 5 s in future

    const limiter = new GitHubRateLimiter({
      checkInterval: 5,
      threshold: 100,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    const headers = {
      "x-ratelimit-remaining": "50",
      "x-ratelimit-reset": String(resetEpoch),
    };

    for (let i = 0; i < 5; i++) {
      await limiter.checkResponse(headers);
    }

    expect(sleepCalls.length).toBe(1);
    expect(sleepCalls[0]).toBeGreaterThan(0);
  });

  it("does NOT sleep when remaining >= threshold", async () => {
    const sleepCalls: number[] = [];

    const limiter = new GitHubRateLimiter({
      checkInterval: 5,
      threshold: 100,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    const headers = {
      "x-ratelimit-remaining": "500",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
    };

    for (let i = 0; i < 5; i++) {
      await limiter.checkResponse(headers);
    }

    expect(sleepCalls.length).toBe(0);
  });

  it("does NOT sleep when reset time is already in the past", async () => {
    const sleepCalls: number[] = [];
    const pastEpoch = Math.floor((Date.now() - 10000) / 1000); // 10 s ago

    const limiter = new GitHubRateLimiter({
      checkInterval: 1,
      threshold: 100,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    await limiter.checkResponse({
      "x-ratelimit-remaining": "5",
      "x-ratelimit-reset": String(pastEpoch),
    });

    expect(sleepCalls.length).toBe(0);
  });

  it("handles completely missing headers gracefully", async () => {
    const limiter = new GitHubRateLimiter({ checkInterval: 1 });
    await expect(limiter.checkResponse({})).resolves.toBeUndefined();
  });

  it("handles partial headers (remaining only, no reset) gracefully", async () => {
    const limiter = new GitHubRateLimiter({ checkInterval: 1 });
    await expect(
      limiter.checkResponse({ "x-ratelimit-remaining": "5" })
    ).resolves.toBeUndefined();
  });

  it("handles malformed (non-numeric) header values gracefully", async () => {
    const sleepCalls: number[] = [];
    const limiter = new GitHubRateLimiter({
      checkInterval: 1,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    await limiter.checkResponse({
      "x-ratelimit-remaining": "not-a-number",
      "x-ratelimit-reset": "also-not-a-number",
    });

    expect(sleepCalls.length).toBe(0);
  });

  it("getRequestCount tracks all requests", async () => {
    const limiter = new GitHubRateLimiter({ checkInterval: 100 });
    for (let i = 0; i < 7; i++) {
      await limiter.checkResponse({});
    }
    expect(limiter.getRequestCount()).toBe(7);
  });

  it("reset() resets the request counter to zero", async () => {
    const limiter = new GitHubRateLimiter({ checkInterval: 100 });
    for (let i = 0; i < 5; i++) {
      await limiter.checkResponse({});
    }
    expect(limiter.getRequestCount()).toBe(5);
    limiter.reset();
    expect(limiter.getRequestCount()).toBe(0);
  });

  it("normalizes header keys case-insensitively", async () => {
    const sleepCalls: number[] = [];
    const resetEpoch = Math.floor((Date.now() + 3000) / 1000);

    const limiter = new GitHubRateLimiter({
      checkInterval: 1,
      threshold: 100,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    // Use uppercase header names
    await limiter.checkResponse({
      "X-RateLimit-Remaining": "10",
      "X-RateLimit-Reset": String(resetEpoch),
    } as any);

    expect(sleepCalls.length).toBe(1);
  });
});
