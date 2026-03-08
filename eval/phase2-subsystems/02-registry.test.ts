// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: AgentRegistry Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import {
  makeAgent,
  registerFullHierarchy,
  CORTEX,
  SYSTEM_ARCHITECT,
  REACT_SPECIALIST,
  DB_ARCHITECT,
  ALL_AGENTS,
} from "../helpers/agent-fixtures.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.2.1: Register All Fixture Agents ─────────────────
  await harness.runTest(
    "2.2.1",
    "AgentRegistry — Register all fixture agents",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const registry = new AgentRegistry();

        registerFullHierarchy(registry);

        const all = registry.getAll();
        if (all.length === ALL_AGENTS.length) {
          details.push(`Registered all ${all.length} fixture agents`);
          score += 5;
        } else {
          details.push(`Registered ${all.length}/${ALL_AGENTS.length} agents`);
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

  // ── Test 2.2.2: findBySection ─────────────────────────────
  await harness.runTest("2.2.2", "AgentRegistry — findBySection", async () => {
    let score = 0;
    const maxScore = 5;
    const details: string[] = [];

    try {
      const { AgentRegistry } = await import("../../core/registry.ts");
      const registry = new AgentRegistry();
      registerFullHierarchy(registry);

      const frontendAgents = registry.findBySection("FRONTEND");
      if (Array.isArray(frontendAgents) && frontendAgents.length >= 1) {
        details.push(
          `findBySection('FRONTEND') returned ${frontendAgents.length} agent(s)`,
        );
        score += 3;

        // Check that known frontend agents are present
        const ids = frontendAgents.map((a) => a.id);
        if (ids.includes("react-specialist")) {
          details.push("react-specialist found in FRONTEND section");
          score += 2;
        } else {
          details.push("react-specialist NOT found in FRONTEND section");
        }
      } else {
        details.push("findBySection returned no agents for FRONTEND");
      }

      // Check META section
      const metaAgents = registry.findBySection("META");
      if (Array.isArray(metaAgents) && metaAgents.length >= 1) {
        details.push(
          `findBySection('META') returned ${metaAgents.length} agent(s)`,
        );
      }
    } catch (err) {
      details.push(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { score, maxScore, details: details.join("; ") };
  });

  // ── Test 2.2.3: findByCapability ──────────────────────────
  await harness.runTest(
    "2.2.3",
    "AgentRegistry — findByCapability",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        // Search for a capability
        const reactAgents = registry.findByCapability("react");
        if (Array.isArray(reactAgents) && reactAgents.length >= 1) {
          details.push(
            `findByCapability('react') returned ${reactAgents.length} agent(s)`,
          );
          score += 3;
        } else {
          details.push("findByCapability('react') returned no agents");
        }

        // Fuzzy match: "sql" should match postgresql agent
        const sqlAgents = registry.findByCapability("sql");
        if (Array.isArray(sqlAgents) && sqlAgents.length >= 1) {
          details.push(
            `findByCapability('sql') returned ${sqlAgents.length} agent(s) (fuzzy match)`,
          );
          score += 2;
        } else {
          details.push("findByCapability('sql') returned no agents");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.2.4: findByTier ────────────────────────────────
  await harness.runTest("2.2.4", "AgentRegistry — findByTier", async () => {
    let score = 0;
    const maxScore = 5;
    const details: string[] = [];

    try {
      const { AgentRegistry } = await import("../../core/registry.ts");
      const registry = new AgentRegistry();
      registerFullHierarchy(registry);

      const workers = registry.findByTier("worker");
      if (Array.isArray(workers) && workers.length >= 1) {
        details.push(
          `findByTier('worker') returned ${workers.length} worker(s)`,
        );
        score += 2;
      } else {
        details.push("findByTier('worker') returned no workers");
      }

      const masters = registry.findByTier("master");
      if (Array.isArray(masters) && masters.length >= 1) {
        details.push(
          `findByTier('master') returned ${masters.length} master(s)`,
        );
        score += 2;
      } else {
        details.push("findByTier('master') returned no masters");
      }

      // Verify workers are more numerous than masters
      if (workers.length > masters.length) {
        details.push("More workers than masters (correct hierarchy)");
        score += 1;
      }
    } catch (err) {
      details.push(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { score, maxScore, details: details.join("; ") };
  });

  // ── Test 2.2.5: resolve (prefer idle) ─────────────────────
  await harness.runTest(
    "2.2.5",
    "AgentRegistry — resolve prefers idle agents",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        // Resolve a capability
        const resolved = registry.resolve("react-components");
        if (resolved) {
          details.push(`resolve('react-components') returned ${resolved.id}`);
          score += 2;

          // The resolved agent should be idle
          if (resolved.status === "idle") {
            details.push("Resolved agent is idle");
            score += 1;
          }
        } else {
          details.push("resolve returned undefined");
        }

        // Make the react-specialist busy and resolve again
        registry.updateStatus("react-specialist", "busy");
        const resolved2 = registry.resolve("react-components");
        if (resolved2) {
          details.push(
            `After making react-specialist busy, resolve returned ${resolved2.id}`,
          );
          // Should still work but may return a different or same agent
          score += 2;
        } else {
          details.push("resolve returned undefined after status change");
          score += 1;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.2.6: Escalation Chain Walking ──────────────────
  await harness.runTest(
    "2.2.6",
    "AgentRegistry — Escalation chain (worker -> manager -> master)",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        // Walk chain from react-specialist: should go to system-architect, then cortex-0
        const chain = registry.getEscalationChain("react-specialist");
        if (Array.isArray(chain) && chain.length >= 1) {
          details.push(
            `Escalation chain from react-specialist has ${chain.length} step(s)`,
          );
          score += 2;

          const chainIds = chain.map((a) => a.id);
          if (chainIds.includes("system-architect")) {
            details.push("Chain includes system-architect (manager)");
            score += 1;
          }
          if (chainIds.includes("cortex-0")) {
            details.push("Chain includes cortex-0 (master)");
            score += 1;
          }

          // Verify order: system-architect before cortex-0
          const archIdx = chainIds.indexOf("system-architect");
          const cortexIdx = chainIds.indexOf("cortex-0");
          if (archIdx >= 0 && cortexIdx >= 0 && archIdx < cortexIdx) {
            details.push("Chain order correct: manager before master");
            score += 1;
          }
        } else {
          details.push("getEscalationChain returned empty chain");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.2.7: Duplicate ID Rejection ────────────────────
  await harness.runTest(
    "2.2.7",
    "AgentRegistry — Duplicate ID rejection",
    async () => {
      let score = 0;
      const maxScore = 3;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const registry = new AgentRegistry();

        const agent = makeAgent({ id: "dup-test-agent" });
        registry.register(agent);
        details.push("First registration succeeded");
        score += 1;

        // Second registration with same ID should throw
        try {
          registry.register(makeAgent({ id: "dup-test-agent" }));
          details.push("ERROR: Duplicate registration did NOT throw");
        } catch (dupErr) {
          details.push("Duplicate registration correctly threw error");
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

  // ── Test 2.2.8: Unregister Removes from All Indexes ──────
  await harness.runTest(
    "2.2.8",
    "AgentRegistry — Unregister removes from all indexes",
    async () => {
      let score = 0;
      const maxScore = 2;
      const details: string[] = [];

      try {
        const { AgentRegistry } = await import("../../core/registry.ts");
        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        const countBefore = registry.getAll().length;

        // Unregister react-specialist
        const removed = registry.unregister("react-specialist");
        if (removed === true) {
          details.push("unregister returned true");
          score += 1;
        }

        // Verify it's gone from all lookups
        const countAfter = registry.getAll().length;
        const bySection = registry.findBySection("FRONTEND");
        const byCap = registry.findByCapability("react-components");
        const byTier = registry.findByTier("worker");
        const get = registry.get("react-specialist");

        const notInSection = !bySection.some(
          (a) => a.id === "react-specialist",
        );
        const notInCap = !byCap.some((a) => a.id === "react-specialist");
        const notInTier = !byTier.some((a) => a.id === "react-specialist");
        const notInGet = !get;

        if (
          countAfter === countBefore - 1 &&
          notInSection &&
          notInCap &&
          notInTier &&
          notInGet
        ) {
          details.push("Agent fully removed from all indexes");
          score += 1;
        } else {
          details.push(
            `Partial removal: count=${countAfter}/${countBefore - 1}, section=${notInSection}, cap=${notInCap}, tier=${notInTier}, get=${notInGet}`,
          );
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
