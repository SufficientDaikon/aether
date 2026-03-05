// ─────────────────────────────────────────────────────────────
// AETHER Escalation Manager
// Circuit-breaker–protected escalation chain logic.
// Prevents runaway escalation loops and shields the master
// agent from low-priority noise.
// ─────────────────────────────────────────────────────────────

import type { EscalationRecord, AgentDefinition, Priority } from "./types.ts";
import type { AgentRegistry } from "./registry.ts";
import type { AetherStore } from "./storage/store.ts";

export interface EscalationResult {
  /** The agent to escalate to, or null if circuit broken / no target */
  target: AgentDefinition | null;
  /** Whether the circuit breaker tripped */
  circuitBroken: boolean;
  /** Human-readable recommendation */
  recommendation: string;
}

export interface EscalationStats {
  totalEscalations: number;
  circuitsBroken: number;
  byAgent: Record<string, number>;
  masterEscalations: number;
}

export class EscalationManager {
  private records: Map<string, EscalationRecord> = new Map();

  /** Number of escalations within the window before circuit trips */
  private circuitBreakerThreshold: number;
  /** Time window in ms for the circuit breaker (default 5 min) */
  private circuitBreakerWindow: number;
  /** Reference to the agent registry for chain lookups */
  private registry: AgentRegistry;
  /** Optional persistent store — if null, everything stays in-memory only */
  private store: AetherStore | null;

  /**
   * Master weight multiplier.
   * Represents the relative cost of engaging high-authority agents.
   * Default weights by tier: sentinel=15, forge=12, master=10, manager=3, worker=1.
   */
  private readonly MASTER_WEIGHT = 10;

  /** Running counter of escalations that reached high-authority tiers */
  private masterEscalationCount = 0;

  /** Tier gate policies — defines which tiers require priority checks to escalate to.
   *  Key: target tier name. Value: { gatePolicy, minPriority, allowedSourceTiers }.
   *  Default: master requires priority >= 4 or source tier "manager". */
  private tierGates: Map<string, {
    gatePolicy: "open" | "priority" | "tier-only";
    minPriority: number;
    allowedSourceTiers: string[];
  }> = new Map([
    ["master", { gatePolicy: "priority", minPriority: 4, allowedSourceTiers: ["manager", "forge", "sentinel"] }],
    ["sentinel", { gatePolicy: "priority", minPriority: 4, allowedSourceTiers: ["master", "forge"] }],
  ]);

  constructor(
    registry: AgentRegistry,
    options?: { threshold?: number; windowMs?: number; store?: AetherStore },
  ) {
    this.registry = registry;
    this.circuitBreakerThreshold = options?.threshold ?? 3;
    this.circuitBreakerWindow = options?.windowMs ?? 300_000;
    this.store = options?.store ?? null;
  }

  // ───────────────── Core escalation ─────────────────

  /**
   * Record an escalation attempt from an agent and determine the target.
   *
   * Rules:
   * 1. If the agent's circuit breaker is already tripped → block.
   * 2. Record the escalation, increment counter.
   * 3. If counter hits threshold → trip circuit breaker.
   * 4. Walk the escalation chain from the registry.
   * 5. Master receives escalations ONLY from managers or priority ≥ 4.
   */
  escalate(
    fromAgentId: string,
    reason: string,
    priority: Priority,
  ): EscalationResult {
    const now = Date.now();

    // ── Ensure record exists & prune stale entries ──
    let record = this.records.get(fromAgentId);
    if (!record) {
      record = {
        agentId: fromAgentId,
        count: 0,
        lastEscalation: 0,
        reasons: [],
      };
      this.records.set(fromAgentId, record);
    }

    // Reset counter if outside the rolling window
    if (now - record.lastEscalation > this.circuitBreakerWindow) {
      record.count = 0;
      record.reasons = [];
    }

    // ── Check existing circuit breaker ──
    if (this.isCircuitBroken(fromAgentId)) {
      return {
        target: null,
        circuitBroken: true,
        recommendation:
          `Circuit breaker OPEN for agent "${fromAgentId}". ` +
          `${record.count} escalations in the last ${this.circuitBreakerWindow / 1000}s. ` +
          `Requires human review — call resetCircuit("${fromAgentId}") after investigation.`,
      };
    }

    // ── Record this escalation ──
    record.count += 1;
    record.lastEscalation = now;
    record.reasons.push(reason);
    this.store?.saveEscalationRecord(fromAgentId, record);

    // ── Trip circuit breaker if threshold reached ──
    if (record.count >= this.circuitBreakerThreshold) {
      return {
        target: null,
        circuitBroken: true,
        recommendation:
          `Circuit breaker TRIPPED for agent "${fromAgentId}" ` +
          `(${record.count}/${this.circuitBreakerThreshold} escalations in window). ` +
          `Reasons: ${record.reasons.join("; ")}. ` +
          `Human review required.`,
      };
    }

    // ── Determine escalation target ──
    const fromAgent = this.registry.get(fromAgentId);
    if (!fromAgent) {
      return {
        target: null,
        circuitBroken: false,
        recommendation: `Agent "${fromAgentId}" is not registered. Cannot determine escalation target.`,
      };
    }

    const chain = this.registry.getEscalationChain(fromAgentId);
    if (chain.length === 0) {
      return {
        target: null,
        circuitBroken: false,
        recommendation:
          `Agent "${fromAgentId}" has no escalation target configured. ` +
          `This may be the top of the hierarchy — consider human intervention.`,
      };
    }

    // Walk the chain and find the right target
    for (const candidate of chain) {
      // Check if this candidate's tier has a gate policy
      const gate = this.tierGates.get(candidate.tier);
      if (gate) {
        if (this.canPassTierGate(fromAgentId, priority, gate)) {
          this.masterEscalationCount++;
          this.store?.incrementMasterEscalationCount();
          return {
            target: candidate,
            circuitBroken: false,
            recommendation:
              `Escalated to ${candidate.tier} "${candidate.id}" ` +
              `(priority ${priority}, weight ×${this.MASTER_WEIGHT}). ` +
              `Reason: ${reason}`,
          };
        }
        // Gate blocked — skip this candidate, no further chain
        return {
          target: null,
          circuitBroken: false,
          recommendation:
            `Escalation from "${fromAgentId}" blocked at ${candidate.tier} gate. ` +
            `Only allowed source tiers or priority >= ${gate.minPriority} may reach ${candidate.tier}. ` +
            `Current priority: ${priority}. Consider re-prioritising or resolving at a lower tier.`,
        };
      }

      // Non-gated target: always allowed
      return {
        target: candidate,
        circuitBroken: false,
        recommendation:
          `Escalated from "${fromAgentId}" to "${candidate.id}" ` +
          `(${candidate.tier}). Reason: ${reason}`,
      };
    }

    // Shouldn't reach here, but safety net
    return {
      target: null,
      circuitBroken: false,
      recommendation: `No suitable escalation target found for "${fromAgentId}".`,
    };
  }

  // ───────────────── Circuit breaker ─────────────────

  /**
   * Check whether the circuit breaker is currently open for an agent.
   * Open = the agent has reached or exceeded the threshold within the window.
   */
  isCircuitBroken(agentId: string): boolean {
    const record = this.records.get(agentId);
    if (!record) return false;

    const now = Date.now();
    // If the window has elapsed, the circuit auto-resets
    if (now - record.lastEscalation > this.circuitBreakerWindow) {
      return false;
    }

    return record.count >= this.circuitBreakerThreshold;
  }

  /**
   * Manually reset the circuit breaker for an agent.
   * Typically called after human review.
   */
  resetCircuit(agentId: string): void {
    const record = this.records.get(agentId);
    if (record) {
      record.count = 0;
      record.reasons = [];
      record.lastEscalation = 0;
    }
    this.store?.clearEscalationRecord(agentId);
  }

  // ───────────────── Tier gate ─────────────────

  /**
   * Determine whether an escalation should be allowed to reach a gated tier.
   *
   * Rules:
   * - Priority >= gate.minPriority → always allowed regardless of source tier.
   * - Source agent is in gate.allowedSourceTiers → always allowed regardless of priority.
   * - Otherwise → blocked.
   *
   * Backward compatible: master gate = priority >= 4 OR source is manager/forge/sentinel.
   */
  private canPassTierGate(
    fromAgentId: string,
    priority: Priority,
    gate: { gatePolicy: string; minPriority: number; allowedSourceTiers: string[] },
  ): boolean {
    if (gate.gatePolicy === "open") return true;

    // High priority always gets through
    if (priority >= gate.minPriority) return true;

    // Check if source agent's tier is in the allowed list
    const agent = this.registry.get(fromAgentId);
    if (agent && gate.allowedSourceTiers.includes(agent.tier)) return true;

    return false;
  }

  /**
   * Backward-compatible alias for shouldReachMaster.
   * @deprecated Use canPassTierGate internally.
   */
  shouldReachMaster(fromAgentId: string, priority: Priority): boolean {
    const gate = this.tierGates.get("master");
    if (!gate) return priority >= 4;
    return this.canPassTierGate(fromAgentId, priority, gate);
  }

  // ───────────────── Persistence ─────────────────

  /**
   * Load escalation records and master count from the persistent store
   * into the in-memory Map. No-op if no store is configured.
   */
  loadFromStore(): void {
    if (!this.store) return;

    // Load escalation records for every registered agent
    for (const agent of this.registry.getAll()) {
      const persisted = this.store.getEscalationRecord(agent.id);
      if (persisted) {
        this.records.set(agent.id, persisted);
      }
    }

    // Also load the master escalation count
    this.masterEscalationCount = this.store.getMasterEscalationCount();
  }

  // ───────────────── Statistics ─────────────────

  /** Aggregate escalation statistics across all tracked agents. */
  getStats(): EscalationStats {
    let totalEscalations = 0;
    let circuitsBroken = 0;
    const byAgent: Record<string, number> = {};

    for (const [agentId, record] of this.records) {
      totalEscalations += record.count;
      byAgent[agentId] = record.count;
      if (this.isCircuitBroken(agentId)) {
        circuitsBroken++;
      }
    }

    return {
      totalEscalations,
      circuitsBroken,
      byAgent,
      masterEscalations:
        this.store?.getMasterEscalationCount() ?? this.masterEscalationCount,
    };
  }

  // ───────────────── Maintenance ─────────────────

  /**
   * Prune escalation records that are outside the circuit breaker window.
   * Call periodically to free memory in long-running processes.
   */
  prune(): void {
    const now = Date.now();
    const staleIds: string[] = [];

    for (const [agentId, record] of this.records) {
      if (now - record.lastEscalation > this.circuitBreakerWindow) {
        staleIds.push(agentId);
      }
    }

    for (const id of staleIds) {
      this.records.delete(id);
    }
  }
}
