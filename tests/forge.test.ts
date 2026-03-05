import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgentForge } from "../core/forge.ts";
import { AgentRegistry } from "../core/registry.ts";
import { TierRegistry } from "../core/tier-registry.ts";
import { SQLiteStore } from "../core/storage/sqlite-store.ts";
import { SynapseLogger } from "../core/logger.ts";
import type { AgentSpawnSpec } from "../core/forge.ts";

// ─────────────────────────────────────────────────────────────
// Agent Forge Tests
// ─────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "aether-forge-test-"));
}

describe("AgentForge", () => {
  let tempDir: string;
  let agentsDir: string;
  let registry: AgentRegistry;
  let tierRegistry: TierRegistry;
  let store: SQLiteStore;
  let logger: SynapseLogger;
  let forge: AgentForge;

  beforeEach(async () => {
    tempDir = makeTempDir();
    agentsDir = join(tempDir, "agents");
    mkdirSync(agentsDir, { recursive: true });

    registry = new AgentRegistry();
    tierRegistry = TierRegistry.builtinTiers();
    store = new SQLiteStore(tempDir);
    await store.init();
    logger = new SynapseLogger(join(tempDir, "logs"), "error");
    forge = new AgentForge(registry, tierRegistry, store, logger, agentsDir);
  });

  afterEach(async () => {
    await store.close();
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Best-effort
    }
  });

  function workerSpec(overrides: Partial<AgentSpawnSpec> = {}): AgentSpawnSpec {
    return {
      id: "test-worker-1",
      name: "Test Worker",
      tier: "worker",
      capabilities: ["testing"],
      systemPrompt: "You are a test worker.",
      ...overrides,
    };
  }

  // ── Spawn ──

  describe("spawnAgent()", () => {
    it("spawns a new agent", () => {
      const agent = forge.spawnAgent(workerSpec());
      expect(agent.id).toBe("test-worker-1");
      expect(agent.tier).toBe("worker");
      expect(agent.capabilities).toEqual(["testing"]);
    });

    it("registers the agent in the registry", () => {
      forge.spawnAgent(workerSpec());
      const found = registry.get("test-worker-1");
      expect(found).toBeDefined();
      expect(found!.name).toBe("Test Worker");
    });

    it("creates agent file on disk", () => {
      forge.spawnAgent(workerSpec());
      const filePath = join(agentsDir, "test-worker-1.agent.md");
      expect(existsSync(filePath)).toBe(true);
    });

    it("sets metadata.spawnedBy to forge", () => {
      const agent = forge.spawnAgent(workerSpec());
      expect(agent.metadata.spawnedBy).toBe("forge");
    });

    it("tracks ephemeral agents", () => {
      forge.spawnAgent(workerSpec({ ephemeral: true }));
      expect(forge.getEphemeralAgents()).toContain("test-worker-1");
    });

    it("adds to spawn log", () => {
      forge.spawnAgent(workerSpec());
      const log = forge.getSpawnLog();
      expect(log).toHaveLength(1);
      expect(log[0].agentId).toBe("test-worker-1");
    });

    it("throws on unknown tier", () => {
      expect(() =>
        forge.spawnAgent(workerSpec({ tier: "nonexistent" })),
      ).toThrow("not registered");
    });

    it("throws on duplicate ID", () => {
      forge.spawnAgent(workerSpec());
      expect(() => forge.spawnAgent(workerSpec())).toThrow("already exists");
    });

    it("throws when tier max agents reached", () => {
      // sentinel tier allows only 1
      forge.spawnAgent(
        workerSpec({ id: "sent-1", tier: "sentinel", capabilities: ["test"] }),
      );
      expect(() =>
        forge.spawnAgent(
          workerSpec({
            id: "sent-2",
            tier: "sentinel",
            capabilities: ["test"],
          }),
        ),
      ).toThrow("max agents");
    });
  });

  // ── Retire ──

  describe("retireAgent()", () => {
    it("removes agent from registry", () => {
      forge.spawnAgent(workerSpec());
      forge.retireAgent("test-worker-1", "test cleanup");
      expect(registry.get("test-worker-1")).toBeUndefined();
    });

    it("deletes agent file when requested", () => {
      forge.spawnAgent(workerSpec());
      const filePath = join(agentsDir, "test-worker-1.agent.md");
      expect(existsSync(filePath)).toBe(true);
      forge.retireAgent("test-worker-1", "cleanup", true);
      expect(existsSync(filePath)).toBe(false);
    });

    it("throws for unknown agent", () => {
      expect(() => forge.retireAgent("nonexistent", "test")).toThrow(
        "not found",
      );
    });

    it("throws for sentinel-tier agents", () => {
      forge.spawnAgent(
        workerSpec({
          id: "sent-protect",
          tier: "sentinel",
          capabilities: ["system_monitor"],
        }),
      );
      expect(() => forge.retireAgent("sent-protect", "test")).toThrow(
        "sentinel-tier",
      );
    });
  });

  // ── Ephemeral ──

  describe("retireEphemeralAgents()", () => {
    it("retires all ephemeral agents", () => {
      forge.spawnAgent(workerSpec({ id: "eph-1", ephemeral: true }));
      forge.spawnAgent(workerSpec({ id: "eph-2", ephemeral: true }));
      forge.spawnAgent(workerSpec({ id: "perm-1", ephemeral: false }));

      const retired = forge.retireEphemeralAgents();
      expect(retired).toContain("eph-1");
      expect(retired).toContain("eph-2");
      expect(retired).not.toContain("perm-1");
      expect(registry.get("perm-1")).toBeDefined();
    });
  });

  // ── Analysis ──

  describe("analyzeTaskNeeds()", () => {
    it("identifies existing agents that match capabilities", () => {
      forge.spawnAgent(workerSpec({ capabilities: ["javascript"] }));
      const result = forge.analyzeTaskNeeds("Fix JS bug", ["javascript"]);
      expect(result.existingAgents).toContain("test-worker-1");
      expect(result.gapCapabilities).toHaveLength(0);
    });

    it("identifies capability gaps", () => {
      const result = forge.analyzeTaskNeeds("Deploy app", ["kubernetes"]);
      expect(result.gapCapabilities).toContain("kubernetes");
      expect(result.recommendedSpawns).toHaveLength(1);
    });

    it("recommends ephemeral spawns for gaps", () => {
      const result = forge.analyzeTaskNeeds("Test app", ["playwright"]);
      expect(result.recommendedSpawns[0].ephemeral).toBe(true);
      expect(result.recommendedSpawns[0].tier).toBe("worker");
    });
  });

  // ── Status ──

  describe("getStatus()", () => {
    it("returns correct counts", () => {
      forge.spawnAgent(workerSpec({ id: "w1" }));
      forge.spawnAgent(workerSpec({ id: "w2", ephemeral: true }));
      const status = forge.getStatus();
      expect(status.totalSpawned).toBe(2);
      expect(status.ephemeralActive).toBe(1);
    });
  });
});
