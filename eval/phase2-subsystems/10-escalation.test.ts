// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: EscalationManager Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import {
  registerFullHierarchy,
  REACT_SPECIALIST,
  SYSTEM_ARCHITECT,
} from "../helpers/agent-fixtures.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.10.1: Escalation from worker to manager ────────
  await harness.runTest(
    "2.10.1",
    "EscalationManager — Escalation from worker to manager",
    async () => {
      let score = 0;
      const maxScore = 15;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { EscalationManager } = await import("../../core/escalation.ts");

        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        const escalationMgr = new EscalationManager(registry, {
          threshold: 5,
          windowMs: 300_000,
        });
        details.push("EscalationManager created with threshold=5");
        score += 3;

        // Escalate from react-specialist (worker) with normal priority
        const result = escalationMgr.escalate(
          "react-specialist",
          "Cannot handle complex architecture task",
          3,
        );
        details.push(
          `Escalation result: target=${result.target?.id ?? "null"}, circuitBroken=${result.circuitBroken}`,
        );

        if (result.target) {
          details.push(
            `Escalation target: ${result.target.id} (tier: ${result.target.tier})`,
          );
          score += 4;

          // Worker should escalate to its manager (system-architect)
          if (result.target.id === "system-architect") {
            details.push("Correctly escalated to system-architect (manager)");
            score += 4;
          } else {
            details.push(`Expected system-architect, got ${result.target.id}`);
            score += 2;
          }
        } else {
          details.push("No escalation target returned");
        }

        if (!result.circuitBroken) {
          details.push(
            "Circuit breaker not tripped (correct for first escalation)",
          );
          score += 2;
        }

        if (result.recommendation && result.recommendation.length > 0) {
          details.push(`Recommendation: ${result.recommendation.slice(0, 80)}`);
          score += 2;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.10.2: Circuit breaker trips after threshold ────
  await harness.runTest(
    "2.10.2",
    "EscalationManager — Circuit breaker trips after threshold",
    async () => {
      let score = 0;
      const maxScore = 15;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { EscalationManager } = await import("../../core/escalation.ts");

        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        // Low threshold to trip quickly
        const escalationMgr = new EscalationManager(registry, {
          threshold: 3,
          windowMs: 300_000,
        });

        // First escalation: should succeed
        const r1 = escalationMgr.escalate("react-specialist", "Reason 1", 3);
        if (r1.target && !r1.circuitBroken) {
          details.push("Escalation 1: succeeded, circuit not broken");
          score += 2;
        }

        // Second escalation: should succeed
        const r2 = escalationMgr.escalate("react-specialist", "Reason 2", 3);
        if (r2.target && !r2.circuitBroken) {
          details.push("Escalation 2: succeeded, circuit not broken");
          score += 2;
        }

        // Third escalation: should trip the circuit breaker (threshold = 3)
        const r3 = escalationMgr.escalate("react-specialist", "Reason 3", 3);
        if (r3.circuitBroken) {
          details.push("Escalation 3: circuit breaker TRIPPED");
          score += 4;
        } else {
          details.push(
            `Escalation 3: circuitBroken=${r3.circuitBroken} (expected true)`,
          );
          score += 1;
        }

        // Fourth escalation: should be blocked by circuit breaker
        const r4 = escalationMgr.escalate("react-specialist", "Reason 4", 3);
        if (r4.circuitBroken && !r4.target) {
          details.push("Escalation 4: blocked by open circuit breaker");
          score += 3;
        } else {
          details.push(
            `Escalation 4: target=${r4.target?.id ?? "null"}, circuitBroken=${r4.circuitBroken}`,
          );
        }

        // Check isCircuitBroken
        const isBroken = escalationMgr.isCircuitBroken("react-specialist");
        if (isBroken) {
          details.push("isCircuitBroken returns true");
          score += 2;
        }

        // Reset the circuit
        escalationMgr.resetCircuit("react-specialist");
        const isReset = escalationMgr.isCircuitBroken("react-specialist");
        if (!isReset) {
          details.push("resetCircuit successfully re-closes the circuit");
          score += 2;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
