// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: NetScheduler Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.4.1: Create scheduler with simple net ──────────
  await harness.runTest(
    "2.4.1",
    "NetScheduler — Create and run with constructor-eraser pair",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 15;
      const details: string[] = [];

      try {
        const { InteractionNet } =
          await import("../../core/interaction-net.ts");
        const { NetScheduler } = await import("../../core/net-scheduler.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const net = new InteractionNet();

          // Create a constructor-eraser pair (fundamental IC reduction)
          const con = net.createJoin(1, "concat");
          const era = net.createEraser("test reduction");
          net.connect(con.principal, era.principal);

          details.push("Created constructor-eraser active pair");
          score += 3;

          // Verify active pair exists before scheduling
          const pairsBefore = net.findActivePairs();
          if (pairsBefore.length >= 1) {
            details.push(`Active pairs before: ${pairsBefore.length}`);
            score += 2;
          }

          // Create scheduler with no task executor (pure combinator reduction)
          const scheduler = new NetScheduler(net, logger, {
            maxConcurrency: 2,
            scanIntervalMs: 10,
          });

          // Run to completion
          await scheduler.runToCompletion(100);
          details.push("runToCompletion finished");
          score += 3;

          // Check metrics
          const metrics = scheduler.getMetrics();
          if (metrics) {
            details.push(
              `Metrics: totalReductions=${metrics.totalReductions}, successful=${metrics.successfulReductions}`,
            );
            if (metrics.totalReductions >= 1) {
              details.push("At least 1 reduction occurred");
              score += 4;
            }
            score += 3;
          }

          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.4.2: Scheduler metrics tracking ────────────────
  await harness.runTest(
    "2.4.2",
    "NetScheduler — Metrics tracking",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 15;
      const details: string[] = [];

      try {
        const { InteractionNet } =
          await import("../../core/interaction-net.ts");
        const { NetScheduler } = await import("../../core/net-scheduler.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const net = new InteractionNet();

          // Create multiple erasers that annihilate each other
          const e1 = net.createEraser("eraser A");
          const e2 = net.createEraser("eraser B");
          net.connect(e1.principal, e2.principal);

          const scheduler = new NetScheduler(net, logger, {
            maxConcurrency: 4,
            scanIntervalMs: 10,
          });

          // Initial metrics should be zero
          const initialMetrics = scheduler.getMetrics();
          if (initialMetrics.totalReductions === 0) {
            details.push("Initial totalReductions = 0");
            score += 3;
          }

          // Run to completion
          await scheduler.runToCompletion(100);

          const finalMetrics = scheduler.getMetrics();
          details.push(
            `Final metrics: total=${finalMetrics.totalReductions}, successful=${finalMetrics.successfulReductions}, failed=${finalMetrics.failedReductions}`,
          );
          score += 3;

          // Verify metrics are reasonable
          if (finalMetrics.totalReductions > 0) {
            details.push("Reductions occurred");
            score += 3;
          }

          if (typeof finalMetrics.averageReductionMs === "number") {
            details.push(
              `averageReductionMs = ${finalMetrics.averageReductionMs.toFixed(2)}`,
            );
            score += 3;
          }

          // Drain effects
          const effects = scheduler.drainEffects();
          if (Array.isArray(effects)) {
            details.push(`Drained ${effects.length} effect(s)`);
            score += 3;
          }

          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
