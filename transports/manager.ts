// ─────────────────────────────────────────────────────────────
// AETHER Transport Manager
// Routes task execution to the correct transport based on the
// agent's transport config. For local agents (no transport
// config), falls through to the LLM provider path.
// ─────────────────────────────────────────────────────────────

import { BaseTransport, type TransportHealthCheck } from "./base.ts";
import { APITransport } from "./api.ts";
import { CLITransport } from "./cli.ts";
import { MCPTransport } from "./mcp.ts";
import { FederationTransport } from "./federation.ts";
import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  AgentTransport,
  TransportConfig,
} from "../core/types.ts";

/** Transport availability status */
export interface TransportStatus {
  type: AgentTransport;
  agentId: string;
  connected: boolean;
  lastHealthCheck?: TransportHealthCheck;
  lastChecked?: number;
}

export class TransportManager {
  /** Pool of transport instances keyed by agent ID */
  private transports: Map<string, BaseTransport> = new Map();

  /** Transport factories by type */
  private factories: Record<string, () => BaseTransport> = {
    api: () => new APITransport(),
    cli: () => new CLITransport(),
    mcp: () => new MCPTransport(),
    federation: () => new FederationTransport(),
  };

  /** Health check cache */
  private healthCache: Map<string, TransportStatus> = new Map();

  /**
   * Check whether an agent uses an external transport.
   * Returns false for local LLM agents.
   */
  isExternalAgent(agent: AgentDefinition): boolean {
    return agent.transport !== undefined;
  }

  /**
   * Execute a task through the agent's configured transport.
   * Automatically creates and connects the transport if needed.
   */
  async execute(
    task: TaskRequest,
    agent: AgentDefinition,
  ): Promise<TaskResult> {
    if (!agent.transport) {
      throw new Error(
        `Agent "${agent.id}" has no transport config — use the LLM provider path instead`,
      );
    }

    const transport = await this.getOrCreateTransport(agent);
    return transport.execute(task, agent, agent.transport);
  }

  /**
   * Run a health check on an agent's transport.
   */
  async checkHealth(agent: AgentDefinition): Promise<TransportHealthCheck> {
    if (!agent.transport) {
      return { healthy: true, latencyMs: 0, details: "Local LLM agent" };
    }

    const transport = await this.getOrCreateTransport(agent);
    const result = await transport.healthCheck(agent.transport);

    // Cache the result
    this.healthCache.set(agent.id, {
      type: agent.transport.transport,
      agentId: agent.id,
      connected: result.healthy,
      lastHealthCheck: result,
      lastChecked: Date.now(),
    });

    return result;
  }

  /**
   * Disconnect a specific agent's transport.
   */
  async disconnectAgent(agentId: string): Promise<void> {
    const transport = this.transports.get(agentId);
    if (transport) {
      await transport.disconnect();
      this.transports.delete(agentId);
    }
  }

  /**
   * Disconnect all active transports.
   */
  async disconnectAll(): Promise<void> {
    const disconnects = Array.from(this.transports.values()).map((t) =>
      t.disconnect().catch(() => {}),
    );
    await Promise.all(disconnects);
    this.transports.clear();
    this.healthCache.clear();
  }

  /**
   * Get status of all known transports.
   */
  getStatus(): TransportStatus[] {
    return Array.from(this.healthCache.values());
  }

  /**
   * Get or create a transport for an agent.
   * Reuses existing connections for stateful transports.
   */
  private async getOrCreateTransport(
    agent: AgentDefinition,
  ): Promise<BaseTransport> {
    const existing = this.transports.get(agent.id);
    if (existing?.isConnected()) {
      return existing;
    }

    const config = agent.transport!;
    const factory = this.factories[config.transport];

    if (!factory) {
      throw new Error(`Unknown transport type: "${config.transport}"`);
    }

    const transport = factory();

    try {
      await transport.connect(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to connect transport "${config.transport}" for agent "${agent.id}": ${msg}`,
      );
    }

    this.transports.set(agent.id, transport);
    return transport;
  }

  /**
   * Run health checks on all registered external agents in parallel.
   */
  async healthCheckAll(
    agents: AgentDefinition[],
  ): Promise<Map<string, TransportHealthCheck>> {
    const external = agents.filter((a) => a.transport);
    const results = new Map<string, TransportHealthCheck>();

    const checks = external.map(async (agent) => {
      const result = await this.checkHealth(agent);
      results.set(agent.id, result);
    });

    await Promise.allSettled(checks);
    return results;
  }
}
