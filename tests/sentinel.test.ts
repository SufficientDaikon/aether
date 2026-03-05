import { describe, it, expect, beforeEach } from "bun:test";
import { SystemSentinel } from "../core/sentinel.ts";
import { ConstitutionalRulesEngine } from "../core/constitutional-rules.ts";
import type { ActionContext } from "../core/constitutional-rules.ts";
import { AgentRegistry } from "../core/registry.ts";
import { TierRegistry } from "../core/tier-registry.ts";
import { SynapseLogger } from "../core/logger.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentDefinition } from "../core/types.ts";

// ─────────────────────────────────────────────────────────────
// System Sentinel + Constitutional Rules Tests
// ─────────────────────────────────────────────────────────────

function makeAgent(id: string, tier: string, status: string): AgentDefinition {
  return {
    id,
    name: id,
    tier,
    sections: [],
    capabilities: [],
    dependencies: [],
    llmRequirement: "haiku",
    format: "markdown",
    escalationTarget: null,
    filePath: "",
    status: status as any,
    metadata: {},
  };
}

describe("ConstitutionalRulesEngine", () => {
  let engine: ConstitutionalRulesEngine;

  beforeEach(() => {
    engine = new ConstitutionalRulesEngine();
  });

  it("loads default rules", () => {
    expect(engine.getRules().length).toBeGreaterThanOrEqual(4);
  });

  it("blocks destructive DB ops from workers", () => {
    const action: ActionContext = {
      agentId: "worker-1",
      agentTier: "worker",
      type: "shell_exec",
      details: { command: "DROP TABLE users" },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.enforcement).toBe("block");
  });

  it("allows destructive DB ops from master (not in scope)", () => {
    const action: ActionContext = {
      agentId: "master-0",
      agentTier: "master",
      type: "shell_exec",
      details: { command: "DROP TABLE users" },
    };
    const result = engine.evaluate(action);
    // Master is not in the worker/manager scope
    expect(result.allowed).toBe(true);
  });

  it("blocks rm -rf /", () => {
    const action: ActionContext = {
      agentId: "any-agent",
      agentTier: "master",
      type: "shell_exec",
      details: { command: "rm -rf /" },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.ruleId).toBe("no-rm-rf-root");
  });

  it("blocks secret exposure", () => {
    const action: ActionContext = {
      agentId: "worker-1",
      agentTier: "worker",
      type: "log_output",
      details: { content: "key = sk-abc12345678901234567890" },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.ruleId).toBe("no-secret-exposure");
  });

  it("allows safe actions", () => {
    const action: ActionContext = {
      agentId: "worker-1",
      agentTier: "worker",
      type: "file_read",
      details: { path: "/src/index.ts" },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  it("addRule() adds a custom rule", () => {
    engine.addRule({
      id: "custom-1",
      name: "Custom Rule",
      description: "test",
      scope: "all",
      condition: { actionType: "custom" },
      enforcement: "block",
      message: "blocked",
    });
    const action: ActionContext = {
      agentId: "a",
      agentTier: "worker",
      type: "custom",
      details: {},
    };
    expect(engine.evaluate(action).allowed).toBe(false);
  });

  it("removeRule() removes a rule", () => {
    engine.removeRule("no-rm-rf-root");
    expect(engine.getRule("no-rm-rf-root")).toBeUndefined();
  });

  it("evaluateAll() returns all matching rules", () => {
    const action: ActionContext = {
      agentId: "worker-1",
      agentTier: "worker",
      type: "shell_exec",
      details: { command: "DELETE FROM users; rm -rf /" },
    };
    const results = engine.evaluateAll(action);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SystemSentinel", () => {
  let registry: AgentRegistry;
  let tierRegistry: TierRegistry;
  let logger: SynapseLogger;
  let sentinel: SystemSentinel;

  beforeEach(() => {
    const tempDir = mkdtempSync(join(tmpdir(), "aether-sentinel-test-"));
    registry = new AgentRegistry();
    tierRegistry = TierRegistry.builtinTiers();
    logger = new SynapseLogger(join(tempDir, "logs"), "error");
    sentinel = new SystemSentinel(registry, tierRegistry, logger);
  });

  // ── Health ──

  describe("getSwarmHealth()", () => {
    it("returns empty health for no agents", () => {
      const health = sentinel.getSwarmHealth();
      expect(health.agentCount).toBe(0);
      expect(health.healthScore).toBe(0);
    });

    it("counts agents by tier and status", () => {
      registry.register(makeAgent("w1", "worker", "idle"));
      registry.register(makeAgent("w2", "worker", "busy"));
      registry.register(makeAgent("m1", "manager", "idle"));

      const health = sentinel.getSwarmHealth();
      expect(health.agentCount).toBe(3);
      expect(health.byTier.worker).toBe(2);
      expect(health.byTier.manager).toBe(1);
      expect(health.idleAgents).toContain("w1");
      expect(health.busyAgents).toContain("w2");
    });

    it("penalizes error agents in health score", () => {
      registry.register(makeAgent("w1", "worker", "idle"));
      registry.register(makeAgent("w2", "worker", "error"));
      const health = sentinel.getSwarmHealth();
      expect(health.healthScore).toBeLessThan(100);
      expect(health.errorAgents).toContain("w2");
    });
  });

  // ── Oversight ──

  describe("evaluateAction()", () => {
    it("blocks dangerous actions", () => {
      const result = sentinel.evaluateAction({
        agentId: "worker-1",
        agentTier: "worker",
        type: "shell_exec",
        details: { command: "rm -rf /" },
      });
      expect(result.allowed).toBe(false);
    });

    it("logs evaluated actions", () => {
      sentinel.evaluateAction({
        agentId: "w1",
        agentTier: "worker",
        type: "file_read",
        details: {},
      });
      expect(sentinel.getActionLog(10)).toHaveLength(1);
    });
  });

  // ── Force Kill ──

  describe("forceKillAgent()", () => {
    it("sets agent to error state", () => {
      registry.register(makeAgent("w1", "worker", "busy"));
      sentinel.forceKillAgent("w1", "stuck");
      expect(registry.get("w1")!.status).toBe("error");
    });

    it("records fact in ledger", () => {
      registry.register(makeAgent("w1", "worker", "busy"));
      sentinel.forceKillAgent("w1", "loop detected");
      const facts = sentinel.getFactsLedger("constraint");
      expect(facts.length).toBeGreaterThan(0);
    });

    it("throws for unknown agent", () => {
      expect(() => sentinel.forceKillAgent("ghost", "test")).toThrow(
        "not found",
      );
    });
  });

  // ── Pause/Resume ──

  describe("pauseSwarm() / resumeSwarm()", () => {
    it("pauses all non-sentinel agents", () => {
      registry.register(makeAgent("w1", "worker", "idle"));
      registry.register(makeAgent("w2", "worker", "busy"));
      sentinel.pauseSwarm("test");

      expect(sentinel.isPaused()).toBe(true);
      expect(registry.get("w1")!.status).toBe("offline");
      expect(registry.get("w2")!.status).toBe("offline");
    });

    it("resumes paused agents to idle", () => {
      registry.register(makeAgent("w1", "worker", "idle"));
      sentinel.pauseSwarm("test");
      sentinel.resumeSwarm();

      expect(sentinel.isPaused()).toBe(false);
      expect(registry.get("w1")!.status).toBe("idle");
    });
  });

  // ── Dual Ledger ──

  describe("task ledger", () => {
    it("updates and retrieves task entries", () => {
      sentinel.updateTaskLedger({
        taskId: "t1",
        description: "Test task",
        status: "pending",
        assignedTo: "w1",
      });
      expect(sentinel.getTaskLedgerEntry("t1")?.description).toBe("Test task");
      expect(sentinel.getTaskLedger()).toHaveLength(1);
    });

    it("filters by status", () => {
      sentinel.updateTaskLedger({
        taskId: "t1",
        description: "A",
        status: "pending",
        assignedTo: "w1",
      });
      sentinel.updateTaskLedger({
        taskId: "t2",
        description: "B",
        status: "completed",
        assignedTo: "w2",
      });
      expect(sentinel.getTaskLedgerByStatus("pending")).toHaveLength(1);
      expect(sentinel.getTaskLedgerByStatus("completed")).toHaveLength(1);
    });
  });

  describe("facts ledger", () => {
    it("adds and retrieves facts", () => {
      sentinel.addFact("Test fact", "agent-1", 0.9, "discovery");
      const facts = sentinel.getFactsLedger();
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe("Test fact");
      expect(facts[0].confidence).toBe(0.9);
    });

    it("filters by category", () => {
      sentinel.addFact("Env fact", "a", 0.8, "environment");
      sentinel.addFact("Task fact", "a", 0.7, "task");
      expect(sentinel.getFactsLedger("environment")).toHaveLength(1);
      expect(sentinel.getFactsLedger("task")).toHaveLength(1);
    });

    it("clamps confidence to 0-1", () => {
      const entry = sentinel.addFact("Over", "a", 5.0, "discovery");
      expect(entry.confidence).toBe(1);
    });
  });

  // ── Health Check ──

  describe("runHealthCheck()", () => {
    it("reports healthy for clean swarm", () => {
      registry.register(makeAgent("w1", "worker", "idle"));
      const result = sentinel.runHealthCheck();
      expect(result.healthy).toBe(true);
      expect(result.score).toBe(100);
    });

    it("reports issues for error agents", () => {
      registry.register(makeAgent("w1", "worker", "error"));
      const result = sentinel.runHealthCheck();
      expect(result.healthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  // ── Status ──

  describe("getStatus()", () => {
    it("returns summary", () => {
      sentinel.addFact("X", "a", 0.5, "task");
      const status = sentinel.getStatus();
      expect(status.paused).toBe(false);
      expect(status.factsLedgerSize).toBe(1);
      expect(status.rulesCount).toBeGreaterThan(0);
    });
  });
});
