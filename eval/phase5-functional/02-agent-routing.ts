// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 02: Agent Routing
// Verify that AgentRouter picks the correct specialist agent
// for different task descriptions using token-based capability
// scoring. No LLM calls needed — routing is purely local.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

import { AgentRegistry } from "../../core/registry.ts";
import { AgentRouter } from "../../core/router.ts";
import { SQLiteStore } from "../../core/storage/sqlite-store.ts";
import {
  REACT_SPECIALIST,
  DB_ARCHITECT,
  SYSTEM_ARCHITECT,
  UX_PSYCHOLOGIST,
  registerFullHierarchy,
} from "../helpers/agent-fixtures.ts";

export async function run(
  harness: TestHarness,
  _gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.02",
    "Agent Routing — correct specialist selection",
    async () => {
      try {
        // Set up an in-memory SQLite store for the router
        const tmpDir = `.aether/eval-phase5-02-${Date.now()}`;
        const store = new SQLiteStore(tmpDir);
        await store.init();

        // Create registry and register all fixture agents
        const registry = new AgentRegistry(store);
        registerFullHierarchy(registry);

        // Create router with token-based scoring (no RAG index)
        const router = new AgentRouter(store, 0.1);

        // Get all available agents for routing
        const allAgents = registry
          .getAll()
          .filter((a) => a.status !== "offline");

        // Test case 1: React component task -> react-specialist
        const reactDecision = await router.resolve(
          "Create a React counter component with useState hooks",
          allAgents,
        );

        // Test case 2: PostgreSQL schema task -> postgres-db-architect
        const dbDecision = await router.resolve(
          "Design a PostgreSQL schema for a blog with posts and comments",
          allAgents,
        );

        let score = 0;
        const details: string[] = [];

        // Evaluate React routing
        if (reactDecision?.agent.id === "react-specialist") {
          score += 5;
          details.push(
            `React task routed to "${reactDecision.agent.id}" (confidence: ${reactDecision.confidence.toFixed(2)}, strategy: ${reactDecision.strategy}) -- CORRECT`,
          );
        } else {
          const got = reactDecision?.agent.id ?? "null";
          details.push(
            `React task routed to "${got}" instead of "react-specialist" -- WRONG`,
          );
        }

        // Evaluate DB routing
        if (dbDecision?.agent.id === "postgres-db-architect") {
          score += 5;
          details.push(
            `DB task routed to "${dbDecision.agent.id}" (confidence: ${dbDecision.confidence.toFixed(2)}, strategy: ${dbDecision.strategy}) -- CORRECT`,
          );
        } else {
          const got = dbDecision?.agent.id ?? "null";
          details.push(
            `DB task routed to "${got}" instead of "postgres-db-architect" -- WRONG`,
          );
        }

        // Clean up
        store.close();

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            reactRoute: reactDecision
              ? {
                  agentId: reactDecision.agent.id,
                  confidence: reactDecision.confidence,
                  strategy: reactDecision.strategy,
                  reason: reactDecision.reason,
                }
              : null,
            dbRoute: dbDecision
              ? {
                  agentId: dbDecision.agent.id,
                  confidence: dbDecision.confidence,
                  strategy: dbDecision.strategy,
                  reason: dbDecision.reason,
                }
              : null,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Agent routing test failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
