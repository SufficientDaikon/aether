// -----------------------------------------------------------------
// AETHER Tier Registry
//
// Extensible tier hierarchy system. Replaces the hardcoded
// "master" | "manager" | "worker" union with a configurable
// N-tier system supporting meta-agents (Forge, Sentinel),
// dynamic hierarchy, and constitutional oversight.
//
// Incorporates proven patterns from:
// - AutoGen 0.4 (factory registration)
// - Magentic-One (dual-ledger oversight)
// - DyLAN (importance scoring)
// - Constitutional AI (oversight principles)
// -----------------------------------------------------------------

/** Gate policy for escalation to a tier */
export type EscalationGatePolicy = "open" | "priority" | "tier-only";

/** Definition of a single tier in the hierarchy */
export interface TierDefinition {
  /** Unique tier name e.g. "sentinel", "forge", "master" */
  name: string;
  /** Rank in hierarchy — 0 = highest authority, higher = lower */
  rank: number;
  /** Max concurrent agents allowed in this tier */
  maxAgents: number;
  /** Default LLM model for agents in this tier */
  model: {
    provider: string;
    model: string;
  };
  /** Escalation rules */
  escalation: {
    /** Tier names this tier can escalate TO */
    targets: string[];
    /** Gate policy: "open" = always, "priority" = needs minPriority, "tier-only" = same or higher rank */
    gatePolicy: EscalationGatePolicy;
    /** Minimum priority required to escalate TO this tier (for "priority" policy on the target) */
    minPriority?: number;
  };
  /** Weighting factors for conflict resolution, RAG boosting, and cost */
  weights: {
    /** Conflict resolution weight (higher = more authority) */
    conflict: number;
    /** RAG search boost multiplier */
    ragBoost: number;
    /** Cost multiplier for routing decisions */
    costMultiplier: number;
  };
  /** Special capabilities granted to agents in this tier */
  capabilities?: string[];
  /** UI display color (#hex) */
  color?: string;
  /** UI icon name */
  icon?: string;
  /** Human-readable description */
  description?: string;
}

/** Helper type for IDE autocomplete on builtin tier names */
export type BuiltinTier =
  | "sentinel"
  | "forge"
  | "master"
  | "manager"
  | "worker";

// -----------------------------------------------------------------
// Built-in Tier Presets
// -----------------------------------------------------------------

const BUILTIN_TIERS: TierDefinition[] = [
  {
    name: "sentinel",
    rank: 0,
    maxAgents: 1,
    model: { provider: "claude", model: "opus" },
    escalation: { targets: [], gatePolicy: "open" },
    weights: { conflict: 5, ragBoost: 2.0, costMultiplier: 15 },
    capabilities: [
      "system_monitor",
      "constitutional_oversight",
      "force_kill",
      "health_ledger",
    ],
    color: "#e74c3c",
    icon: "shield",
    description: "System Guardian — monitors swarm health, enforces invariants",
  },
  {
    name: "forge",
    rank: 1,
    maxAgents: 1,
    model: { provider: "claude", model: "opus" },
    escalation: { targets: ["sentinel"], gatePolicy: "open" },
    weights: { conflict: 4, ragBoost: 1.8, costMultiplier: 12 },
    capabilities: ["spawn_agents", "retire_agents", "create_tiers"],
    color: "#9b59b6",
    icon: "flame",
    description:
      "Agent Factory — creates, retires, and evolves agents dynamically",
  },
  {
    name: "master",
    rank: 2,
    maxAgents: 1,
    model: { provider: "claude", model: "opus" },
    escalation: {
      targets: ["sentinel"],
      gatePolicy: "priority",
      minPriority: 4,
    },
    weights: { conflict: 3, ragBoost: 1.5, costMultiplier: 10 },
    color: "#f5a623",
    icon: "star-full",
    description: "Strategic planning, complex multi-domain reasoning",
  },
  {
    name: "manager",
    rank: 3,
    maxAgents: 3,
    model: { provider: "claude", model: "sonnet" },
    escalation: { targets: ["master", "sentinel"], gatePolicy: "open" },
    weights: { conflict: 2, ragBoost: 1.2, costMultiplier: 3 },
    color: "#4a9eff",
    icon: "organization",
    description: "Domain coordination, task decomposition",
  },
  {
    name: "worker",
    rank: 4,
    maxAgents: 10,
    model: { provider: "claude", model: "haiku" },
    escalation: { targets: ["manager"], gatePolicy: "open" },
    weights: { conflict: 1, ragBoost: 1.0, costMultiplier: 1 },
    color: "#5cb85c",
    icon: "person",
    description: "Task execution, specific skills",
  },
];

// -----------------------------------------------------------------
// Tier Registry
// -----------------------------------------------------------------

export class TierRegistry {
  private tiers: Map<string, TierDefinition> = new Map();
  private rankOrder: string[] = [];

  // ───────────────── Registration ─────────────────

  /**
   * Register a tier definition.
   * If a tier with the same name exists, it is replaced.
   */
  register(def: TierDefinition): void {
    this.tiers.set(def.name, { ...def });
    this.rebuildRankOrder();
  }

  /**
   * Remove a tier definition.
   * Returns true if the tier existed and was removed.
   */
  unregister(name: string): boolean {
    const removed = this.tiers.delete(name);
    if (removed) this.rebuildRankOrder();
    return removed;
  }

  // ───────────────── Lookups ─────────────────

  /** Get a tier definition by name. */
  get(name: string): TierDefinition | undefined {
    const def = this.tiers.get(name);
    return def ? { ...def } : undefined;
  }

  /** Check if a tier is registered. */
  has(name: string): boolean {
    return this.tiers.has(name);
  }

  /** Get all tier definitions (unordered). */
  getAll(): TierDefinition[] {
    return Array.from(this.tiers.values()).map((d) => ({ ...d }));
  }

  /** Get all tier definitions sorted by rank ascending (highest authority first). */
  getByRank(): TierDefinition[] {
    return this.rankOrder
      .map((name) => this.tiers.get(name)!)
      .map((d) => ({ ...d }));
  }

  /** Get the names of all registered tiers. */
  getNames(): string[] {
    return Array.from(this.tiers.keys());
  }

  /** Get tier count. */
  get size(): number {
    return this.tiers.size;
  }

  // ───────────────── Hierarchy Queries ─────────────────

  /**
   * Get the rank of a tier. Lower rank = higher authority.
   * Returns Infinity for unknown tiers.
   */
  getRank(tierName: string): number {
    return this.tiers.get(tierName)?.rank ?? Infinity;
  }

  /**
   * Check if tier `a` has higher authority than tier `b`.
   * Higher authority = lower rank number.
   */
  isHigherThan(a: string, b: string): boolean {
    return this.getRank(a) < this.getRank(b);
  }

  /** Get the escalation targets for a tier. */
  getEscalationTargets(tierName: string): string[] {
    return this.tiers.get(tierName)?.escalation.targets ?? [];
  }

  /**
   * Determine whether an agent in `fromTier` can escalate to `toTier`
   * given the current priority level.
   *
   * Checks:
   * 1. Is `toTier` in the escalation targets of `fromTier`?
   *    (If not explicitly listed, any tier with a lower rank is allowed
   *     via the fromTier's escalation chain.)
   * 2. Does the target tier's gate policy allow it?
   *    - "open": always allowed
   *    - "priority": requires priority >= target's minPriority
   *    - "tier-only": only allowed if fromTier rank is <= toTier rank - 1
   */
  canEscalateTo(fromTier: string, toTier: string, priority: number): boolean {
    const from = this.tiers.get(fromTier);
    const to = this.tiers.get(toTier);
    if (!from || !to) return false;

    // Check if toTier is in fromTier's allowed escalation targets
    if (!from.escalation.targets.includes(toTier)) {
      return false;
    }

    // Check target tier's gate policy
    switch (to.escalation.gatePolicy) {
      case "open":
        return true;
      case "priority":
        return priority >= (to.escalation.minPriority ?? 4);
      case "tier-only":
        // Only agents from a tier one rank above can escalate here
        return from.rank <= to.rank - 1;
      default:
        return true;
    }
  }

  /** Get the name of the highest-authority tier (lowest rank). */
  getTopTier(): string {
    return this.rankOrder[0] ?? "master";
  }

  // ───────────────── Weights ─────────────────

  /** Get conflict resolution weight for a tier (default: 1). */
  getConflictWeight(tierName: string): number {
    return this.tiers.get(tierName)?.weights.conflict ?? 1;
  }

  /** Get RAG search boost multiplier for a tier (default: 1.0). */
  getRagBoost(tierName: string): number {
    return this.tiers.get(tierName)?.weights.ragBoost ?? 1.0;
  }

  /** Get cost multiplier for a tier (default: 1). */
  getCostMultiplier(tierName: string): number {
    return this.tiers.get(tierName)?.weights.costMultiplier ?? 1;
  }

  // ───────────────── Model Routing ─────────────────

  /** Get the default model config for a tier. */
  getModelConfig(tierName: string): { provider: string; model: string } {
    const tier = this.tiers.get(tierName);
    if (tier) return { ...tier.model };
    // Fallback for unknown tiers
    return { provider: "claude", model: "haiku" };
  }

  // ───────────────── Capabilities ─────────────────

  /** Check if a tier has a specific capability. */
  hasCapability(tierName: string, cap: string): boolean {
    const tier = this.tiers.get(tierName);
    return tier?.capabilities?.includes(cap) ?? false;
  }

  /** Get all tier names that have a specific capability. */
  getTiersWithCapability(cap: string): string[] {
    const result: string[] = [];
    for (const [name, def] of this.tiers) {
      if (def.capabilities?.includes(cap)) {
        result.push(name);
      }
    }
    return result;
  }

  // ───────────────── Validation ─────────────────

  /**
   * Validate the tier registry for consistency.
   * Returns an array of error messages (empty = valid).
   */
  validate(): string[] {
    const errors: string[] = [];

    // Check rank uniqueness
    const ranks = new Map<number, string>();
    for (const [name, def] of this.tiers) {
      const existing = ranks.get(def.rank);
      if (existing) {
        errors.push(
          `Tiers "${existing}" and "${name}" have the same rank ${def.rank}`,
        );
      }
      ranks.set(def.rank, name);
    }

    // Check escalation targets reference existing tiers
    for (const [name, def] of this.tiers) {
      for (const target of def.escalation.targets) {
        if (!this.tiers.has(target)) {
          errors.push(
            `Tier "${name}" escalation target "${target}" does not exist`,
          );
        }
      }
    }

    // Check for circular escalation (A → B → A)
    for (const [name] of this.tiers) {
      const visited = new Set<string>();
      let current = name;
      let depth = 0;
      while (depth < this.tiers.size + 1) {
        if (visited.has(current)) {
          if (current === name && depth > 0) {
            errors.push(
              `Circular escalation detected involving tier "${name}"`,
            );
          }
          break;
        }
        visited.add(current);
        const targets = this.getEscalationTargets(current);
        if (targets.length === 0) break;
        current = targets[0]; // Follow first target for cycle detection
        depth++;
      }
    }

    // Check maxAgents is positive
    for (const [name, def] of this.tiers) {
      if (def.maxAgents < 1) {
        errors.push(`Tier "${name}" maxAgents must be at least 1`);
      }
    }

    return errors;
  }

  // ───────────────── Serialization ─────────────────

  /** Serialize all tier definitions to JSON-compatible array. */
  toJSON(): TierDefinition[] {
    return this.getByRank();
  }

  /** Create a TierRegistry from an array of tier definitions. */
  static fromJSON(defs: TierDefinition[]): TierRegistry {
    const registry = new TierRegistry();
    for (const def of defs) {
      registry.register(def);
    }
    return registry;
  }

  /**
   * Create a TierRegistry with the 5 built-in tiers.
   * This is the default for new installations.
   */
  static builtinTiers(): TierRegistry {
    return TierRegistry.fromJSON(BUILTIN_TIERS);
  }

  /**
   * Create a TierRegistry with only the classic 3 tiers
   * (master, manager, worker). For backward compatibility.
   */
  static classicTiers(): TierRegistry {
    return TierRegistry.fromJSON(
      BUILTIN_TIERS.filter((t) =>
        ["master", "manager", "worker"].includes(t.name),
      ),
    );
  }

  // ───────────────── Private ─────────────────

  /** Rebuild the sorted rank order array. */
  private rebuildRankOrder(): void {
    this.rankOrder = Array.from(this.tiers.entries())
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([name]) => name);
  }
}

/** Get the built-in tier presets array (for external use). */
export function getBuiltinTierPresets(): TierDefinition[] {
  return BUILTIN_TIERS.map((t) => ({ ...t }));
}
