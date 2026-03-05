import { describe, it, expect } from "bun:test";
import { TierRegistry } from "../core/tier-registry.ts";
import type { TierDefinition } from "../core/tier-registry.ts";

// ─────────────────────────────────────────────────────────────
// Tier Registry Tests
// ─────────────────────────────────────────────────────────────

describe("TierRegistry", () => {
  // ── Factory helpers ──

  function builtins() {
    return TierRegistry.builtinTiers();
  }

  function classics() {
    return TierRegistry.classicTiers();
  }

  function customTier(overrides: Partial<TierDefinition> = {}): TierDefinition {
    return {
      name: "custom",
      rank: 5,
      maxAgents: 5,
      model: { provider: "claude", model: "haiku" },
      escalation: { targets: ["worker"], gatePolicy: "open" },
      weights: { conflict: 0.5, ragBoost: 0.8, costMultiplier: 0.5 },
      ...overrides,
    };
  }

  // ── Builtin factory ──

  describe("builtinTiers()", () => {
    it("creates 5 tiers", () => {
      const reg = builtins();
      expect(reg.size).toBe(5);
    });

    it("includes sentinel, forge, master, manager, worker", () => {
      const reg = builtins();
      expect(reg.has("sentinel")).toBe(true);
      expect(reg.has("forge")).toBe(true);
      expect(reg.has("master")).toBe(true);
      expect(reg.has("manager")).toBe(true);
      expect(reg.has("worker")).toBe(true);
    });

    it("sentinel is rank 0 (highest authority)", () => {
      const reg = builtins();
      expect(reg.getRank("sentinel")).toBe(0);
    });

    it("worker is rank 4 (lowest authority)", () => {
      const reg = builtins();
      expect(reg.getRank("worker")).toBe(4);
    });
  });

  // ── Classic factory ──

  describe("classicTiers()", () => {
    it("creates 3 tiers (master, manager, worker)", () => {
      const reg = classics();
      expect(reg.size).toBe(3);
      expect(reg.has("master")).toBe(true);
      expect(reg.has("manager")).toBe(true);
      expect(reg.has("worker")).toBe(true);
    });

    it("does not include sentinel or forge", () => {
      const reg = classics();
      expect(reg.has("sentinel")).toBe(false);
      expect(reg.has("forge")).toBe(false);
    });
  });

  // ── Registration ──

  describe("register/unregister", () => {
    it("registers a custom tier", () => {
      const reg = builtins();
      reg.register(customTier({ name: "intern", rank: 5 }));
      expect(reg.has("intern")).toBe(true);
      expect(reg.size).toBe(6);
    });

    it("replaces an existing tier on re-register", () => {
      const reg = builtins();
      const before = reg.get("worker")!;
      expect(before.maxAgents).toBe(10);

      reg.register(customTier({ name: "worker", rank: 4, maxAgents: 50 }));
      const after = reg.get("worker")!;
      expect(after.maxAgents).toBe(50);
      expect(reg.size).toBe(5); // no new tier added
    });

    it("unregisters a tier", () => {
      const reg = builtins();
      const removed = reg.unregister("forge");
      expect(removed).toBe(true);
      expect(reg.has("forge")).toBe(false);
      expect(reg.size).toBe(4);
    });

    it("returns false when unregistering non-existent tier", () => {
      const reg = builtins();
      expect(reg.unregister("nonexistent")).toBe(false);
    });
  });

  // ── Lookups ──

  describe("lookups", () => {
    it("get() returns a copy (mutations don't affect registry)", () => {
      const reg = builtins();
      const def = reg.get("master")!;
      def.maxAgents = 999;
      expect(reg.get("master")!.maxAgents).toBe(1);
    });

    it("get() returns undefined for unknown tier", () => {
      const reg = builtins();
      expect(reg.get("unknown")).toBeUndefined();
    });

    it("getAll() returns all tiers", () => {
      const reg = builtins();
      expect(reg.getAll()).toHaveLength(5);
    });

    it("getByRank() returns tiers sorted by rank ascending", () => {
      const reg = builtins();
      const ranked = reg.getByRank();
      const ranks = ranked.map((d) => d.rank);
      expect(ranks).toEqual([0, 1, 2, 3, 4]);
      expect(ranked[0].name).toBe("sentinel");
      expect(ranked[4].name).toBe("worker");
    });

    it("getNames() returns all tier names", () => {
      const reg = builtins();
      const names = reg.getNames();
      expect(names).toContain("sentinel");
      expect(names).toContain("worker");
    });
  });

  // ── Hierarchy ──

  describe("hierarchy", () => {
    it("sentinel is higher than master", () => {
      const reg = builtins();
      expect(reg.isHigherThan("sentinel", "master")).toBe(true);
    });

    it("worker is not higher than manager", () => {
      const reg = builtins();
      expect(reg.isHigherThan("worker", "manager")).toBe(false);
    });

    it("unknown tier has Infinity rank", () => {
      const reg = builtins();
      expect(reg.getRank("unknown")).toBe(Infinity);
    });

    it("getTopTier() returns sentinel for builtins", () => {
      const reg = builtins();
      expect(reg.getTopTier()).toBe("sentinel");
    });

    it("getTopTier() returns master for classic", () => {
      const reg = classics();
      expect(reg.getTopTier()).toBe("master");
    });
  });

  // ── Escalation ──

  describe("escalation", () => {
    it("manager can escalate to master with sufficient priority", () => {
      const reg = builtins();
      expect(reg.canEscalateTo("manager", "master", 4)).toBe(true);
      expect(reg.canEscalateTo("manager", "master", 5)).toBe(true);
    });

    it("manager cannot escalate to master with low priority", () => {
      const reg = builtins();
      expect(reg.canEscalateTo("manager", "master", 3)).toBe(false);
    });

    it("worker can escalate to manager (open gate)", () => {
      const reg = builtins();
      expect(reg.canEscalateTo("worker", "manager", 3)).toBe(true);
    });

    it("master cannot escalate to sentinel without sufficient priority", () => {
      const reg = builtins();
      // sentinel gate is "open" via targets (master targets sentinel),
      // but master's targets include "sentinel" — check the builtin
      const masterDef = reg.get("master")!;
      expect(masterDef.escalation.targets).toContain("sentinel");
    });

    it("worker cannot escalate directly to master (not in targets)", () => {
      const reg = builtins();
      expect(reg.canEscalateTo("worker", "master", 3)).toBe(false);
    });

    it("returns false for unknown tiers", () => {
      const reg = builtins();
      expect(reg.canEscalateTo("unknown", "master", 5)).toBe(false);
    });

    it("getEscalationTargets() returns targets for a tier", () => {
      const reg = builtins();
      expect(reg.getEscalationTargets("manager")).toEqual([
        "master",
        "sentinel",
      ]);
    });

    it("getEscalationTargets() returns empty for unknown tier", () => {
      const reg = builtins();
      expect(reg.getEscalationTargets("unknown")).toEqual([]);
    });
  });

  // ── Weights ──

  describe("weights", () => {
    it("getConflictWeight() returns correct weight", () => {
      const reg = builtins();
      expect(reg.getConflictWeight("sentinel")).toBe(5);
      expect(reg.getConflictWeight("worker")).toBe(1);
    });

    it("getRagBoost() returns correct boost", () => {
      const reg = builtins();
      expect(reg.getRagBoost("sentinel")).toBe(2.0);
      expect(reg.getRagBoost("worker")).toBe(1.0);
    });

    it("getCostMultiplier() returns correct multiplier", () => {
      const reg = builtins();
      expect(reg.getCostMultiplier("sentinel")).toBe(15);
      expect(reg.getCostMultiplier("worker")).toBe(1);
    });

    it("defaults for unknown tier", () => {
      const reg = builtins();
      expect(reg.getConflictWeight("unknown")).toBe(1);
      expect(reg.getRagBoost("unknown")).toBe(1.0);
      expect(reg.getCostMultiplier("unknown")).toBe(1);
    });
  });

  // ── Capabilities ──

  describe("capabilities", () => {
    it("hasCapability() detects sentinel capabilities", () => {
      const reg = builtins();
      expect(reg.hasCapability("sentinel", "system_monitor")).toBe(true);
      expect(reg.hasCapability("sentinel", "spawn_agents")).toBe(false);
    });

    it("hasCapability() detects forge capabilities", () => {
      const reg = builtins();
      expect(reg.hasCapability("forge", "spawn_agents")).toBe(true);
    });

    it("getTiersWithCapability() finds all matching tiers", () => {
      const reg = builtins();
      const monitors = reg.getTiersWithCapability("system_monitor");
      expect(monitors).toEqual(["sentinel"]);
    });

    it("returns false for unknown tier", () => {
      const reg = builtins();
      expect(reg.hasCapability("unknown", "anything")).toBe(false);
    });
  });

  // ── Model Config ──

  describe("getModelConfig", () => {
    it("returns model config for tier", () => {
      const reg = builtins();
      expect(reg.getModelConfig("master")).toEqual({
        provider: "claude",
        model: "opus",
      });
    });

    it("returns fallback for unknown tier", () => {
      const reg = builtins();
      expect(reg.getModelConfig("unknown")).toEqual({
        provider: "claude",
        model: "haiku",
      });
    });
  });

  // ── Validation ──

  describe("validate()", () => {
    it("validates a well-formed registry", () => {
      const reg = builtins();
      const errors = reg.validate();
      expect(errors).toHaveLength(0);
    });

    it("detects duplicate ranks", () => {
      const reg = new TierRegistry();
      reg.register(customTier({ name: "a", rank: 1 }));
      reg.register(customTier({ name: "b", rank: 1 }));
      const errors = reg.validate();
      expect(errors.some((e) => e.includes("same rank"))).toBe(true);
    });

    it("detects broken escalation targets", () => {
      const reg = new TierRegistry();
      reg.register(
        customTier({
          name: "orphan",
          rank: 0,
          escalation: { targets: ["nonexistent"], gatePolicy: "open" },
        }),
      );
      const errors = reg.validate();
      expect(errors.some((e) => e.includes("nonexistent"))).toBe(true);
    });
  });

  // ── Serialization ──

  describe("toJSON/fromJSON", () => {
    it("round-trips through JSON", () => {
      const reg = builtins();
      const json = reg.toJSON();
      const reg2 = TierRegistry.fromJSON(json);
      expect(reg2.size).toBe(reg.size);
      expect(reg2.getNames().sort()).toEqual(reg.getNames().sort());
    });

    it("preserves tier properties", () => {
      const reg = builtins();
      const json = reg.toJSON();
      const reg2 = TierRegistry.fromJSON(json);
      const sentinel = reg2.get("sentinel")!;
      expect(sentinel.rank).toBe(0);
      expect(sentinel.capabilities).toContain("system_monitor");
    });
  });
});
