// -----------------------------------------------------------------
// AETHER Agent Forge — Dynamic Agent Factory
//
// Meta-agent that can spawn, retire, and evolve agents at runtime.
// Inspired by AutoGen factory patterns and DyLAN importance scoring.
// Requires the "spawn_agents" capability to operate.
// -----------------------------------------------------------------

import type { AgentRegistry } from "./registry.ts";
import type { TierRegistry } from "./tier-registry.ts";
import type { AetherStore } from "./storage/store.ts";
import type { SynapseLogger } from "./logger.ts";
import type { AgentDefinition, AgentTier, RegistrySection } from "./types.ts";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface AgentSpawnSpec {
  id: string;
  name: string;
  tier: string;
  capabilities: string[];
  systemPrompt: string;
  sections?: RegistrySection[];
  dependencies?: string[];
  escalationTarget?: string;
  ephemeral?: boolean; // auto-retire after task completion
}

export interface AgentContributionScore {
  agentId: string;
  score: number; // 0-1 normalized
  tasksCompleted: number;
  tasksFaild: number;
  avgDurationMs: number;
  avgTokensUsed: number;
  recommendation: "keep" | "retire" | "upgrade";
}

export interface TaskNeedsAnalysis {
  existingAgents: string[];
  gapCapabilities: string[];
  recommendedSpawns: AgentSpawnSpec[];
}

// -----------------------------------------------------------------
// Agent Forge
// -----------------------------------------------------------------

export class AgentForge {
  private registry: AgentRegistry;
  private tierRegistry: TierRegistry;
  private store: AetherStore;
  private logger: SynapseLogger;
  private agentsDir: string;

  /** Track ephemeral agents for auto-retirement */
  private ephemeralAgents: Set<string> = new Set();

  /** Track spawned agents for audit trail */
  private spawnLog: Array<{
    agentId: string;
    timestamp: number;
    spec: AgentSpawnSpec;
  }> = [];

  constructor(
    registry: AgentRegistry,
    tierRegistry: TierRegistry,
    store: AetherStore,
    logger: SynapseLogger,
    agentsDir: string,
  ) {
    this.registry = registry;
    this.tierRegistry = tierRegistry;
    this.store = store;
    this.logger = logger;
    this.agentsDir = agentsDir;
  }

  // ── Spawn ─────────────────────────────────────────────────────

  /**
   * Create a new agent at runtime from a specification.
   * Generates a .agent.md file, registers the agent, and persists to store.
   */
  spawnAgent(spec: AgentSpawnSpec): AgentDefinition {
    // Validate tier exists
    const tierDef = this.tierRegistry.get(spec.tier);
    if (!tierDef) {
      throw new Error(
        `Cannot spawn agent "${spec.id}": tier "${spec.tier}" is not registered`,
      );
    }

    // Check max agents for this tier
    const currentCount = this.registry.findByTier(
      spec.tier as AgentTier,
    ).length;
    if (currentCount >= tierDef.maxAgents) {
      throw new Error(
        `Cannot spawn agent "${spec.id}": tier "${spec.tier}" has reached max agents (${tierDef.maxAgents})`,
      );
    }

    // Check for duplicate ID
    if (this.registry.get(spec.id)) {
      throw new Error(
        `Cannot spawn agent "${spec.id}": agent with this ID already exists`,
      );
    }

    // Generate .agent.md file
    const filePath = join(this.agentsDir, `${spec.id}.agent.md`);
    const fileContent = this.generateAgentFile(spec);

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, fileContent, "utf-8");

    // Build agent definition
    const agent: AgentDefinition = {
      id: spec.id,
      name: spec.name,
      tier: spec.tier,
      sections: spec.sections ?? [],
      capabilities: spec.capabilities,
      dependencies: spec.dependencies ?? [],
      llmRequirement: tierDef.model.model as any,
      format: "markdown",
      escalationTarget: spec.escalationTarget ?? null,
      filePath,
      status: "idle",
      metadata: {
        spawnedBy: "forge",
        spawnedAt: new Date().toISOString(),
        ephemeral: spec.ephemeral ?? false,
      },
    };

    // Register
    this.registry.register(agent);

    // Persist with mtime
    this.store.saveAgentWithMtime(agent, Date.now());

    // Track ephemeral agents
    if (spec.ephemeral) {
      this.ephemeralAgents.add(spec.id);
    }

    // Audit trail
    this.spawnLog.push({
      agentId: spec.id,
      timestamp: Date.now(),
      spec,
    });

    this.logger.info(
      "Forge",
      `Spawned agent "${spec.id}" (tier: ${spec.tier}, capabilities: ${spec.capabilities.join(", ")})`,
    );

    return agent;
  }

  // ── Retire ────────────────────────────────────────────────────

  /**
   * Retire an agent: unregister, remove from store, optionally delete file.
   */
  retireAgent(agentId: string, reason: string, deleteFile = false): void {
    const agent = this.registry.get(agentId);
    if (!agent) {
      throw new Error(
        `Cannot retire agent "${agentId}": not found in registry`,
      );
    }

    // Don't allow retiring sentinel agents unless forced
    const tierDef = this.tierRegistry.get(agent.tier);
    if (tierDef?.capabilities?.includes("system_monitor")) {
      throw new Error(
        `Cannot retire agent "${agentId}": sentinel-tier agents cannot be retired through forge`,
      );
    }

    // Unregister from in-memory registry
    this.registry.unregister(agentId);

    // Remove from persistent store
    this.store.deleteAgent(agentId);

    // Clean up ephemeral tracking
    this.ephemeralAgents.delete(agentId);

    // Optionally delete the agent file
    if (deleteFile && agent.filePath) {
      try {
        if (existsSync(agent.filePath)) {
          unlinkSync(agent.filePath);
        }
      } catch {
        // Best-effort file deletion
      }
    }

    this.logger.info("Forge", `Retired agent "${agentId}" (reason: ${reason})`);
  }

  /**
   * Retire all ephemeral agents. Called after workflow completion.
   */
  retireEphemeralAgents(): string[] {
    const retired: string[] = [];
    for (const agentId of this.ephemeralAgents) {
      try {
        this.retireAgent(agentId, "ephemeral agent — task complete", true);
        retired.push(agentId);
      } catch {
        // Best-effort — agent may have already been retired
      }
    }
    return retired;
  }

  // ── Analysis ──────────────────────────────────────────────────

  /**
   * Analyze a task description to determine which existing agents can handle it,
   * what capability gaps exist, and recommend new agents to spawn.
   */
  analyzeTaskNeeds(
    description: string,
    requiredCapabilities: string[],
  ): TaskNeedsAnalysis {
    const existingAgents: string[] = [];
    const gapCapabilities: string[] = [];
    const recommendedSpawns: AgentSpawnSpec[] = [];

    // Find existing agents that match required capabilities
    for (const cap of requiredCapabilities) {
      const matches = this.registry.findByCapability(cap);
      const idleMatches = matches.filter((a) => a.status !== "offline");
      if (idleMatches.length > 0) {
        existingAgents.push(...idleMatches.map((a) => a.id));
      } else {
        gapCapabilities.push(cap);
      }
    }

    // Deduplicate existing agents
    const uniqueExisting = [...new Set(existingAgents)];

    // Recommend spawns for gap capabilities
    for (const cap of gapCapabilities) {
      const spec: AgentSpawnSpec = {
        id: `auto-${cap.replace(/\s+/g, "-").toLowerCase()}-${Date.now().toString(36)}`,
        name: `Auto ${cap}`,
        tier: "worker",
        capabilities: [cap],
        systemPrompt: `You are a specialized agent for: ${cap}. Task context: ${description}`,
        ephemeral: true,
      };
      recommendedSpawns.push(spec);
    }

    return {
      existingAgents: uniqueExisting,
      gapCapabilities,
      recommendedSpawns,
    };
  }

  // ── Scoring (DyLAN-inspired importance scoring) ───────────────

  /**
   * Score agent contributions for a workflow/task.
   * Uses task results from the store to calculate performance metrics.
   */
  scoreAgentContributions(taskIdPrefix?: string): AgentContributionScore[] {
    const agents = this.registry.getAll();
    const scores: AgentContributionScore[] = [];

    for (const agent of agents) {
      // Get task metrics from store
      const metrics = this.store.getTaskMetrics();
      const agentTasks = metrics.recentTasks
        ? metrics.recentTasks.filter((t: any) => t.executor === agent.id)
        : [];

      if (agentTasks.length === 0) {
        scores.push({
          agentId: agent.id,
          score: 0.5, // neutral score for agents with no history
          tasksCompleted: 0,
          tasksFaild: 0,
          avgDurationMs: 0,
          avgTokensUsed: 0,
          recommendation: "keep",
        });
        continue;
      }

      const completed = agentTasks.filter((t: any) => t.status === "success");
      const failed = agentTasks.filter((t: any) => t.status === "failure");
      const avgDuration =
        agentTasks.reduce((sum: number, t: any) => sum + (t.duration ?? 0), 0) /
        agentTasks.length;
      const avgTokens =
        agentTasks.reduce(
          (sum: number, t: any) => sum + (t.tokens_used ?? 0),
          0,
        ) / agentTasks.length;

      // Calculate composite score (0-1)
      const successRate =
        agentTasks.length > 0 ? completed.length / agentTasks.length : 0;
      const efficiencyScore = Math.max(0, 1 - avgDuration / 60000); // penalize slow agents
      const score = successRate * 0.7 + efficiencyScore * 0.3;

      // Determine recommendation
      let recommendation: "keep" | "retire" | "upgrade" = "keep";
      if (score < 0.3 && agentTasks.length >= 3) {
        recommendation = "retire";
      } else if (score > 0.8 && agentTasks.length >= 5) {
        recommendation = "upgrade";
      }

      scores.push({
        agentId: agent.id,
        score: Math.round(score * 100) / 100,
        tasksCompleted: completed.length,
        tasksFaild: failed.length,
        avgDurationMs: Math.round(avgDuration),
        avgTokensUsed: Math.round(avgTokens),
        recommendation,
      });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  // ── Introspection ─────────────────────────────────────────────

  /** Get the spawn audit log */
  getSpawnLog(): typeof this.spawnLog {
    return [...this.spawnLog];
  }

  /** Get list of currently tracked ephemeral agents */
  getEphemeralAgents(): string[] {
    return [...this.ephemeralAgents];
  }

  /** Get forge status summary */
  getStatus(): {
    totalSpawned: number;
    ephemeralActive: number;
    spawnLog: number;
  } {
    return {
      totalSpawned: this.spawnLog.length,
      ephemeralActive: this.ephemeralAgents.size,
      spawnLog: this.spawnLog.length,
    };
  }

  // ── Private helpers ───────────────────────────────────────────

  private generateAgentFile(spec: AgentSpawnSpec): string {
    const lines: string[] = [
      "---",
      `id: ${spec.id}`,
      `name: ${spec.name}`,
      `tier: ${spec.tier}`,
      `capabilities: [${spec.capabilities.join(", ")}]`,
    ];

    if (spec.sections && spec.sections.length > 0) {
      lines.push(`sections: [${spec.sections.join(", ")}]`);
    }
    if (spec.dependencies && spec.dependencies.length > 0) {
      lines.push(`dependencies: [${spec.dependencies.join(", ")}]`);
    }
    if (spec.escalationTarget) {
      lines.push(`escalationTarget: ${spec.escalationTarget}`);
    }
    if (spec.ephemeral) {
      lines.push(`ephemeral: true`);
    }

    lines.push("---", "", spec.systemPrompt, "");

    return lines.join("\n");
  }
}
