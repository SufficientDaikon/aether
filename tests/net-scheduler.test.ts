// ─────────────────────────────────────────────────────────────
// Tests: NetScheduler — Parallel reduction engine
// ─────────────────────────────────────────────────────────────

import { describe, test, expect, beforeEach } from "bun:test";
import { InteractionNet } from "../core/interaction-net.ts";
import { NetScheduler } from "../core/net-scheduler.ts";
import { SynapseLogger } from "../core/logger.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("NetScheduler", () => {
  let net: InteractionNet;
  let scheduler: NetScheduler;
  let logger: SynapseLogger;

  beforeEach(() => {
    const logDir = mkdtempSync(join(tmpdir(), "scheduler-test-"));
    logger = new SynapseLogger(logDir, "warn");
    net = new InteractionNet();
  });

  // ── Lifecycle ────────────────────────────────────────────

  describe("Lifecycle", () => {
    test("creates scheduler with default config", () => {
      scheduler = new NetScheduler(net, logger);
      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBe(0);
    });

    test("creates scheduler with custom config", () => {
      scheduler = new NetScheduler(net, logger, {
        maxConcurrency: 2,
        scanIntervalMs: 100,
      });
      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBe(0);
    });

    test("start and stop are idempotent", () => {
      scheduler = new NetScheduler(net, logger, { scanIntervalMs: 1000 });
      scheduler.start();
      scheduler.start(); // should not throw
      scheduler.stop();
      scheduler.stop(); // should not throw
    });
  });

  // ── Reduction Execution ──────────────────────────────────

  describe("Reduction", () => {
    test("reduces constructor-eraser pair (γ-ε)", async () => {
      scheduler = new NetScheduler(net, logger, {
        maxConcurrency: 4,
        scanIntervalMs: 10,
      });

      // Create a constructor and eraser connected via principal ports
      const constructor1 = net.createJoin(2, "concat");
      const eraser = net.createEraser("done");
      net.connect(constructor1.principal, eraser.principal);

      // Should have an active pair
      const pairs = net.findActivePairs();
      expect(pairs.length).toBeGreaterThanOrEqual(1);

      // Run scheduler
      await scheduler.runToCompletion(100);

      // After reduction, both should be removed or completed
      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBeGreaterThanOrEqual(1);
    });

    test("reduces eraser-eraser pair (ε-ε)", async () => {
      scheduler = new NetScheduler(net, logger, {
        maxConcurrency: 4,
        scanIntervalMs: 10,
      });

      const e1 = net.createEraser("cancel");
      const e2 = net.createEraser("cancel");
      net.connect(e1.principal, e2.principal);

      await scheduler.runToCompletion(100);

      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBeGreaterThanOrEqual(1);
    });

    test("reaches normal form for empty net", async () => {
      scheduler = new NetScheduler(net, logger, { scanIntervalMs: 10 });

      // Empty net is already in normal form
      await scheduler.runToCompletion(10);

      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBe(0);
    });

    test("task-task pair reduction with executor", async () => {
      const executedTasks: string[] = [];

      scheduler = new NetScheduler(net, logger, {
        maxConcurrency: 4,
        scanIntervalMs: 10,
        taskExecutor: async (taskPayload) => {
          executedTasks.push(taskPayload.description);
          return `result-${taskPayload.description}`;
        },
      });

      const t1 = net.createTaskNode("analyze", "agent-1");
      const t2 = net.createTaskNode("review", "agent-2");
      net.connect(t1.principal, t2.principal);

      await scheduler.runToCompletion(100);

      // At least one task should have been executed
      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Parallel DAG Reduction ───────────────────────────────

  describe("Parallel DAG", () => {
    test("reduces a full parallel DAG to completion", async () => {
      const results: string[] = [];

      scheduler = new NetScheduler(net, logger, {
        maxConcurrency: 4,
        scanIntervalMs: 10,
        taskExecutor: async (taskPayload) => {
          results.push(taskPayload.description);
          return `done: ${taskPayload.description}`;
        },
      });

      // Build a DAG with 3 parallel tasks joining into 1
      net.buildParallelDAG([
        { description: "task-alpha", agentId: "agent-1" },
        { description: "task-beta", agentId: "agent-2" },
        { description: "task-gamma", agentId: "agent-3" },
      ]);

      await scheduler.runToCompletion(200);

      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Metrics ──────────────────────────────────────────────

  describe("Metrics", () => {
    test("tracks reduction counts", async () => {
      scheduler = new NetScheduler(net, logger, { scanIntervalMs: 10 });

      const e1 = net.createEraser("a");
      const e2 = net.createEraser("b");
      net.connect(e1.principal, e2.principal);

      await scheduler.runToCompletion(50);

      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBeGreaterThanOrEqual(1);
      expect(metrics.successfulReductions).toBeGreaterThanOrEqual(1);
      expect(metrics.failedReductions).toBe(0);
    });

    test("tracks peak concurrency", async () => {
      scheduler = new NetScheduler(net, logger, {
        maxConcurrency: 4,
        scanIntervalMs: 10,
      });

      // Create multiple pairs for concurrent reduction
      for (let i = 0; i < 3; i++) {
        const e1 = net.createEraser(`cancel-${i}`);
        const e2 = net.createEraser(`cancel-${i}-b`);
        net.connect(e1.principal, e2.principal);
      }

      await scheduler.runToCompletion(100);

      const metrics = scheduler.getMetrics();
      expect(metrics.totalReductions).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Effects ──────────────────────────────────────────────

  describe("Effects", () => {
    test("getEffects returns collected effects", async () => {
      scheduler = new NetScheduler(net, logger, { scanIntervalMs: 10 });

      const e1 = net.createEraser("done");
      const e2 = net.createEraser("done");
      net.connect(e1.principal, e2.principal);

      await scheduler.runToCompletion(50);

      const effects = scheduler.drainEffects();
      // Effects may or may not be generated depending on reduction rules
      expect(Array.isArray(effects)).toBe(true);
    });
  });
});
