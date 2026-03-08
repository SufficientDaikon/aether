// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: SystemSentinel Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { registerFullHierarchy } from "../helpers/agent-fixtures.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.26.1: getSwarmHealth and runHealthCheck ───────────
  await harness.runTest(
    "2.26.1",
    "SystemSentinel — Swarm health and health check",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { SystemSentinel } = await import("../../core/sentinel.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { TierRegistry } = await import("../../core/tier-registry.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));

        try {
          const registry = new AgentRegistry();
          registerFullHierarchy(registry);
          const tierRegistry = TierRegistry.builtinTiers();

          const sentinel = new SystemSentinel(registry, tierRegistry, logger);
          details.push("SystemSentinel created");
          score += 1;

          // Get swarm health
          const health = sentinel.getSwarmHealth();

          if (health.agentCount > 0) {
            details.push(`Agent count: ${health.agentCount}`);
            score += 1;
          }

          if (
            typeof health.byTier === "object" &&
            Object.keys(health.byTier).length > 0
          ) {
            details.push(`Tiers: ${JSON.stringify(health.byTier)}`);
            score += 1;
          }

          if (typeof health.byStatus === "object") {
            details.push(`Statuses: ${JSON.stringify(health.byStatus)}`);
            score += 1;
          }

          if (health.healthScore >= 0 && health.healthScore <= 100) {
            details.push(`Health score: ${health.healthScore}`);
            score += 1;
          }

          // Run health check
          const checkResult = sentinel.runHealthCheck();
          if (typeof checkResult.healthy === "boolean") {
            details.push(`Healthy: ${checkResult.healthy}`);
            score += 2;
          }

          if (typeof checkResult.score === "number") {
            details.push(`Check score: ${checkResult.score}`);
            score += 1;
          }

          if (
            Array.isArray(checkResult.issues) &&
            Array.isArray(checkResult.recommendations)
          ) {
            details.push(
              `Issues: ${checkResult.issues.length}, Recommendations: ${checkResult.recommendations.length}`,
            );
            score += 2;
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

  // ── Test 2.26.2: Force kill, pause/resume ────────────────────
  await harness.runTest(
    "2.26.2",
    "SystemSentinel — Force kill, pause, and resume",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { SystemSentinel } = await import("../../core/sentinel.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { TierRegistry } = await import("../../core/tier-registry.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));

        try {
          const registry = new AgentRegistry();
          registerFullHierarchy(registry);
          const tierRegistry = TierRegistry.builtinTiers();

          const sentinel = new SystemSentinel(registry, tierRegistry, logger);

          // Force kill an agent
          const targetAgent = "react-specialist";
          sentinel.forceKillAgent(targetAgent, "Agent is stuck in a loop");

          const agentAfterKill = registry.get(targetAgent);
          if (agentAfterKill && agentAfterKill.status === "error") {
            details.push(`${targetAgent} force-killed to error state`);
            score += 3;
          }

          // Facts ledger should have an entry
          const facts = sentinel.getFactsLedger();
          if (facts.length >= 1) {
            details.push(`Facts ledger has ${facts.length} entry(ies)`);
            score += 1;
          }

          // Pause swarm
          sentinel.pauseSwarm("Emergency maintenance");
          if (sentinel.isPaused()) {
            details.push("Swarm paused");
            score += 2;
          }

          // Non-sentinel agents should be offline
          const workers = registry.getAll().filter((a) => a.tier === "worker");
          const allOffline = workers.every(
            (a) => a.status === "offline" || a.status === "error",
          );
          if (allOffline) {
            details.push("Non-sentinel agents set to offline");
            score += 1;
          }

          // Resume swarm
          sentinel.resumeSwarm();
          if (!sentinel.isPaused()) {
            details.push("Swarm resumed");
            score += 2;
          }

          // Workers should be back to idle
          const workersAfter = registry
            .getAll()
            .filter((a) => a.tier === "worker");
          const someIdle = workersAfter.some((a) => a.status === "idle");
          if (someIdle) {
            details.push("Some workers restored to idle");
            score += 1;
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
