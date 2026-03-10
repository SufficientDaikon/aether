// ─────────────────────────────────────────────────────────────
// Batch Processor Tests
// tests/utils/batch.test.ts
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "bun:test";
import { processBatch } from "../../core/utils/batch.ts";

describe("processBatch", () => {
  it("processes all items and returns them in order", async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await processBatch(items, async n => n * 2, {
      delayBetweenBatches: 0,
    });

    expect(result.totalProcessed).toBe(5);
    expect(result.successCount).toBe(5);
    expect(result.failureCount).toBe(0);
    expect(result.results.map(r => r.result)).toEqual([2, 4, 6, 8, 10]);
  });

  it("captures per-item errors without aborting the batch", async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await processBatch(
      items,
      async n => {
        if (n % 2 === 0) throw new Error(`fail ${n}`);
        return n;
      },
      { delayBetweenBatches: 0 }
    );

    expect(result.totalProcessed).toBe(5);
    expect(result.successCount).toBe(3); // 1, 3, 5 succeed
    expect(result.failureCount).toBe(2); // 2, 4 fail

    const failures = result.results.filter(r => !r.success);
    expect(failures[0].error?.message).toBe("fail 2");
    expect(failures[1].error?.message).toBe("fail 4");

    const successes = result.results.filter(r => r.success);
    expect(successes.map(r => r.result)).toEqual([1, 3, 5]);
  });

  it("respects batchSize — groups items into correct batches", async () => {
    const batchSizes: number[] = [];
    const items = Array.from({ length: 7 }, (_, i) => i);

    await processBatch(
      items,
      async n => n,
      {
        batchSize: 3,
        delayBetweenBatches: 0,
        onBatchComplete: (_, results) => batchSizes.push(results.length),
      }
    );

    // 7 items with batchSize=3 → batches of [3, 3, 1]
    expect(batchSizes).toEqual([3, 3, 1]);
  });

  it("calls onBatchComplete with correct batchIndex after each batch", async () => {
    const calls: Array<{ batchIndex: number; count: number }> = [];
    const items = Array.from({ length: 6 }, (_, i) => i);

    await processBatch(items, async n => n, {
      batchSize: 2,
      delayBetweenBatches: 0,
      onBatchComplete: (batchIndex, results) =>
        calls.push({ batchIndex, count: results.length }),
    });

    expect(calls.length).toBe(3);
    expect(calls[0]).toEqual({ batchIndex: 0, count: 2 });
    expect(calls[1]).toEqual({ batchIndex: 1, count: 2 });
    expect(calls[2]).toEqual({ batchIndex: 2, count: 2 });
  });

  it("inserts delay between batches but NOT after the last batch", async () => {
    const sleepCalls: number[] = [];
    const items = Array.from({ length: 7 }, (_, i) => i);

    await processBatch(items, async n => n, {
      batchSize: 3,
      delayBetweenBatches: 50,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    // 3 batches → 2 inter-batch delays
    expect(sleepCalls.length).toBe(2);
    expect(sleepCalls[0]).toBe(50);
    expect(sleepCalls[1]).toBe(50);
  });

  it("no delay when only one batch", async () => {
    const sleepCalls: number[] = [];

    await processBatch([1, 2, 3], async n => n, {
      batchSize: 10,
      delayBetweenBatches: 100,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    expect(sleepCalls.length).toBe(0);
  });

  it("handles an empty array", async () => {
    const result = await processBatch(
      [] as number[],
      async x => x,
      { delayBetweenBatches: 0 }
    );

    expect(result.totalProcessed).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("wraps non-Error rejections in an Error instance", async () => {
    const result = await processBatch(
      [1],
      async () => {
        throw "string error";
      },
      { delayBetweenBatches: 0 }
    );

    expect(result.failureCount).toBe(1);
    expect(result.results[0].error).toBeInstanceOf(Error);
    expect(result.results[0].error?.message).toBe("string error");
  });

  it("returns a non-negative duration", async () => {
    const result = await processBatch([1, 2, 3], async n => n, {
      delayBetweenBatches: 0,
    });
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("includes the original item reference in each result", async () => {
    const items = [{ id: "a" }, { id: "b" }];
    const result = await processBatch(items, async obj => obj.id, {
      delayBetweenBatches: 0,
    });

    expect(result.results[0].item).toBe(items[0]);
    expect(result.results[1].item).toBe(items[1]);
  });

  it("skips delay when delayBetweenBatches is 0", async () => {
    const sleepCalls: number[] = [];
    const items = Array.from({ length: 20 }, (_, i) => i);

    await processBatch(items, async n => n, {
      batchSize: 5,
      delayBetweenBatches: 0,
      sleepFn: async ms => {
        sleepCalls.push(ms);
      },
    });

    expect(sleepCalls.length).toBe(0);
  });
});
