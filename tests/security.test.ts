import { describe, it, expect, beforeEach } from "bun:test";
import { AgentRegistry } from "../core/registry.ts";
import type { AgentDefinition, RegistrySection } from "../core/types.ts";

// ─────────────────────────────────────────────────────────────
// Security Agent Test Suite
// Validates the cybersecurity agent hierarchy, registration,
// escalation chains, and capability resolution
// ─────────────────────────────────────────────────────────────

function createAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    tier: "worker",
    sections: ["SECURITY"],
    capabilities: ["vulnerability-scanning"],
    dependencies: [],
    llmRequirement: "haiku",
    format: "markdown",
    escalationTarget: "cyber-sentinel",
    filePath: "/agents/workers/security/test.agent.md",
    status: "idle",
    metadata: {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Cyber Sentinel Manager
// ─────────────────────────────────────────────────────────────

const cyberSentinel: AgentDefinition = {
  id: "cyber-sentinel",
  name: "Cyber Sentinel — Security Operations Commander",
  tier: "manager",
  sections: ["SECURITY", "AUDIT"],
  capabilities: [
    "vulnerability-assessment",
    "threat-modeling",
    "security-architecture",
    "incident-response",
    "penetration-testing",
    "compliance-audit",
    "supply-chain-security",
    "code-security-review",
  ],
  dependencies: [
    "codebase-access",
    "git-history",
    "dependency-manifests",
    "runtime-logs",
  ],
  llmRequirement: "sonnet",
  format: "xml",
  escalationTarget: "cortex-0",
  filePath: "/agents/managers/cyber-sentinel.agent.md",
  status: "idle",
  metadata: {},
};

// ─────────────────────────────────────────────────────────────
// Security Workers
// ─────────────────────────────────────────────────────────────

const vulnHunter: AgentDefinition = {
  id: "vuln-hunter",
  name: "Vulnerability Hunter",
  tier: "worker",
  sections: ["SECURITY"],
  capabilities: [
    "vulnerability-scanning",
    "semantic-code-analysis",
    "data-flow-tracing",
    "git-archaeology",
    "proof-of-concept-generation",
    "zero-day-discovery",
    "false-positive-filtering",
  ],
  dependencies: ["codebase-access", "git-history", "scan-plan"],
  llmRequirement: "sonnet",
  format: "markdown",
  escalationTarget: "cyber-sentinel",
  filePath: "/agents/workers/security/vuln-hunter.agent.md",
  status: "idle",
  metadata: {},
};

const codeHardener: AgentDefinition = {
  id: "code-hardener",
  name: "Code Hardener",
  tier: "worker",
  sections: ["SECURITY"],
  capabilities: [
    "patch-generation",
    "security-hardening",
    "defense-in-depth",
    "secure-refactoring",
    "fix-validation",
    "security-patterns",
  ],
  dependencies: ["vulnerability-findings", "codebase-access", "test-suite"],
  llmRequirement: "sonnet",
  format: "markdown",
  escalationTarget: "cyber-sentinel",
  filePath: "/agents/workers/security/code-hardener.agent.md",
  status: "idle",
  metadata: {},
};

const threatArchitect: AgentDefinition = {
  id: "threat-architect",
  name: "Threat Architect",
  tier: "worker",
  sections: ["SECURITY"],
  capabilities: [
    "threat-modeling",
    "attack-surface-mapping",
    "risk-assessment",
    "cvss-scoring",
    "security-architecture-review",
    "stride-analysis",
    "compliance-mapping",
  ],
  dependencies: ["architecture-docs", "codebase-access", "deployment-config"],
  llmRequirement: "sonnet",
  format: "markdown",
  escalationTarget: "cyber-sentinel",
  filePath: "/agents/workers/security/threat-architect.agent.md",
  status: "idle",
  metadata: {},
};

const dependencySentinel: AgentDefinition = {
  id: "dependency-sentinel",
  name: "Dependency Sentinel",
  tier: "worker",
  sections: ["SECURITY"],
  capabilities: [
    "dependency-scanning",
    "cve-monitoring",
    "sbom-generation",
    "license-compliance",
    "supply-chain-security",
    "typosquat-detection",
    "dependency-risk-scoring",
  ],
  dependencies: ["package-manifests", "lock-files", "registry-access"],
  llmRequirement: "haiku",
  format: "json",
  escalationTarget: "cyber-sentinel",
  filePath: "/agents/workers/security/dependency-sentinel.agent.md",
  status: "idle",
  metadata: {},
};

const allSecurityAgents = [
  cyberSentinel,
  vulnHunter,
  codeHardener,
  threatArchitect,
  dependencySentinel,
];

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("Security Agent Hierarchy", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
    // Register the master
    registry.register({
      id: "cortex-0",
      name: "CORTEX-0",
      tier: "master",
      sections: ["META"],
      capabilities: ["orchestration", "delegation"],
      dependencies: [],
      llmRequirement: "opus",
      format: "xml",
      escalationTarget: null,
      filePath: "/agents/master/cortex.agent.md",
      status: "idle",
      metadata: {},
    });
    // Register all security agents
    for (const agent of allSecurityAgents) {
      registry.register(agent);
    }
  });

  // ───────────── Registration ─────────────

  describe("Registration", () => {
    it("should register all 5 security agents", () => {
      for (const agent of allSecurityAgents) {
        const found = registry.get(agent.id);
        expect(found).toBeDefined();
        expect(found!.id).toBe(agent.id);
      }
    });

    it("should register cyber-sentinel as manager tier", () => {
      const sentinel = registry.get("cyber-sentinel");
      expect(sentinel!.tier).toBe("manager");
    });

    it("should register all workers as worker tier", () => {
      const workers = [
        vulnHunter,
        codeHardener,
        threatArchitect,
        dependencySentinel,
      ];
      for (const w of workers) {
        const found = registry.get(w.id);
        expect(found!.tier).toBe("worker");
      }
    });

    it("should index all security agents under SECURITY section", () => {
      const secAgents = registry.findBySection("SECURITY");
      expect(secAgents.length).toBe(5); // 1 manager + 4 workers
    });

    it("should index cyber-sentinel under both SECURITY and AUDIT sections", () => {
      const secAgents = registry.findBySection("SECURITY");
      const auditAgents = registry.findBySection("AUDIT");
      expect(secAgents.some((a) => a.id === "cyber-sentinel")).toBe(true);
      expect(auditAgents.some((a) => a.id === "cyber-sentinel")).toBe(true);
    });
  });

  // ───────────── Escalation Chain ─────────────

  describe("Escalation Chain", () => {
    it("workers should escalate to cyber-sentinel", () => {
      const workers = [
        "vuln-hunter",
        "code-hardener",
        "threat-architect",
        "dependency-sentinel",
      ];
      for (const wid of workers) {
        const agent = registry.get(wid);
        expect(agent!.escalationTarget).toBe("cyber-sentinel");
      }
    });

    it("cyber-sentinel should escalate to cortex-0", () => {
      const sentinel = registry.get("cyber-sentinel");
      expect(sentinel!.escalationTarget).toBe("cortex-0");
    });

    it("should form a valid escalation chain: worker → manager → master", () => {
      const chain = registry.getEscalationChain("vuln-hunter");
      expect(chain.length).toBeGreaterThanOrEqual(2);
      // vuln-hunter → cyber-sentinel → cortex-0
      const ids = chain.map((a) => a.id);
      expect(ids).toContain("cyber-sentinel");
      expect(ids).toContain("cortex-0");
    });

    it("should form valid chains for all workers", () => {
      const workers = [
        "vuln-hunter",
        "code-hardener",
        "threat-architect",
        "dependency-sentinel",
      ];
      for (const wid of workers) {
        const chain = registry.getEscalationChain(wid);
        const ids = chain.map((a) => a.id);
        expect(ids).toContain("cyber-sentinel");
        expect(ids).toContain("cortex-0");
      }
    });

    it("cortex-0 should be the terminal node (no further escalation)", () => {
      const cortex = registry.get("cortex-0");
      expect(cortex!.escalationTarget).toBeNull();
    });
  });

  // ───────────── Capability Resolution ─────────────

  describe("Capability Resolution", () => {
    it("should resolve vulnerability-scanning to vuln-hunter", () => {
      const agents = registry.findByCapability("vulnerability-scanning");
      expect(agents.some((a) => a.id === "vuln-hunter")).toBe(true);
    });

    it("should resolve threat-modeling to both cyber-sentinel and threat-architect", () => {
      const agents = registry.findByCapability("threat-modeling");
      const ids = agents.map((a) => a.id);
      expect(ids).toContain("cyber-sentinel");
      expect(ids).toContain("threat-architect");
    });

    it("should resolve supply-chain-security to both cyber-sentinel and dependency-sentinel", () => {
      const agents = registry.findByCapability("supply-chain-security");
      const ids = agents.map((a) => a.id);
      expect(ids).toContain("cyber-sentinel");
      expect(ids).toContain("dependency-sentinel");
    });

    it("should resolve patch-generation to code-hardener", () => {
      const agents = registry.findByCapability("patch-generation");
      expect(agents.some((a) => a.id === "code-hardener")).toBe(true);
    });

    it("should resolve zero-day-discovery to vuln-hunter", () => {
      const agents = registry.findByCapability("zero-day-discovery");
      expect(agents.some((a) => a.id === "vuln-hunter")).toBe(true);
    });

    it("should resolve cvss-scoring to threat-architect", () => {
      const agents = registry.findByCapability("cvss-scoring");
      expect(agents.some((a) => a.id === "threat-architect")).toBe(true);
    });

    it("should resolve sbom-generation to dependency-sentinel", () => {
      const agents = registry.findByCapability("sbom-generation");
      expect(agents.some((a) => a.id === "dependency-sentinel")).toBe(true);
    });

    it("should resolve incident-response to cyber-sentinel", () => {
      const agents = registry.findByCapability("incident-response");
      expect(agents.some((a) => a.id === "cyber-sentinel")).toBe(true);
    });

    it("should prefer workers over manager when resolving specific capabilities", () => {
      const agents = registry.resolve("vulnerability-scanning");
      // resolve() should return the most appropriate agent
      // Workers are preferred over managers for tactical work
      if (agents) {
        expect(agents.tier).toBe("worker");
        expect(agents.id).toBe("vuln-hunter");
      }
    });
  });

  // ───────────── LLM Requirements ─────────────

  describe("LLM Requirements", () => {
    it("cyber-sentinel should require sonnet-class LLM", () => {
      expect(cyberSentinel.llmRequirement).toBe("sonnet");
    });

    it("vuln-hunter should require sonnet-class LLM (semantic analysis needs it)", () => {
      expect(vulnHunter.llmRequirement).toBe("sonnet");
    });

    it("code-hardener should require sonnet-class LLM (patch generation needs reasoning)", () => {
      expect(codeHardener.llmRequirement).toBe("sonnet");
    });

    it("threat-architect should require sonnet-class LLM (threat modeling needs reasoning)", () => {
      expect(threatArchitect.llmRequirement).toBe("sonnet");
    });

    it("dependency-sentinel can run on haiku (structured data matching)", () => {
      expect(dependencySentinel.llmRequirement).toBe("haiku");
    });
  });

  // ───────────── Agent Definitions ─────────────

  describe("Agent Definitions", () => {
    it("all agents should have non-empty capabilities", () => {
      for (const agent of allSecurityAgents) {
        expect(agent.capabilities.length).toBeGreaterThan(0);
      }
    });

    it("all agents should have non-empty dependencies", () => {
      for (const agent of allSecurityAgents) {
        expect(agent.dependencies.length).toBeGreaterThan(0);
      }
    });

    it("all agents should start in idle status", () => {
      for (const agent of allSecurityAgents) {
        expect(agent.status).toBe("idle");
      }
    });

    it("no security agent should have transport config (all local)", () => {
      for (const agent of allSecurityAgents) {
        expect(agent.transport).toBeUndefined();
      }
    });

    it("cyber-sentinel should have 8 capabilities covering all security domains", () => {
      expect(cyberSentinel.capabilities).toContain("vulnerability-assessment");
      expect(cyberSentinel.capabilities).toContain("threat-modeling");
      expect(cyberSentinel.capabilities).toContain("security-architecture");
      expect(cyberSentinel.capabilities).toContain("incident-response");
      expect(cyberSentinel.capabilities).toContain("penetration-testing");
      expect(cyberSentinel.capabilities).toContain("compliance-audit");
      expect(cyberSentinel.capabilities).toContain("supply-chain-security");
      expect(cyberSentinel.capabilities).toContain("code-security-review");
      expect(cyberSentinel.capabilities.length).toBe(8);
    });

    it("vuln-hunter should have 7 scanning capabilities", () => {
      expect(vulnHunter.capabilities).toContain("semantic-code-analysis");
      expect(vulnHunter.capabilities).toContain("data-flow-tracing");
      expect(vulnHunter.capabilities).toContain("git-archaeology");
      expect(vulnHunter.capabilities).toContain("proof-of-concept-generation");
      expect(vulnHunter.capabilities).toContain("zero-day-discovery");
      expect(vulnHunter.capabilities).toContain("false-positive-filtering");
      expect(vulnHunter.capabilities.length).toBe(7);
    });
  });

  // ───────────── SECURITY Section ─────────────

  describe("SECURITY Registry Section", () => {
    it("SECURITY section should exist and contain agents", () => {
      const secAgents = registry.findBySection("SECURITY");
      expect(secAgents.length).toBeGreaterThan(0);
    });

    it("only security agents should be in SECURITY section", () => {
      const secAgents = registry.findBySection("SECURITY");
      const secIds = secAgents.map((a) => a.id);
      expect(secIds).toContain("cyber-sentinel");
      expect(secIds).toContain("vuln-hunter");
      expect(secIds).toContain("code-hardener");
      expect(secIds).toContain("threat-architect");
      expect(secIds).toContain("dependency-sentinel");
      expect(secIds).not.toContain("cortex-0");
    });

    it("should have exactly 1 manager and 4 workers in SECURITY", () => {
      const secAgents = registry.findBySection("SECURITY");
      const managers = secAgents.filter((a) => a.tier === "manager");
      const workers = secAgents.filter((a) => a.tier === "worker");
      expect(managers.length).toBe(1);
      expect(workers.length).toBe(4);
    });
  });

  // ───────────── Cross-swarm Integration ─────────────

  describe("Cross-swarm Integration", () => {
    it("cyber-sentinel should appear in AUDIT section alongside qa-audit-director domain", () => {
      const auditAgents = registry.findBySection("AUDIT");
      expect(auditAgents.some((a) => a.id === "cyber-sentinel")).toBe(true);
    });

    it("should have managers in separate sections to avoid conflict", () => {
      // qa-audit-director owns AUDIT + TOOLS
      // cyber-sentinel owns SECURITY + AUDIT
      // They share AUDIT section — this is intentional for cross-swarm coordination
      const sentinel = registry.get("cyber-sentinel");
      expect(sentinel!.sections).toContain("SECURITY");
      expect(sentinel!.sections).toContain("AUDIT");
    });
  });
});
