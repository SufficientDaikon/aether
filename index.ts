// AETHER — Autonomous Agent Orchestration Framework
// Barrel export for package consumers

// Core runtime
export { AetherRuntime } from "./core/runtime.ts";
export { AgentRegistry } from "./core/registry.ts";
export { AgentExecutor } from "./core/executor.ts";
export { AgentRouter } from "./core/router.ts";
export { AgentForge } from "./core/forge.ts";
export { ConfigManager, WorkspaceScanner } from "./core/config.ts";
export { SettingsManager } from "./core/settings.ts";

// Protocol & networking
export { AetherLinkServer } from "./protocol/server.ts";
export { AetherLinkClient } from "./protocol/client.ts";
export { AetherMCPServer } from "./nexus/mcp-server.ts";

// Types
export type {
  AgentDefinition,
  AgentTier,
  AgentStatus,
  AetherMessage,
  AetherConfig,
  AetherSettings,
  TaskRequest,
  TaskResult,
} from "./core/types.ts";
