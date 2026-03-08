// ─────────────────────────────────────────────────────────────
// AETHER Agent Registry
// The brain of agent discovery — indexes agents by section,
// capability, and tier for fast resolution.
// ─────────────────────────────────────────────────────────────

import type {
  AgentDefinition,
  RegistrySection,
  AgentTier,
  AgentStatus,
  RegistryQuery,
} from "./types.ts";
import type { AetherStore } from "./storage/store.ts";

/** All possible registry sections for iteration */
const ALL_SECTIONS: RegistrySection[] = [
  "TOOLS",
  "MCP_SERVER",
  "SKILL",
  "WORKFLOW",
  "RESEARCH",
  "FRONTEND",
  "BACKEND",
  "MARKETING",
  "AUDIT",
  "SECURITY",
  "META",
];

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private sectionIndex: Map<RegistrySection, Set<string>> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();
  private tierIndex: Map<AgentTier, Set<string>> = new Map();
  private store?: AetherStore;
  private statusChangeCallback?: (agentId: string, status: AgentStatus) => void;

  constructor(store?: AetherStore) {
    this.store = store;
    // Pre-initialize section index buckets
    for (const section of ALL_SECTIONS) {
      this.sectionIndex.set(section, new Set());
    }
    // Tier index buckets are created lazily on agent registration
  }

  // ───────────────── Registration ─────────────────

  /**
   * Register a new agent definition.
   * Throws if an agent with the same ID already exists.
   */
  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(
        `AgentRegistry: duplicate agent ID "${agent.id}". Unregister the existing agent first.`,
      );
    }

    // Index in-memory
    this.indexAgent(agent);

    // Persist to store (write-through)
    this.store?.saveAgent(agent);
  }

  /**
   * Index an agent definition in-memory without writing to the persistent store.
   * Used by loadFromStore() to avoid wasteful store round-trips.
   */
  private indexAgent(agent: AgentDefinition): void {
    // Store agent
    this.agents.set(agent.id, { ...agent });

    // Index by sections
    for (const section of agent.sections) {
      let bucket = this.sectionIndex.get(section);
      if (!bucket) {
        bucket = new Set();
        this.sectionIndex.set(section, bucket);
      }
      bucket.add(agent.id);
    }

    // Index by capabilities (lowercase for case-insensitive matching)
    for (const cap of agent.capabilities) {
      const key = cap.toLowerCase();
      let bucket = this.capabilityIndex.get(key);
      if (!bucket) {
        bucket = new Set();
        this.capabilityIndex.set(key, bucket);
      }
      bucket.add(agent.id);
    }

    // Index by tier (lazy bucket creation)
    let tierBucket = this.tierIndex.get(agent.tier);
    if (!tierBucket) {
      tierBucket = new Set();
      this.tierIndex.set(agent.tier, tierBucket);
    }
    tierBucket.add(agent.id);
  }

  /**
   * Remove an agent from the registry and all indexes.
   * Returns true if the agent was found and removed.
   */
  unregister(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;

    // Remove from section index
    for (const section of agent.sections) {
      this.sectionIndex.get(section)?.delete(id);
    }

    // Remove from capability index
    for (const cap of agent.capabilities) {
      const key = cap.toLowerCase();
      const bucket = this.capabilityIndex.get(key);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) {
          this.capabilityIndex.delete(key);
        }
      }
    }

    // Remove from tier index
    this.tierIndex.get(agent.tier)?.delete(id);

    // Remove agent record
    this.agents.delete(id);

    // Persist deletion to store (write-through)
    this.store?.deleteAgent(id);

    return true;
  }

  // ───────────────── Lookups ─────────────────

  /** Get agent by ID. Tries exact match first, then suffix match (e.g. "db-architect" finds "postgres-db-architect"). */
  get(id: string): AgentDefinition | undefined {
    // Exact match
    const agent = this.agents.get(id);
    if (agent) return { ...agent };

    // Fallback: suffix match — find an agent whose ID ends with "-{id}"
    for (const [registeredId, registeredAgent] of this.agents) {
      if (registeredId.endsWith(`-${id}`)) {
        return { ...registeredAgent };
      }
    }

    return undefined;
  }

  /** Find all agents registered under a given section. */
  findBySection(section: RegistrySection): AgentDefinition[] {
    const ids = this.sectionIndex.get(section);
    if (!ids) return [];
    return this.resolveIds(ids);
  }

  /**
   * Find agents by capability string with fuzzy (substring) matching.
   * Searching "mcp" will match agents with capability "mcp-server-creation".
   * Case-insensitive.
   */
  findByCapability(capability: string): AgentDefinition[] {
    const needle = capability.toLowerCase();
    const matchedIds = new Set<string>();

    for (const [capKey, agentIds] of this.capabilityIndex) {
      if (capKey.includes(needle) || needle.includes(capKey)) {
        for (const id of agentIds) {
          matchedIds.add(id);
        }
      }
    }

    // Also do a direct scan of agent capabilities for substring matches
    // that the index may have missed (e.g., multi-word partial matches)
    for (const [id, agent] of this.agents) {
      if (matchedIds.has(id)) continue;
      for (const cap of agent.capabilities) {
        if (cap.toLowerCase().includes(needle)) {
          matchedIds.add(id);
          break;
        }
      }
    }

    return this.resolveIds(matchedIds);
  }

  /** Find all agents of a given tier. */
  findByTier(tier: AgentTier): AgentDefinition[] {
    const ids = this.tierIndex.get(tier);
    if (!ids) return [];
    return this.resolveIds(ids);
  }

  /**
   * Complex query — combine section, tier, capability, and status filters.
   * All provided filters are ANDed together.
   */
  query(q: RegistryQuery): AgentDefinition[] {
    let candidates: AgentDefinition[];

    // Start with the most selective filter to minimise work
    if (q.section !== undefined) {
      candidates = this.findBySection(q.section);
    } else if (q.tier !== undefined) {
      candidates = this.findByTier(q.tier);
    } else if (q.capability !== undefined) {
      candidates = this.findByCapability(q.capability);
    } else {
      candidates = this.getAll();
    }

    // Apply remaining filters
    if (q.section !== undefined) {
      candidates = candidates.filter((a) => a.sections.includes(q.section!));
    }
    if (q.tier !== undefined) {
      candidates = candidates.filter((a) => a.tier === q.tier);
    }
    if (q.capability !== undefined) {
      const needle = q.capability.toLowerCase();
      candidates = candidates.filter((a) =>
        a.capabilities.some((c) => c.toLowerCase().includes(needle)),
      );
    }
    if (q.status !== undefined) {
      candidates = candidates.filter((a) => a.status === q.status);
    }

    // Deduplicate (a candidate may appear from initial + filter overlap)
    const seen = new Set<string>();
    return candidates.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }

  // ───────────────── Status ─────────────────

  /**
   * Update the runtime status of an agent.
   * Throws if the agent does not exist.
   */
  updateStatus(id: string, status: AgentStatus): void {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`AgentRegistry: agent "${id}" not found.`);
    }
    agent.status = status;

    // Persist status change to store (write-through)
    this.store?.updateAgentStatus(id, status);

    // Notify callback (for cache invalidation, etc.)
    this.statusChangeCallback?.(id, status);
  }

  /**
   * Register a callback to be notified when any agent's status changes.
   * Used by the routing cache to invalidate entries for agents that go offline.
   */
  setStatusChangeCallback(
    cb: (agentId: string, status: AgentStatus) => void,
  ): void {
    this.statusChangeCallback = cb;
  }

  // ───────────────── Enumeration ─────────────────

  /** Return all registered agents (shallow copies). */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values()).map((a) => ({ ...a }));
  }

  /** Get agent count per registry section (useful for dashboards). */
  getSectionCounts(): Record<RegistrySection, number> {
    const counts = {} as Record<RegistrySection, number>;
    for (const section of ALL_SECTIONS) {
      counts[section] = this.sectionIndex.get(section)?.size ?? 0;
    }
    return counts;
  }

  // ───────────────── Resolution ─────────────────

  /**
   * Find the best agent for a needed capability.
   * Preference order:
   *   1. Idle agent with exact capability match
   *   2. Idle agent with fuzzy capability match
   *   3. Active agent with capability match
   *   4. Any non-offline agent with capability match
   * Returns undefined if no agent can service the capability.
   */
  resolve(capability: string): AgentDefinition | undefined {
    const matches = this.findByCapability(capability);
    if (matches.length === 0) return undefined;

    // Status priority: idle > active > busy > error (never return offline)
    const statusPriority: Record<AgentStatus, number> = {
      idle: 0,
      active: 1,
      busy: 2,
      error: 3,
      offline: 4,
    };

    // Sort by status priority, then by tier rank (higher rank = lower authority = used first)
    // This preserves expensive high-authority tiers for when they're truly needed.
    // Known tiers: worker(4) > manager(3) > master(2) > forge(1) > sentinel(0)
    const defaultTierRank: Record<string, number> = {
      worker: 4,
      manager: 3,
      master: 2,
      forge: 1,
      sentinel: 0,
    };

    const sorted = matches
      .filter((a) => a.status !== "offline")
      .sort((a, b) => {
        const statusDiff = statusPriority[a.status] - statusPriority[b.status];
        if (statusDiff !== 0) return statusDiff;
        // Higher rank number first (workers before managers before masters)
        const aRank = defaultTierRank[a.tier] ?? 3;
        const bRank = defaultTierRank[b.tier] ?? 3;
        return bRank - aRank;
      });

    return sorted.length > 0 ? sorted[0] : undefined;
  }

  // ───────────────── Escalation Chain ─────────────────

  /**
   * Build the escalation chain for a given agent.
   * Follows escalationTarget links: worker → manager → master.
   * Returns the chain *excluding* the starting agent.
   * Protects against cycles.
   */
  getEscalationChain(agentId: string): AgentDefinition[] {
    const chain: AgentDefinition[] = [];
    const visited = new Set<string>();
    let currentId: string | null = agentId;

    // Walk up the escalation targets
    while (currentId !== null) {
      if (visited.has(currentId)) break; // Cycle guard
      visited.add(currentId);

      const agent = this.agents.get(currentId);
      if (!agent) break;

      // Don't include the starting agent, only its targets
      if (currentId !== agentId) {
        chain.push({ ...agent });
      }

      currentId = agent.escalationTarget;
    }

    return chain;
  }

  // ───────────────── Store Hydration ─────────────────

  /**
   * Load all agents from the persistent store into in-memory Maps.
   * Clears the current in-memory state and re-indexes everything.
   * Throws if no store was provided to the constructor.
   */
  async loadFromStore(): Promise<void> {
    if (!this.store) {
      throw new Error(
        "AgentRegistry.loadFromStore: no store configured. Pass an AetherStore to the constructor.",
      );
    }

    // Clear current in-memory state
    this.agents.clear();
    for (const bucket of this.sectionIndex.values()) bucket.clear();
    for (const bucket of this.tierIndex.values()) bucket.clear();
    this.capabilityIndex.clear();

    // Fetch all agents from persistent store and re-index (in-memory only, no store write-back)
    const agents = await this.store.getAllAgents();
    for (const agent of agents) {
      this.indexAgent(agent);
    }
  }

  // ───────────────── Private helpers ─────────────────

  /** Resolve a set of IDs to their agent definitions (shallow copies). */
  private resolveIds(ids: Set<string>): AgentDefinition[] {
    const results: AgentDefinition[] = [];
    for (const id of ids) {
      const agent = this.agents.get(id);
      if (agent) results.push({ ...agent });
    }
    return results;
  }
}
