// ─────────────────────────────────────────────────────────────
// AETHER Eval — Agent Fixtures
// Shared AgentDefinition fixtures for all test phases
// ─────────────────────────────────────────────────────────────

import type { AgentDefinition, RegistrySection } from "../../core/types.ts";

let counter = 0;

export function makeAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  counter++;
  return {
    id: overrides.id ?? `test-agent-${counter}`,
    name: overrides.name ?? `Test Agent ${counter}`,
    tier: overrides.tier ?? "worker",
    sections: overrides.sections ?? (["TOOLS"] as RegistrySection[]),
    capabilities: overrides.capabilities ?? ["testing"],
    dependencies: overrides.dependencies ?? [],
    llmRequirement: overrides.llmRequirement ?? "gemini-flash",
    format: overrides.format ?? "markdown",
    escalationTarget: overrides.escalationTarget ?? null,
    filePath: overrides.filePath ?? `agents/test-${counter}.agent.md`,
    status: overrides.status ?? "idle",
    metadata: overrides.metadata ?? {},
    ...overrides,
  };
}

export const CORTEX = makeAgent({
  id: "cortex-0",
  name: "CORTEX-0 Master",
  tier: "master",
  sections: ["META"] as RegistrySection[],
  capabilities: ["orchestration", "delegation", "synthesis", "planning"],
  llmRequirement: "gemini-ultra",
  escalationTarget: null,
  filePath: "agents/master/cortex-0.agent.md",
});

export const SYSTEM_ARCHITECT = makeAgent({
  id: "system-architect",
  name: "System Architect",
  tier: "manager",
  sections: ["BACKEND"] as RegistrySection[],
  capabilities: ["architecture", "system-design", "code-review", "planning"],
  llmRequirement: "gemini-pro",
  escalationTarget: "cortex-0",
  filePath: "agents/managers/system-architect.agent.md",
});

export const REACT_SPECIALIST = makeAgent({
  id: "react-specialist",
  name: "React Specialist",
  tier: "worker",
  sections: ["FRONTEND"] as RegistrySection[],
  capabilities: [
    "react-components",
    "state-management",
    "typescript",
    "frontend",
  ],
  llmRequirement: "gemini-flash",
  escalationTarget: "system-architect",
  filePath: "agents/workers/react-specialist.agent.md",
});

export const DB_ARCHITECT = makeAgent({
  id: "postgres-db-architect",
  name: "PostgreSQL DB Architect",
  tier: "worker",
  sections: ["BACKEND"] as RegistrySection[],
  capabilities: ["postgresql", "schema-design", "database-optimization", "sql"],
  llmRequirement: "gemini-flash",
  escalationTarget: "system-architect",
  filePath: "agents/workers/postgres-db-architect.agent.md",
});

export const UI_DESIGNER = makeAgent({
  id: "ui-designer",
  name: "UI Designer",
  tier: "worker",
  sections: ["FRONTEND"] as RegistrySection[],
  capabilities: ["ui-design", "css", "tailwind", "responsive-design"],
  llmRequirement: "gemini-flash",
  escalationTarget: "system-architect",
  filePath: "agents/workers/ui-designer.agent.md",
});

export const UX_PSYCHOLOGIST = makeAgent({
  id: "ux-psychologist",
  name: "UX Psychologist",
  tier: "worker",
  sections: ["FRONTEND"] as RegistrySection[],
  capabilities: ["ux-review", "accessibility", "user-research"],
  llmRequirement: "gemini-flash",
  escalationTarget: "system-architect",
  filePath: "agents/workers/ux-psychologist.agent.md",
});

export const SECURITY_AUDITOR = makeAgent({
  id: "security-auditor",
  name: "Security Auditor",
  tier: "worker",
  sections: ["SECURITY"] as RegistrySection[],
  capabilities: [
    "security-audit",
    "vulnerability-scanning",
    "penetration-testing",
  ],
  llmRequirement: "gemini-flash",
  escalationTarget: "system-architect",
  filePath: "agents/workers/security-auditor.agent.md",
});

export const TEST_ENGINEER = makeAgent({
  id: "test-engineer",
  name: "Test Engineer",
  tier: "worker",
  sections: ["TOOLS"] as RegistrySection[],
  capabilities: ["testing", "test-automation", "quality-assurance"],
  llmRequirement: "gemini-flash",
  escalationTarget: "system-architect",
  filePath: "agents/workers/test-engineer.agent.md",
});

export const FORGE_AGENT = makeAgent({
  id: "forge-0",
  name: "Agent Forge",
  tier: "forge",
  sections: ["META"] as RegistrySection[],
  capabilities: ["spawn_agents", "retire_agents", "analyze_needs"],
  llmRequirement: "gemini-ultra",
  escalationTarget: "sentinel-0",
  filePath: "agents/meta/forge-0.agent.md",
});

export const SENTINEL_AGENT = makeAgent({
  id: "sentinel-0",
  name: "System Sentinel",
  tier: "sentinel",
  sections: ["META"] as RegistrySection[],
  capabilities: ["system_monitor", "health_check", "constitutional_oversight"],
  llmRequirement: "gemini-ultra",
  escalationTarget: null,
  filePath: "agents/meta/sentinel-0.agent.md",
});

/** All fixture agents */
export const ALL_AGENTS = [
  CORTEX,
  SYSTEM_ARCHITECT,
  REACT_SPECIALIST,
  DB_ARCHITECT,
  UI_DESIGNER,
  UX_PSYCHOLOGIST,
  SECURITY_AUDITOR,
  TEST_ENGINEER,
  FORGE_AGENT,
  SENTINEL_AGENT,
];

/** Register a full agent hierarchy into a registry */
export function registerFullHierarchy(registry: {
  register: (agent: AgentDefinition) => void;
}): void {
  for (const agent of ALL_AGENTS) {
    try {
      registry.register(agent);
    } catch {
      /* already registered */
    }
  }
}
