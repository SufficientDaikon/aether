// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 04: Escalation Chain
// Registers a hierarchy, simulates a worker failure, verifies
// escalation to the manager, then calls Gemini for the manager
// attempt and validates the response.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

import { AgentRegistry } from "../../core/registry.ts";
import { EscalationManager } from "../../core/escalation.ts";
import { SQLiteStore } from "../../core/storage/sqlite-store.ts";
import {
  REACT_SPECIALIST,
  SYSTEM_ARCHITECT,
  CORTEX,
  registerFullHierarchy,
} from "../helpers/agent-fixtures.ts";

export async function run(
  harness: TestHarness,
  gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.04",
    "Escalation Chain — worker failure triggers manager",
    async () => {
      try {
        // Set up store and registry
        const tmpDir = `.aether/eval-phase5-04-${Date.now()}`;
        const store = new SQLiteStore(tmpDir);
        await store.init();

        const registry = new AgentRegistry(store);
        registerFullHierarchy(registry);

        // Create escalation manager with generous thresholds
        const escalation = new EscalationManager(registry, {
          threshold: 5,
          windowMs: 300_000,
          store,
        });

        let score = 0;
        const details: string[] = [];

        // Simulate: react-specialist fails on a task
        const workerFailure = escalation.escalate(
          "react-specialist",
          "Worker could not generate valid component: syntax error in output",
          3 as 3,
        );

        // Verify escalation targets system-architect (the react-specialist's escalation target)
        if (workerFailure.target?.id === "system-architect") {
          score += 3;
          details.push(
            `Worker escalation correctly targeted "${workerFailure.target.id}" (${workerFailure.target.tier}).`,
          );
        } else {
          details.push(
            `Worker escalation went to "${workerFailure.target?.id ?? "null"}" instead of "system-architect".`,
          );
        }

        // Verify circuit is NOT broken after single failure
        if (!workerFailure.circuitBroken) {
          score += 2;
          details.push(
            "Circuit breaker correctly remained closed after 1 failure.",
          );
        } else {
          details.push("Circuit breaker unexpectedly tripped after 1 failure.");
        }

        // Now call Gemini as the manager agent to handle the escalated task
        const managerStart = Date.now();
        const managerResponse = await gemini.send(
          "You are a system architect. A junior React specialist failed to create " +
            "a counter component due to a syntax error. Please create a working React " +
            "counter component with TypeScript, useState, increment and decrement buttons. " +
            "Keep it concise.",
          {
            model: "gemini-2.5-flash",
            maxTokens: 500,
            systemPrompt:
              "You are a senior system architect handling an escalated task from a failed worker agent.",
          },
        );
        const managerLatency = Date.now() - managerStart;

        // Verify manager response contains code
        const hasCode =
          managerResponse.content.includes("useState") ||
          managerResponse.content.includes("function") ||
          managerResponse.content.includes("const") ||
          managerResponse.content.includes("component");

        if (managerResponse.content.length > 50 && hasCode) {
          score += 3;
          details.push(
            `Manager (Gemini) produced a valid response: ${managerResponse.content.length} chars, ${managerLatency}ms.`,
          );
        } else {
          details.push(
            `Manager (Gemini) response was insufficient: ${managerResponse.content.length} chars.`,
          );
        }

        // Verify recommendation string is meaningful
        if (
          workerFailure.recommendation &&
          workerFailure.recommendation.length > 10
        ) {
          score += 2;
          details.push(
            `Escalation recommendation: "${workerFailure.recommendation.slice(0, 120)}"`,
          );
        } else {
          details.push("Escalation recommendation was empty or too short.");
        }

        // Cap at 10
        score = Math.min(score, 10);

        // Clean up
        await store.close();

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            escalationTarget: workerFailure.target?.id ?? null,
            circuitBroken: workerFailure.circuitBroken,
            recommendation: workerFailure.recommendation,
            managerLatencyMs: managerLatency,
            managerTokens: managerResponse.tokensUsed,
            managerResponsePreview: managerResponse.content.slice(0, 300),
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Escalation chain test failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
