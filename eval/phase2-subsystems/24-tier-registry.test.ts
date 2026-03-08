// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: TierRegistry Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.24.1: Register tiers and check rank ordering ──────
  await harness.runTest(
    "2.24.1",
    "TierRegistry — Register and rank ordering",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { TierRegistry } = await import("../../core/tier-registry.ts");

        const registry = new TierRegistry();
        details.push("TierRegistry created");
        score += 1;

        // Register custom tiers
        registry.register({
          name: "supreme",
          rank: 0,
          maxAgents: 1,
          model: { provider: "claude", model: "opus" },
          escalation: { targets: [], gatePolicy: "open" },
          weights: { conflict: 10, ragBoost: 2.5, costMultiplier: 20 },
        });

        registry.register({
          name: "commander",
          rank: 1,
          maxAgents: 2,
          model: { provider: "claude", model: "sonnet" },
          escalation: { targets: ["supreme"], gatePolicy: "open" },
          weights: { conflict: 5, ragBoost: 1.5, costMultiplier: 10 },
        });

        registry.register({
          name: "operative",
          rank: 2,
          maxAgents: 10,
          model: { provider: "claude", model: "haiku" },
          escalation: { targets: ["commander"], gatePolicy: "open" },
          weights: { conflict: 1, ragBoost: 1.0, costMultiplier: 1 },
        });

        if (registry.size === 3) {
          details.push("3 tiers registered");
          score += 2;
        }

        // Check rank ordering
        const byRank = registry.getByRank();
        if (
          byRank[0].name === "supreme" &&
          byRank[1].name === "commander" &&
          byRank[2].name === "operative"
        ) {
          details.push(
            "Rank ordering correct: supreme > commander > operative",
          );
          score += 3;
        }

        // isHigherThan checks
        if (registry.isHigherThan("supreme", "commander")) {
          details.push("supreme is higher than commander");
          score += 1;
        }

        if (registry.isHigherThan("commander", "operative")) {
          details.push("commander is higher than operative");
          score += 1;
        }

        if (!registry.isHigherThan("operative", "supreme")) {
          details.push("operative is NOT higher than supreme");
          score += 1;
        }

        // getRank
        if (registry.getRank("supreme") === 0) {
          details.push("supreme rank: 0");
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

  // ── Test 2.24.2: Escalation gate policies ────────────────────
  await harness.runTest(
    "2.24.2",
    "TierRegistry — Escalation gate policies",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { TierRegistry } = await import("../../core/tier-registry.ts");

        const registry = TierRegistry.builtinTiers();
        details.push(`Builtin tiers loaded: ${registry.size} tiers`);
        score += 1;

        // Worker can escalate to manager (open policy)
        if (registry.canEscalateTo("worker", "manager", 1)) {
          details.push("worker -> manager: allowed (open)");
          score += 1;
        }

        // Manager can escalate to master only with sufficient priority
        // master has gatePolicy: "priority", minPriority: 4
        if (!registry.canEscalateTo("manager", "master", 2)) {
          details.push("manager -> master: blocked at priority 2 (needs 4)");
          score += 1;
        }

        if (registry.canEscalateTo("manager", "master", 4)) {
          details.push("manager -> master: allowed at priority 4");
          score += 1;
        }

        // Worker cannot escalate directly to sentinel (not in targets)
        if (!registry.canEscalateTo("worker", "sentinel", 5)) {
          details.push("worker -> sentinel: blocked (not in targets)");
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

  // ── Test 2.24.3: builtinTiers() and classicTiers() factories ─
  await harness.runTest(
    "2.24.3",
    "TierRegistry — builtinTiers and classicTiers factories",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { TierRegistry } = await import("../../core/tier-registry.ts");

        // builtinTiers has 5 tiers
        const builtin = TierRegistry.builtinTiers();
        if (builtin.size === 5) {
          details.push("builtinTiers: 5 tiers");
          score += 1;
        }

        const builtinNames = builtin.getNames();
        if (
          builtinNames.includes("sentinel") &&
          builtinNames.includes("forge") &&
          builtinNames.includes("master") &&
          builtinNames.includes("manager") &&
          builtinNames.includes("worker")
        ) {
          details.push("All 5 builtin tier names present");
          score += 1;
        }

        // classicTiers has 3 tiers
        const classic = TierRegistry.classicTiers();
        if (classic.size === 3) {
          details.push("classicTiers: 3 tiers");
          score += 1;
        }

        const classicNames = classic.getNames();
        if (
          classicNames.includes("master") &&
          classicNames.includes("manager") &&
          classicNames.includes("worker")
        ) {
          details.push("Classic tiers: master, manager, worker");
          score += 1;
        }

        // Validation should pass for builtin
        const errors = builtin.validate();
        if (errors.length === 0) {
          details.push("Builtin tiers validate without errors");
          score += 1;
        } else {
          details.push(`Validation errors: ${errors.join("; ")}`);
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
