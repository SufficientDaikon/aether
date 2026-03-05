import { describe, it, expect, beforeEach } from "bun:test";
import { AgentRegistry } from "../core/registry.ts";
import type {
  AgentDefinition,
  AgentTier,
  RegistrySection,
  AgentStatus,
} from "../core/types.ts";

// Helper to create a test agent definition
function createAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    tier: "worker",
    sections: ["FRONTEND"],
    capabilities: ["react-components", "state-management"],
    dependencies: [],
    llmRequirement: "haiku",
    format: "markdown",
    escalationTarget: "system-architect",
    filePath: "/agents/test.agent.md",
    status: "idle",
    metadata: {},
    ...overrides,
  };
}

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  // ───────────────── register ─────────────────

  describe("register", () => {
    it("should register an agent", () => {
      const agent = createAgent();
      registry.register(agent);
      const found = registry.get("test-agent");
      expect(found).toBeDefined();
      expect(found!.id).toBe("test-agent");
      expect(found!.name).toBe("Test Agent");
    });

    it("should throw on duplicate ID", () => {
      registry.register(createAgent());
      expect(() => registry.register(createAgent())).toThrow(/duplicate/i);
    });

    it("should index by sections", () => {
      registry.register(
        createAgent({ id: "a1", sections: ["FRONTEND", "BACKEND"] }),
      );
      expect(registry.findBySection("FRONTEND")).toHaveLength(1);
      expect(registry.findBySection("BACKEND")).toHaveLength(1);
      expect(registry.findBySection("MARKETING")).toHaveLength(0);
    });

    it("should index by capabilities", () => {
      registry.register(
        createAgent({ id: "a1", capabilities: ["react", "nodejs"] }),
      );
      expect(registry.findByCapability("react")).toHaveLength(1);
      expect(registry.findByCapability("nodejs")).toHaveLength(1);
    });

    it("should index by tier", () => {
      registry.register(createAgent({ id: "w1", tier: "worker" }));
      registry.register(createAgent({ id: "m1", tier: "manager" }));
      expect(registry.findByTier("worker")).toHaveLength(1);
      expect(registry.findByTier("manager")).toHaveLength(1);
      expect(registry.findByTier("master")).toHaveLength(0);
    });
  });

  // ───────────────── unregister ─────────────────

  describe("unregister", () => {
    it("should remove an agent", () => {
      registry.register(createAgent());
      expect(registry.unregister("test-agent")).toBe(true);
      expect(registry.get("test-agent")).toBeUndefined();
    });

    it("should return false for non-existent agent", () => {
      expect(registry.unregister("does-not-exist")).toBe(false);
    });

    it("should clean up all indices", () => {
      registry.register(
        createAgent({
          id: "cleanup",
          sections: ["FRONTEND"],
          capabilities: ["react"],
          tier: "worker",
        }),
      );
      registry.unregister("cleanup");
      expect(registry.findBySection("FRONTEND")).toHaveLength(0);
      expect(registry.findByCapability("react")).toHaveLength(0);
      expect(registry.findByTier("worker")).toHaveLength(0);
    });
  });

  // ───────────────── findBySection ─────────────────

  describe("findBySection", () => {
    it("should find agents in a section", () => {
      registry.register(createAgent({ id: "fe1", sections: ["FRONTEND"] }));
      registry.register(createAgent({ id: "be1", sections: ["BACKEND"] }));
      const found = registry.findBySection("FRONTEND");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe("fe1");
    });

    it("should return empty for empty section", () => {
      expect(registry.findBySection("MARKETING")).toHaveLength(0);
    });

    it("should find agents in multiple sections", () => {
      registry.register(
        createAgent({ id: "full-stack", sections: ["FRONTEND", "BACKEND"] }),
      );
      expect(registry.findBySection("FRONTEND")).toHaveLength(1);
      expect(registry.findBySection("BACKEND")).toHaveLength(1);
      expect(registry.findBySection("FRONTEND")[0].id).toBe("full-stack");
      expect(registry.findBySection("BACKEND")[0].id).toBe("full-stack");
    });
  });

  // ───────────────── findByCapability ─────────────────

  describe("findByCapability", () => {
    it("should match exact capabilities", () => {
      registry.register(
        createAgent({ id: "a1", capabilities: ["react-components"] }),
      );
      const found = registry.findByCapability("react-components");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe("a1");
    });

    it("should match partial capabilities (fuzzy)", () => {
      registry.register(
        createAgent({ id: "a1", capabilities: ["mcp-server-creation"] }),
      );
      const found = registry.findByCapability("mcp");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe("a1");
    });

    it("should return empty for no matches", () => {
      registry.register(createAgent({ id: "a1", capabilities: ["react"] }));
      expect(registry.findByCapability("python")).toHaveLength(0);
    });
  });

  // ───────────────── findByTier ─────────────────

  describe("findByTier", () => {
    it("should find workers", () => {
      registry.register(createAgent({ id: "w1", tier: "worker" }));
      registry.register(createAgent({ id: "w2", tier: "worker" }));
      registry.register(createAgent({ id: "m1", tier: "manager" }));
      expect(registry.findByTier("worker")).toHaveLength(2);
    });

    it("should find managers", () => {
      registry.register(createAgent({ id: "m1", tier: "manager" }));
      registry.register(createAgent({ id: "m2", tier: "manager" }));
      const managers = registry.findByTier("manager");
      expect(managers).toHaveLength(2);
      expect(managers.map((a) => a.id).sort()).toEqual(["m1", "m2"]);
    });
  });

  // ───────────────── query ─────────────────

  describe("query", () => {
    it("should filter by section + tier", () => {
      registry.register(
        createAgent({
          id: "fe-worker",
          sections: ["FRONTEND"],
          tier: "worker",
        }),
      );
      registry.register(
        createAgent({
          id: "fe-manager",
          sections: ["FRONTEND"],
          tier: "manager",
        }),
      );
      registry.register(
        createAgent({ id: "be-worker", sections: ["BACKEND"], tier: "worker" }),
      );
      const result = registry.query({ section: "FRONTEND", tier: "worker" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("fe-worker");
    });

    it("should filter by capability + status", () => {
      registry.register(
        createAgent({
          id: "idle-react",
          capabilities: ["react"],
          status: "idle",
        }),
      );
      registry.register(
        createAgent({
          id: "busy-react",
          capabilities: ["react"],
          status: "busy",
        }),
      );
      const result = registry.query({ capability: "react", status: "idle" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("idle-react");
    });

    it("should return all when no filters", () => {
      registry.register(createAgent({ id: "a1" }));
      registry.register(createAgent({ id: "a2" }));
      registry.register(createAgent({ id: "a3" }));
      const result = registry.query({});
      expect(result).toHaveLength(3);
    });
  });

  // ───────────────── resolve ─────────────────

  describe("resolve", () => {
    it("should prefer idle agents", () => {
      registry.register(
        createAgent({
          id: "busy-one",
          capabilities: ["react"],
          status: "busy",
        }),
      );
      registry.register(
        createAgent({
          id: "idle-one",
          capabilities: ["react"],
          status: "idle",
        }),
      );
      const resolved = registry.resolve("react");
      expect(resolved).toBeDefined();
      expect(resolved!.id).toBe("idle-one");
    });

    it("should return busy agents if no idle ones", () => {
      registry.register(
        createAgent({ id: "busy-one", capabilities: ["vue"], status: "busy" }),
      );
      const resolved = registry.resolve("vue");
      expect(resolved).toBeDefined();
      expect(resolved!.id).toBe("busy-one");
    });

    it("should return undefined for unknown capability", () => {
      registry.register(createAgent({ id: "a1", capabilities: ["react"] }));
      expect(registry.resolve("haskell")).toBeUndefined();
    });
  });

  // ───────────────── getEscalationChain ─────────────────

  describe("getEscalationChain", () => {
    it("should return worker -> manager -> master chain", () => {
      registry.register(
        createAgent({
          id: "master",
          tier: "master",
          escalationTarget: null,
        }),
      );
      registry.register(
        createAgent({
          id: "manager",
          tier: "manager",
          escalationTarget: "master",
        }),
      );
      registry.register(
        createAgent({
          id: "worker",
          tier: "worker",
          escalationTarget: "manager",
        }),
      );

      const chain = registry.getEscalationChain("worker");
      expect(chain).toHaveLength(2);
      expect(chain[0].id).toBe("manager");
      expect(chain[0].tier).toBe("manager");
      expect(chain[1].id).toBe("master");
      expect(chain[1].tier).toBe("master");
    });

    it("should return empty chain for master agent", () => {
      registry.register(
        createAgent({ id: "master", tier: "master", escalationTarget: null }),
      );
      const chain = registry.getEscalationChain("master");
      expect(chain).toHaveLength(0);
    });

    it("should return empty chain for unregistered agent", () => {
      const chain = registry.getEscalationChain("nonexistent");
      expect(chain).toHaveLength(0);
    });

    it("should handle cycles safely", () => {
      registry.register(
        createAgent({ id: "cycle-a", escalationTarget: "cycle-b" }),
      );
      registry.register(
        createAgent({ id: "cycle-b", escalationTarget: "cycle-a" }),
      );
      const chain = registry.getEscalationChain("cycle-a");
      // Should terminate without infinite loop — cycle-b points back to cycle-a which is visited
      expect(chain).toHaveLength(1);
      expect(chain[0].id).toBe("cycle-b");
    });
  });
});
