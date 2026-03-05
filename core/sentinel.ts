// -----------------------------------------------------------------
// AETHER System Sentinel — Swarm Health Guardian
//
// Meta-agent that monitors swarm health, enforces constitutional
// rules, and manages dual-ledger tracking (Magentic-One inspired).
// Requires the "system_monitor" capability to operate.
// -----------------------------------------------------------------

import type { AgentRegistry } from "./registry.ts";
import type { TierRegistry } from "./tier-registry.ts";
import type { SynapseLogger } from "./logger.ts";
import type { AgentDefinition, AgentStatus } from "./types.ts";
import {
  ConstitutionalRulesEngine,
  DEFAULT_CONSTITUTIONAL_RULES,
} from "./constitutional-rules.ts";
import type {
  ConstitutionalRule,
  RuleEvaluationResult,
  ActionContext,
} from "./constitutional-rules.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface TaskLedgerEntry {
  taskId: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "escalated";
  assignedTo: string;
  startedAt?: number;
  completedAt?: number;
  notes?: string;
}

export interface FactsLedgerEntry {
  id: string;
  fact: string;
  source: string; // which agent discovered this
  timestamp: number;
  confidence: number; // 0-1
  category: "environment" | "task" | "capability" | "constraint" | "discovery";
}

export interface SwarmHealthReport {
  timestamp: number;
  agentCount: number;
  byTier: Record<string, number>;
  byStatus: Record<string, number>;
  stuckAgents: string[];
  idleAgents: string[];
  busyAgents: string[];
  errorAgents: string[];
  utilizationPercent: number;
  healthScore: number; // 0-100
}

export interface LoopDetection {
  agentId: string;
  pattern: string;
  occurrences: number;
  windowMs: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  score: number;
  issues: string[];
  recommendations: string[];
}

// -----------------------------------------------------------------
// System Sentinel
// -----------------------------------------------------------------

export class SystemSentinel {
  private registry: AgentRegistry;
  private tierRegistry: TierRegistry;
  private logger: SynapseLogger;
  private rulesEngine: ConstitutionalRulesEngine;

  // Dual-ledger system (Magentic-One inspired)
  private taskLedger: Map<string, TaskLedgerEntry> = new Map();
  private factsLedger: FactsLedgerEntry[] = [];

  // Health tracking
  private lastHealthCheck: SwarmHealthReport | null = null;
  private paused = false;

  // Action audit trail
  private actionLog: Array<{
    timestamp: number;
    action: ActionContext;
    result: RuleEvaluationResult;
  }> = [];

  constructor(
    registry: AgentRegistry,
    tierRegistry: TierRegistry,
    logger: SynapseLogger,
    rules?: ConstitutionalRule[],
  ) {
    this.registry = registry;
    this.tierRegistry = tierRegistry;
    this.logger = logger;
    this.rulesEngine = new ConstitutionalRulesEngine(
      rules ?? DEFAULT_CONSTITUTIONAL_RULES,
    );
  }

  // ── Health Monitoring ─────────────────────────────────────────

  /**
   * Get a comprehensive snapshot of swarm health.
   */
  getSwarmHealth(): SwarmHealthReport {
    const agents = this.registry.getAll();

    const byTier: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const stuckAgents: string[] = [];
    const idleAgents: string[] = [];
    const busyAgents: string[] = [];
    const errorAgents: string[] = [];

    for (const agent of agents) {
      byTier[agent.tier] = (byTier[agent.tier] ?? 0) + 1;
      byStatus[agent.status] = (byStatus[agent.status] ?? 0) + 1;

      switch (agent.status) {
        case "idle":
          idleAgents.push(agent.id);
          break;
        case "busy":
          busyAgents.push(agent.id);
          break;
        case "error":
          errorAgents.push(agent.id);
          break;
      }
    }

    const nonOffline = agents.filter((a) => a.status !== "offline");
    const utilizationPercent =
      nonOffline.length > 0 ? (busyAgents.length / nonOffline.length) * 100 : 0;

    // Health score: 100 - penalties
    let healthScore = 100;
    healthScore -= errorAgents.length * 15; // -15 per error agent
    healthScore -= stuckAgents.length * 10; // -10 per stuck agent
    if (agents.length === 0) healthScore = 0;
    healthScore = Math.max(0, Math.min(100, healthScore));

    const report: SwarmHealthReport = {
      timestamp: Date.now(),
      agentCount: agents.length,
      byTier,
      byStatus,
      stuckAgents,
      idleAgents,
      busyAgents,
      errorAgents,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      healthScore,
    };

    this.lastHealthCheck = report;
    return report;
  }

  /**
   * Detect agents that have been in "busy" status for too long.
   */
  detectStuckAgents(thresholdMs: number): string[] {
    // Without per-agent timing data, we report agents in error state
    // as potential stuck agents. In a full implementation, this would
    // compare the last status change timestamp against the threshold.
    const agents = this.registry.getAll();
    return agents
      .filter((a) => a.status === "error" || a.status === "busy")
      .map((a) => a.id);
  }

  /**
   * Get agent utilization percentage per agent.
   */
  getAgentUtilization(): Record<string, number> {
    const agents = this.registry.getAll();
    const utilization: Record<string, number> = {};

    for (const agent of agents) {
      // Simple utilization: busy=100%, active=50%, idle=0%, error=0%
      switch (agent.status) {
        case "busy":
          utilization[agent.id] = 100;
          break;
        case "active":
          utilization[agent.id] = 50;
          break;
        default:
          utilization[agent.id] = 0;
      }
    }

    return utilization;
  }

  // ── Constitutional Oversight ──────────────────────────────────

  /**
   * Evaluate an agent action against constitutional rules.
   */
  evaluateAction(action: ActionContext): RuleEvaluationResult {
    const result = this.rulesEngine.evaluate(action);

    // Log the evaluation
    this.actionLog.push({
      timestamp: Date.now(),
      action,
      result,
    });

    // Trim action log if it grows too large
    if (this.actionLog.length > 1000) {
      this.actionLog = this.actionLog.slice(-500);
    }

    if (!result.allowed) {
      this.logger.warn(
        "Sentinel",
        `Action blocked: agent="${action.agentId}" type="${action.type}" rule="${result.ruleId}" — ${result.message}`,
      );
    }

    return result;
  }

  /**
   * Get the constitutional rules engine for direct access.
   */
  getRulesEngine(): ConstitutionalRulesEngine {
    return this.rulesEngine;
  }

  /**
   * Get the action audit log.
   */
  getActionLog(limit?: number): typeof this.actionLog {
    if (limit) {
      return this.actionLog.slice(-limit);
    }
    return [...this.actionLog];
  }

  // ── Force Interventions ───────────────────────────────────────

  /**
   * Force an agent into error state (e.g. for stuck agents).
   */
  forceKillAgent(agentId: string, reason: string): void {
    const agent = this.registry.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    this.registry.updateStatus(agentId, "error");
    this.logger.warn("Sentinel", `Force-killed agent "${agentId}": ${reason}`);

    // Record in facts ledger
    this.addFact(
      `Agent "${agentId}" force-killed: ${reason}`,
      "sentinel",
      0.95,
      "constraint",
    );
  }

  /**
   * Pause all non-sentinel agents by setting them to offline.
   */
  pauseSwarm(reason: string): void {
    if (this.paused) return;

    const agents = this.registry.getAll();
    for (const agent of agents) {
      // Don't pause sentinel-tier agents
      const tierDef = this.tierRegistry.get(agent.tier);
      if (tierDef?.capabilities?.includes("system_monitor")) continue;

      if (agent.status !== "offline") {
        this.registry.updateStatus(agent.id, "offline");
      }
    }

    this.paused = true;
    this.logger.warn("Sentinel", `Swarm PAUSED: ${reason}`);
  }

  /**
   * Resume a paused swarm — set all offline agents back to idle.
   */
  resumeSwarm(): void {
    if (!this.paused) return;

    const agents = this.registry.getAll();
    for (const agent of agents) {
      if (agent.status === "offline") {
        this.registry.updateStatus(agent.id, "idle");
      }
    }

    this.paused = false;
    this.logger.info("Sentinel", "Swarm RESUMED");
  }

  /** Check if swarm is currently paused */
  isPaused(): boolean {
    return this.paused;
  }

  // ── Task Ledger (Magentic-One inspired) ───────────────────────

  updateTaskLedger(entry: TaskLedgerEntry): void {
    this.taskLedger.set(entry.taskId, entry);
  }

  getTaskLedgerEntry(taskId: string): TaskLedgerEntry | undefined {
    return this.taskLedger.get(taskId);
  }

  getTaskLedger(): TaskLedgerEntry[] {
    return [...this.taskLedger.values()];
  }

  getTaskLedgerByStatus(status: TaskLedgerEntry["status"]): TaskLedgerEntry[] {
    return [...this.taskLedger.values()].filter((e) => e.status === status);
  }

  // ── Facts Ledger (Magentic-One inspired) ──────────────────────

  addFact(
    fact: string,
    source: string,
    confidence: number,
    category: FactsLedgerEntry["category"],
  ): FactsLedgerEntry {
    const entry: FactsLedgerEntry = {
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fact,
      source,
      timestamp: Date.now(),
      confidence: Math.max(0, Math.min(1, confidence)),
      category,
    };
    this.factsLedger.push(entry);

    // Trim if too large
    if (this.factsLedger.length > 500) {
      this.factsLedger = this.factsLedger.slice(-250);
    }

    return entry;
  }

  getFactsLedger(category?: FactsLedgerEntry["category"]): FactsLedgerEntry[] {
    if (category) {
      return this.factsLedger.filter((f) => f.category === category);
    }
    return [...this.factsLedger];
  }

  getRecentFacts(limit: number): FactsLedgerEntry[] {
    return this.factsLedger.slice(-limit);
  }

  // ── Periodic Health Check ─────────────────────────────────────

  /**
   * Run a comprehensive health check. Called periodically by the runtime.
   */
  runHealthCheck(): HealthCheckResult {
    const health = this.getSwarmHealth();
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for error agents
    if (health.errorAgents.length > 0) {
      issues.push(
        `${health.errorAgents.length} agent(s) in error state: ${health.errorAgents.join(", ")}`,
      );
      recommendations.push(
        "Investigate error agents — consider restarting or retiring them",
      );
    }

    // Check for zero agents
    if (health.agentCount === 0) {
      issues.push("No agents registered in the swarm");
      recommendations.push("Register agents or use the forge to spawn workers");
    }

    // Check for high utilization
    if (health.utilizationPercent > 90) {
      issues.push(
        `High utilization: ${health.utilizationPercent}% of agents busy`,
      );
      recommendations.push(
        "Consider spawning additional worker agents to handle load",
      );
    }

    // Check for all idle (possible stall)
    if (
      health.agentCount > 0 &&
      health.idleAgents.length === health.agentCount
    ) {
      recommendations.push("All agents idle — swarm may be waiting for tasks");
    }

    const healthy = issues.length === 0;

    return {
      healthy,
      score: health.healthScore,
      issues,
      recommendations,
    };
  }

  // ── Introspection ─────────────────────────────────────────────

  getLastHealthCheck(): SwarmHealthReport | null {
    return this.lastHealthCheck;
  }

  getStatus(): {
    paused: boolean;
    taskLedgerSize: number;
    factsLedgerSize: number;
    actionLogSize: number;
    lastHealthScore: number | null;
    rulesCount: number;
  } {
    return {
      paused: this.paused,
      taskLedgerSize: this.taskLedger.size,
      factsLedgerSize: this.factsLedger.length,
      actionLogSize: this.actionLog.length,
      lastHealthScore: this.lastHealthCheck?.healthScore ?? null,
      rulesCount: this.rulesEngine.getRules().length,
    };
  }
}
