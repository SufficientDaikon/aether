// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: EscalationManager Circuit Breaker Under Load
// Register 20 agents, rapid-fire escalation calls, verify circuit
// breakers trip correctly and not all at once
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.5",
    "EscalationManager -- Circuit breakers under rapid-fire load (20 agents)",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { EscalationManager } = await import("../../core/escalation.ts");
        const { makeAgent } = await import("../helpers/agent-fixtures.ts");

        const registry = new AgentRegistry();

        // Register a manager agent (escalation target)
        const manager = makeAgent({
          id: "stress-manager",
          name: "Stress Manager",
          tier: "manager",
          sections: ["BACKEND"],
          capabilities: ["management"],
          escalationTarget: null,
        });
        registry.register(manager);

        // Register 20 worker agents
        const AGENT_COUNT = 20;
        const agentIds: string[] = [];
        for (let i = 0; i < AGENT_COUNT; i++) {
          const agent = makeAgent({
            id: `stress-worker-${i}`,
            name: `Stress Worker ${i}`,
            tier: "worker",
            sections: ["TOOLS"],
            capabilities: ["stress-test"],
            escalationTarget: "stress-manager",
          });
          registry.register(agent);
          agentIds.push(agent.id);
        }
        details.push(`Registered ${AGENT_COUNT} worker agents + 1 manager`);
        score += 1;

        // Create escalation manager with threshold=3 per agent
        const escalation = new EscalationManager(registry, {
          threshold: 3,
          windowMs: 60_000,
        });
        details.push("EscalationManager created with threshold=3");
        score += 1;

        // Rapid-fire: each agent escalates 5 times
        const ESCALATIONS_PER_AGENT = 5;
        let totalEscalations = 0;
        let totalCircuitBroken = 0;
        let totalSuccessful = 0;
        const brokenAgents = new Set<string>();

        for (let round = 0; round < ESCALATIONS_PER_AGENT; round++) {
          for (const agentId of agentIds) {
            const result = escalation.escalate(
              agentId,
              `Stress failure round ${round}`,
              3,
            );
            totalEscalations++;

            if (result.circuitBroken) {
              totalCircuitBroken++;
              brokenAgents.add(agentId);
            } else if (result.target) {
              totalSuccessful++;
            }
          }
        }

        details.push(
          `Fired ${totalEscalations} escalations: ${totalSuccessful} succeeded, ${totalCircuitBroken} circuit-broken`,
        );

        // Each agent should trip after 3 escalations.
        // So escalations 1,2 succeed (target returned) and 3,4,5 are circuit broken
        // Expected: 2 * 20 = 40 successful, 3 * 20 = 60 circuit broken

        // Verify circuit breakers tripped for all agents
        if (brokenAgents.size === AGENT_COUNT) {
          score += 3;
          details.push(
            `All ${AGENT_COUNT} agents had their circuit breakers trip`,
          );
        } else if (brokenAgents.size > AGENT_COUNT * 0.8) {
          score += 2;
          details.push(
            `${brokenAgents.size}/${AGENT_COUNT} agents tripped (>80%)`,
          );
        } else {
          score += 1;
          details.push(
            `Only ${brokenAgents.size}/${AGENT_COUNT} agents tripped`,
          );
        }

        // Verify they didn't all trip at the same time
        // (i.e., some escalations should have succeeded before tripping)
        if (totalSuccessful > 0 && totalCircuitBroken > 0) {
          score += 2;
          details.push(
            "Mix of successful and circuit-broken escalations (correct phased tripping)",
          );
        } else {
          details.push(
            "All escalations were either all successful or all broken (unexpected)",
          );
        }

        // Verify stats
        const stats = escalation.getStats();
        details.push(
          `Stats: totalEscalations=${stats.totalEscalations}, circuitsBroken=${stats.circuitsBroken}`,
        );

        if (stats.circuitsBroken === AGENT_COUNT) {
          score += 1;
          details.push("All circuits reported broken in stats");
        }

        // Reset one agent and verify it works again
        escalation.resetCircuit("stress-worker-0");
        const afterReset = escalation.escalate(
          "stress-worker-0",
          "Post-reset test",
          3,
        );
        if (!afterReset.circuitBroken && afterReset.target) {
          score += 2;
          details.push("After resetCircuit, agent can escalate again");
        } else {
          details.push(
            `Post-reset: circuitBroken=${afterReset.circuitBroken}, target=${afterReset.target?.id ?? "null"}`,
          );
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        score,
        maxScore,
        details: details.join("; "),
        metadata: { test: "circuit-breaker-load" },
      };
    },
  );
}
