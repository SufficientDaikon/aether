import { describe, it, expect, beforeEach } from "bun:test";
import { EscalationManager } from "../core/escalation.ts";
import { AgentRegistry } from "../core/registry.ts";
import type { AgentDefinition, Priority } from "../core/types.ts";

// Helper to create agent definitions
function createAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    tier: "worker",
    sections: ["FRONTEND"],
    capabilities: ["react"],
    dependencies: [],
    llmRequirement: "haiku",
    format: "markdown",
    escalationTarget: null,
    filePath: "/agents/test.agent.md",
    status: "idle",
    metadata: {},
    ...overrides,
  };
}

describe("EscalationManager", () => {
  let registry: AgentRegistry;
  let escalation: EscalationManager;

  beforeEach(() => {
    registry = new AgentRegistry();

    // Register a hierarchy: worker -> manager -> master
    registry.register(
      createAgent({
        id: "master",
        name: "Master",
        tier: "master",
        escalationTarget: null,
      }),
    );
    registry.register(
      createAgent({
        id: "manager",
        name: "Manager",
        tier: "manager",
        escalationTarget: "master",
      }),
    );
    registry.register(
      createAgent({
        id: "worker",
        name: "Worker",
        tier: "worker",
        escalationTarget: "manager",
      }),
    );

    escalation = new EscalationManager(registry, {
      threshold: 3,
      windowMs: 5000,
    });
  });

  // ───────────────── escalate ─────────────────

  describe("escalate", () => {
    it("should escalate worker to manager", () => {
      const result = escalation.escalate("worker", "need help", 3);
      expect(result.target).toBeDefined();
      expect(result.target!.id).toBe("manager");
      expect(result.circuitBroken).toBe(false);
    });

    it("should escalate manager to master", () => {
      // Manager-tier agents are allowed to reach master
      const result = escalation.escalate("manager", "critical issue", 3);
      expect(result.target).toBeDefined();
      expect(result.target!.id).toBe("master");
      expect(result.circuitBroken).toBe(false);
    });

    it("should block after 3 escalations in 5 min (circuit breaker)", () => {
      escalation.escalate("worker", "reason 1", 2);
      escalation.escalate("worker", "reason 2", 2);
      // Third escalation hits the threshold
      const result = escalation.escalate("worker", "reason 3", 2);
      expect(result.circuitBroken).toBe(true);
      expect(result.target).toBeNull();
    });

    it("should allow escalation after circuit reset", () => {
      // Trip the circuit
      escalation.escalate("worker", "r1", 2);
      escalation.escalate("worker", "r2", 2);
      escalation.escalate("worker", "r3", 2);

      // Reset the circuit
      escalation.resetCircuit("worker");

      // Should work again
      const result = escalation.escalate("worker", "fresh start", 2);
      expect(result.circuitBroken).toBe(false);
      expect(result.target).toBeDefined();
      expect(result.target!.id).toBe("manager");
    });

    it("should return recommendation for unregistered agent", () => {
      const result = escalation.escalate("unknown-agent", "help", 3);
      expect(result.target).toBeNull();
      expect(result.recommendation).toContain("not registered");
    });
  });

  // ───────────────── shouldReachMaster ─────────────────

  describe("shouldReachMaster", () => {
    it("should allow priority 4+ from anyone", () => {
      expect(escalation.shouldReachMaster("worker", 4)).toBe(true);
      expect(escalation.shouldReachMaster("worker", 5)).toBe(true);
    });

    it("should allow manager-level escalations", () => {
      expect(escalation.shouldReachMaster("manager", 1)).toBe(true);
      expect(escalation.shouldReachMaster("manager", 2)).toBe(true);
      expect(escalation.shouldReachMaster("manager", 3)).toBe(true);
    });

    it("should block low-priority worker escalations", () => {
      expect(escalation.shouldReachMaster("worker", 1)).toBe(false);
      expect(escalation.shouldReachMaster("worker", 2)).toBe(false);
      expect(escalation.shouldReachMaster("worker", 3)).toBe(false);
    });
  });

  // ───────────────── circuit breaker ─────────────────

  describe("circuit breaker", () => {
    it("should trip after threshold exceeded", () => {
      escalation.escalate("worker", "a", 2);
      escalation.escalate("worker", "b", 2);
      escalation.escalate("worker", "c", 2);
      expect(escalation.isCircuitBroken("worker")).toBe(true);
    });

    it("should reset on manual reset", () => {
      escalation.escalate("worker", "a", 2);
      escalation.escalate("worker", "b", 2);
      escalation.escalate("worker", "c", 2);
      expect(escalation.isCircuitBroken("worker")).toBe(true);

      escalation.resetCircuit("worker");
      expect(escalation.isCircuitBroken("worker")).toBe(false);
    });

    it("should track per-agent", () => {
      // Register another worker
      registry.register(
        createAgent({
          id: "worker-2",
          tier: "worker",
          escalationTarget: "manager",
        }),
      );

      escalation.escalate("worker", "a", 2);
      escalation.escalate("worker", "b", 2);
      escalation.escalate("worker", "c", 2);

      // worker is tripped, worker-2 is not
      expect(escalation.isCircuitBroken("worker")).toBe(true);
      expect(escalation.isCircuitBroken("worker-2")).toBe(false);

      // worker-2 can still escalate
      const result = escalation.escalate("worker-2", "fine", 2);
      expect(result.circuitBroken).toBe(false);
      expect(result.target).toBeDefined();
    });
  });

  // ───────────────── getStats ─────────────────

  describe("getStats", () => {
    it("should track total escalations", () => {
      escalation.escalate("worker", "r1", 2);
      escalation.escalate("worker", "r2", 2);
      const stats = escalation.getStats();
      expect(stats.totalEscalations).toBe(2);
    });

    it("should track by agent", () => {
      registry.register(
        createAgent({
          id: "worker-2",
          tier: "worker",
          escalationTarget: "manager",
        }),
      );
      escalation.escalate("worker", "r1", 2);
      escalation.escalate("worker-2", "r1", 2);
      escalation.escalate("worker-2", "r2", 2);
      const stats = escalation.getStats();
      expect(stats.byAgent["worker"]).toBe(1);
      expect(stats.byAgent["worker-2"]).toBe(2);
    });

    it("should track master escalations", () => {
      // Manager -> master should count as master escalation
      escalation.escalate("manager", "critical", 5);
      const stats = escalation.getStats();
      expect(stats.masterEscalations).toBe(1);
    });
  });

  // ───────────────── prune ─────────────────

  describe("prune", () => {
    it("should clear old records outside window", () => {
      // Use a very short window so records expire immediately
      const shortEscalation = new EscalationManager(registry, {
        threshold: 3,
        windowMs: 1,
      });
      shortEscalation.escalate("worker", "old record", 2);

      // Wait a tiny bit for the window to pass
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait for 5ms
      }

      shortEscalation.prune();

      // After pruning, stats should be clean
      const stats = shortEscalation.getStats();
      expect(stats.totalEscalations).toBe(0);
      expect(stats.byAgent["worker"]).toBeUndefined();
    });
  });
});
