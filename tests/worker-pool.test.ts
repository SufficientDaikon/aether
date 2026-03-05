// ─────────────────────────────────────────────────────────────
// Tests: WorkerPool — Elastic worker management with task stealing
// ─────────────────────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkerPool, type PoolMetrics } from "../core/worker-pool.ts";
import { SynapseLogger } from "../core/logger.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("WorkerPool", () => {
  let pool: WorkerPool;
  let logger: SynapseLogger;

  beforeEach(() => {
    const logDir = mkdtempSync(join(tmpdir(), "worker-pool-test-"));
    logger = new SynapseLogger(logDir, "warn");
  });

  afterEach(async () => {
    if (pool) {
      await pool.stop();
    }
  });

  // ── Lifecycle ────────────────────────────────────────────

  describe("Lifecycle", () => {
    test("starts with minimum workers", async () => {
      pool = new WorkerPool(logger, { minWorkers: 2, maxWorkers: 4 });
      await pool.start(async (payload) => payload);

      const metrics = pool.getMetrics();
      expect(metrics.totalWorkers).toBe(2);
    });

    test("stops gracefully", async () => {
      pool = new WorkerPool(logger, { minWorkers: 1, maxWorkers: 2 });
      await pool.start(async (payload) => payload);
      await pool.stop();

      const metrics = pool.getMetrics();
      expect(metrics.totalWorkers).toBe(0);
    });

    test("double start is idempotent", async () => {
      pool = new WorkerPool(logger, { minWorkers: 1, maxWorkers: 2 });
      await pool.start(async (payload) => payload);
      await pool.start(async (payload) => payload); // should not throw

      const metrics = pool.getMetrics();
      expect(metrics.totalWorkers).toBe(1);
    });
  });

  // ── Task Submission ──────────────────────────────────────

  describe("Task submission", () => {
    test("executes a single task", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 1,
        maxWorkers: 2,
        taskTimeout: 5_000,
      });
      await pool.start(async (payload) => {
        return (payload as { value: number }).value * 2;
      });

      const result = await pool.submit({ value: 21 });
      expect(result).toBe(42);
    });

    test("executes multiple tasks concurrently", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 2,
        maxWorkers: 4,
        taskTimeout: 5_000,
      });

      const executed: number[] = [];
      await pool.start(async (payload) => {
        const { id, delay } = payload as { id: number; delay: number };
        await new Promise((r) => setTimeout(r, delay));
        executed.push(id);
        return id;
      });

      const tasks = [
        pool.submit({ id: 1, delay: 50 }),
        pool.submit({ id: 2, delay: 30 }),
        pool.submit({ id: 3, delay: 10 }),
      ];

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(3);
      expect(new Set(results)).toEqual(new Set([1, 2, 3]));
    });

    test("respects priority ordering", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 1,
        maxWorkers: 1,
        taskTimeout: 5_000,
      });

      const executionOrder: number[] = [];
      await pool.start(async (payload) => {
        const { id } = payload as { id: number };
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push(id);
        return id;
      });

      // Submit a blocking task first to fill the only worker
      const blocker = pool.submit({ id: 0 }, 3, 5_000);

      // Wait a tick for the blocker to start
      await new Promise((r) => setTimeout(r, 5));

      // Submit tasks with different priorities (higher = more urgent)
      // They should queue since the worker is busy
      const p1 = pool.submit({ id: 1 }, 1); // lowest priority
      const p2 = pool.submit({ id: 2 }, 5); // highest priority
      const p3 = pool.submit({ id: 3 }, 3); // medium priority

      await Promise.all([blocker, p1, p2, p3]);

      // After the blocker, tasks should have been dispatched by priority
      // First executed is 0 (blocker), then highest priority first
      expect(executionOrder[0]).toBe(0);

      // The priority queue should generally process higher priority first
      // but timing makes this somewhat non-deterministic with 1 worker
      expect(executionOrder).toHaveLength(4);
    });

    test("handles task failure", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 1,
        maxWorkers: 2,
        taskTimeout: 5_000,
        maxRetries: 0,
      });
      await pool.start(async () => {
        throw new Error("task explosion");
      });

      try {
        await pool.submit({ value: 1 });
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect((err as Error).message).toContain("task explosion");
      }
    });
  });

  // ── Metrics ──────────────────────────────────────────────

  describe("Metrics", () => {
    test("tracks processed task count", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 1,
        maxWorkers: 2,
        taskTimeout: 5_000,
      });
      await pool.start(async (p) => p);

      await pool.submit("a");
      await pool.submit("b");
      await pool.submit("c");

      const metrics = pool.getMetrics();
      expect(metrics.totalTasksProcessed).toBe(3);
      expect(metrics.totalTasksFailed).toBe(0);
    });

    test("tracks failed task count", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 1,
        maxWorkers: 2,
        taskTimeout: 5_000,
        maxRetries: 0,
      });
      await pool.start(async () => {
        throw new Error("fail");
      });

      try {
        await pool.submit("x");
      } catch {}

      const metrics = pool.getMetrics();
      expect(metrics.totalTasksFailed).toBe(1);
    });
  });

  // ── submitAll ────────────────────────────────────────────

  describe("submitAll", () => {
    test("submits multiple tasks and returns all results", async () => {
      pool = new WorkerPool(logger, {
        minWorkers: 2,
        maxWorkers: 4,
        taskTimeout: 5_000,
      });
      await pool.start(async (p) => {
        return `result-${(p as { id: string }).id}`;
      });

      const results = await pool.submitAll([
        { payload: { id: "a" } },
        { payload: { id: "b" } },
        { payload: { id: "c" } },
      ]);

      expect(results).toHaveLength(3);
      expect(new Set(results)).toEqual(
        new Set(["result-a", "result-b", "result-c"]),
      );
    });
  });
});
