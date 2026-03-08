// ─────────────────────────────────────────────────────────────
// AETHER Context-Aware Agent Router
//
// Multi-strategy agent resolution that picks the best agent based
// on task content analysis. Strategies: direct ID, file ownership,
// capability scoring, historical success, section fallback, and
// load balancing. Supports namespace/context filtering and LRU
// routing cache for sub-millisecond repeat lookups.
// ─────────────────────────────────────────────────────────────

import type { AgentDefinition, RoutingDecision } from "./types.ts";
import type { AetherStore, VectorResult } from "./storage/store.ts";
import type { RAGIndex } from "./rag-index.ts";

// ─────────────────────────────────────────────────────────────
// LRU Routing Cache
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  decision: RoutingDecision;
  createdAt: number;
}

/** FNV-1a 32-bit hash for fast cache key generation */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

class RoutingCache {
  private entries = new Map<number, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 200, ttlMs: number = 300_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: number): RoutingDecision | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key);
      this.misses++;
      return null;
    }
    // Move to end for LRU (delete + re-insert)
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.decision;
  }

  set(key: number, decision: RoutingDecision): void {
    // If at capacity, evict oldest (first entry in Map iteration order)
    if (this.entries.size >= this.maxSize) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
    this.entries.set(key, { decision, createdAt: Date.now() });
  }

  /** Invalidate all entries routed to a specific agent */
  invalidateAgent(agentId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.decision.agent.id === agentId) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Clear all entries */
  invalidate(): void {
    this.entries.clear();
  }

  getStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────

export class AgentRouter {
  private store: AetherStore;
  private confidenceThreshold: number;
  private ragIndex: RAGIndex | null;

  // Context/namespace filtering
  private activeContext: string;
  private contexts: Record<string, string[]>;
  private contextFallback: boolean;

  // Routing cache
  private cache: RoutingCache | null;
  private cacheEnabled: boolean;

  constructor(
    store: AetherStore,
    confidenceThreshold: number = 0.6,
    ragIndex?: RAGIndex | null,
  ) {
    this.store = store;
    this.confidenceThreshold = confidenceThreshold;
    this.ragIndex = ragIndex ?? null;

    // Default context settings (overridden by configureContexts/configureCache)
    this.activeContext = "default";
    this.contexts = { default: ["*"] };
    this.contextFallback = true;

    // Cache disabled by default until configureCache() is called
    this.cacheEnabled = false;
    this.cache = null;
  }

  /** Update the RAGIndex reference (e.g. after late initialization) */
  setRAGIndex(ragIndex: RAGIndex | null): void {
    this.ragIndex = ragIndex;
  }

  // ── Context configuration ────────────────────────────────────

  /** Configure context/namespace settings from AetherSettings.routing */
  configureContexts(config: {
    activeContext: string;
    contexts: Record<string, string[]>;
    contextFallback: boolean;
  }): void {
    this.activeContext = config.activeContext;
    this.contexts = config.contexts;
    this.contextFallback = config.contextFallback;
  }

  /** Set the active context/namespace */
  setActiveContext(name: string): void {
    if (this.activeContext !== name) {
      this.activeContext = name;
      // Invalidate cache when context changes
      this.cache?.invalidate();
    }
  }

  /** Get the active context name */
  getActiveContext(): string {
    return this.activeContext;
  }

  /** Get all defined context names */
  getContextNames(): string[] {
    return Object.keys(this.contexts);
  }

  /** Define or update a context */
  setContext(name: string, agentIds: string[]): void {
    this.contexts[name] = agentIds;
    // Invalidate cache if this is the active context
    if (name === this.activeContext) {
      this.cache?.invalidate();
    }
  }

  // ── Cache configuration ──────────────────────────────────────

  /** Configure routing cache from AetherSettings.routing.cache */
  configureCache(config: {
    enabled: boolean;
    maxSize: number;
    ttlMs: number;
  }): void {
    this.cacheEnabled = config.enabled;
    if (config.enabled) {
      this.cache = new RoutingCache(config.maxSize, config.ttlMs);
    } else {
      this.cache = null;
    }
  }

  /** Notify router that an agent's status changed (invalidates cached routes to that agent) */
  onAgentStatusChange(agentId: string): void {
    this.cache?.invalidateAgent(agentId);
  }

  /** Clear the entire routing cache */
  clearCache(): void {
    this.cache?.invalidate();
  }

  /** Get cache statistics */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } | null {
    return this.cache?.getStats() ?? null;
  }

  // ── Context filtering ────────────────────────────────────────

  /** Filter agents by the active context. ["*"] means all agents pass. */
  private filterByContext(agents: AgentDefinition[]): AgentDefinition[] {
    const contextAgentIds = this.contexts[this.activeContext];
    if (!contextAgentIds || contextAgentIds.length === 0) return [];
    if (contextAgentIds.includes("*")) return agents;
    const idSet = new Set(contextAgentIds);
    return agents.filter((a) => idSet.has(a.id));
  }

  // ── Main resolution ──────────────────────────────────────────

  /**
   * Resolve the best agent for a task. Filters by active context,
   * checks cache, evaluates all strategies, caches result.
   */
  async resolve(
    taskDescription: string,
    agents: AgentDefinition[],
    options?: {
      targetId?: string;
      filePaths?: string[];
      queryRAG?: (
        query: string,
        namespace: string,
        topK: number,
      ) => VectorResult[];
    },
  ): Promise<RoutingDecision | null> {
    if (agents.length === 0) return null;

    // Direct ID match bypasses context filtering and cache
    if (options?.targetId) {
      const direct = this.directMatch(options.targetId, agents);
      if (direct) return direct;
    }

    // Filter agents by active context
    let contextAgents = this.filterByContext(agents);

    // Check cache (keyed on context + task description)
    if (this.cacheEnabled && this.cache) {
      const cacheKey = fnv1aHash(this.activeContext + ":" + taskDescription);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        // Verify agent is still available (not offline/error)
        if (
          cached.agent.status !== "offline" &&
          cached.agent.status !== "error"
        ) {
          return {
            ...cached,
            strategy: cached.strategy + " (cached)",
          };
        }
        // Stale — remove and re-resolve
        this.cache.invalidateAgent(cached.agent.id);
      }
    }

    // Run strategies on context-filtered agents
    let result = await this.runStrategies(
      taskDescription,
      contextAgents,
      options,
    );

    // Context fallback: if no match in active context, try all agents
    if (
      !result &&
      this.contextFallback &&
      contextAgents.length < agents.length
    ) {
      result = await this.runStrategies(taskDescription, agents, options);
    }

    // Cache the result
    if (result && this.cacheEnabled && this.cache) {
      const cacheKey = fnv1aHash(this.activeContext + ":" + taskDescription);
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Run all routing strategies (except direct ID) on the given agent set.
   * Returns the highest-confidence match above threshold, or load-balance fallback.
   */
  private async runStrategies(
    taskDescription: string,
    agents: AgentDefinition[],
    options?: {
      targetId?: string;
      filePaths?: string[];
      queryRAG?: (
        query: string,
        namespace: string,
        topK: number,
      ) => VectorResult[];
    },
  ): Promise<RoutingDecision | null> {
    if (agents.length === 0) return null;

    const candidates: RoutingDecision[] = [];

    // Strategy 2: File ownership routing
    if (options?.filePaths && options.filePaths.length > 0) {
      const owner = this.fileOwnershipMatch(options.filePaths, agents);
      if (owner) candidates.push(owner);
    }

    // Strategy 3: Capability scoring (vector ANN or token fallback)
    const capMatch = await this.capabilityScore(taskDescription, agents);
    if (capMatch) candidates.push(capMatch);

    // Strategy 4: Historical success (RAG-based)
    if (options?.queryRAG) {
      const historical = this.historicalMatch(
        taskDescription,
        agents,
        options.queryRAG,
      );
      if (historical) candidates.push(historical);
    }

    // Strategy 5: Section-based fallback
    const sectionMatch = this.sectionMatch(taskDescription, agents);
    if (sectionMatch) candidates.push(sectionMatch);

    // Pick the highest-confidence candidate above threshold
    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    if (!best || best.confidence < this.confidenceThreshold) {
      return this.loadBalance(agents);
    }

    return best;
  }

  // ── Strategies ─────────────────────────────────────────────

  private directMatch(
    targetId: string,
    agents: AgentDefinition[],
  ): RoutingDecision | null {
    const agent = agents.find((a) => a.id === targetId);
    if (!agent) return null;
    return {
      agent,
      confidence: 1.0,
      strategy: "direct-id",
      reason: "Direct ID match: " + targetId,
    };
  }

  private fileOwnershipMatch(
    filePaths: string[],
    agents: AgentDefinition[],
  ): RoutingDecision | null {
    const agentScores = new Map<string, number>();

    for (const filePath of filePaths) {
      const owners = this.store.findOwners(filePath);
      for (const rule of owners) {
        const weight = rule.ruleType === "owns" ? 2 : 1;
        agentScores.set(
          rule.agentId,
          (agentScores.get(rule.agentId) ?? 0) + weight,
        );
      }
    }

    if (agentScores.size === 0) return null;

    let bestId = "";
    let bestScore = 0;
    for (const [id, score] of agentScores) {
      if (score > bestScore) {
        bestId = id;
        bestScore = score;
      }
    }

    const agent = agents.find((a) => a.id === bestId);
    if (!agent) return null;

    const maxPossible = filePaths.length * 2;
    return {
      agent,
      confidence: Math.min(0.95, 0.5 + (bestScore / maxPossible) * 0.5),
      strategy: "file-ownership",
      reason: "Owns " + bestScore + " file path matches",
    };
  }

  /**
   * Capability scoring: prefers vector ANN search via RAGIndex when available,
   * falls back to O(N) token matching otherwise.
   */
  private async capabilityScore(
    taskDescription: string,
    agents: AgentDefinition[],
  ): Promise<RoutingDecision | null> {
    // Try vector path first (O(log N) via sqlite-vec ANN)
    if (this.ragIndex) {
      const vectorResult = await this.vectorCapabilityScore(
        taskDescription,
        agents,
      );
      if (vectorResult) return vectorResult;
    }

    // Fallback to token matching (O(N))
    return this.tokenCapabilityScore(taskDescription, agents);
  }

  /**
   * Vector-powered capability scoring via RAGIndex.
   * Embeds the task description and queries the "agents" namespace
   * for the nearest agent embeddings. O(log N) via sqlite-vec ANN.
   */
  private async vectorCapabilityScore(
    taskDescription: string,
    agents: AgentDefinition[],
  ): Promise<RoutingDecision | null> {
    if (!this.ragIndex) return null;

    try {
      // Build a set of available agent IDs for fast filtering
      const availableIds = new Set(agents.map((a) => a.id));

      // Query the "agents" vector namespace
      const results = await this.ragIndex.query(taskDescription, {
        namespace: "agents",
        topK: 10,
      });
      if (!results || results.length === 0) return null;

      // Find the best match that's in our available agents list
      for (const result of results) {
        const agentId = result.metadata.sourceId ?? result.id;
        if (!availableIds.has(agentId)) continue;

        const agent = agents.find((a) => a.id === agentId);
        if (!agent) continue;

        // Convert similarity score to confidence (score is 0-1, higher = more similar)
        const statusBoost = agent.status === "idle" ? 0.05 : 0;
        const confidence = Math.min(0.95, result.score + statusBoost);

        if (confidence < 0.1) continue;

        return {
          agent,
          confidence,
          strategy: "capability-vector",
          reason:
            "Vector similarity: " +
            result.score.toFixed(3) +
            " (agent: " +
            agentId +
            ")",
        };
      }

      return null;
    } catch {
      // Vector search failed — fall through to token matching
      return null;
    }
  }

  /**
   * Token-based capability scoring (original O(N) implementation).
   * Used as fallback when RAGIndex is not available.
   */
  private tokenCapabilityScore(
    taskDescription: string,
    agents: AgentDefinition[],
  ): RoutingDecision | null {
    const taskTokens = this.tokenize(taskDescription);
    if (taskTokens.length === 0) return null;

    let bestAgent: AgentDefinition | null = null;
    let bestScore = 0;

    for (const agent of agents) {
      const capTokens = new Set<string>();
      for (const cap of agent.capabilities) {
        for (const token of this.tokenize(cap)) {
          capTokens.add(token);
        }
      }
      for (const token of this.tokenize(agent.name)) {
        capTokens.add(token);
      }

      let matches = 0;
      for (const token of taskTokens) {
        if (capTokens.has(token)) {
          matches++;
        } else {
          for (const capToken of capTokens) {
            if (capToken.includes(token) || token.includes(capToken)) {
              matches += 0.5;
              break;
            }
          }
        }
      }

      const score = matches / taskTokens.length;
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    if (!bestAgent || bestScore < 0.1) return null;

    const statusBoost = bestAgent.status === "idle" ? 0.1 : 0;

    return {
      agent: bestAgent,
      confidence: Math.min(0.9, bestScore + statusBoost),
      strategy: "capability-score",
      reason: "Capability match score: " + bestScore.toFixed(2),
    };
  }

  private historicalMatch(
    taskDescription: string,
    agents: AgentDefinition[],
    queryRAG: (query: string, ns: string, topK: number) => VectorResult[],
  ): RoutingDecision | null {
    try {
      const results = queryRAG(taskDescription, "tasks", 5);
      if (results.length === 0) return null;

      const agentSuccessCount = new Map<string, number>();
      for (const result of results) {
        const agentId = result.metadata?.executor as string;
        if (agentId && result.metadata?.status === "success") {
          agentSuccessCount.set(
            agentId,
            (agentSuccessCount.get(agentId) ?? 0) + 1,
          );
        }
      }

      if (agentSuccessCount.size === 0) return null;

      let bestId = "";
      let bestCount = 0;
      for (const [id, count] of agentSuccessCount) {
        if (count > bestCount && agents.some((a) => a.id === id)) {
          bestId = id;
          bestCount = count;
        }
      }

      const agent = agents.find((a) => a.id === bestId);
      if (!agent) return null;

      return {
        agent,
        confidence: Math.min(0.85, 0.5 + bestCount * 0.1),
        strategy: "historical-success",
        reason: bestCount + " successful similar tasks in history",
      };
    } catch {
      return null;
    }
  }

  private sectionMatch(
    taskDescription: string,
    agents: AgentDefinition[],
  ): RoutingDecision | null {
    const lower = taskDescription.toLowerCase();

    const sectionKeywords: Record<string, string[]> = {
      FRONTEND: [
        "react",
        "vue",
        "angular",
        "css",
        "html",
        "component",
        "ui",
        "frontend",
        "browser",
        "dom",
      ],
      BACKEND: [
        "api",
        "server",
        "database",
        "rest",
        "graphql",
        "backend",
        "endpoint",
        "middleware",
      ],
      TOOLS: [
        "build",
        "lint",
        "format",
        "test",
        "deploy",
        "ci",
        "cd",
        "docker",
        "script",
      ],
      SECURITY: [
        "auth",
        "security",
        "permission",
        "token",
        "encrypt",
        "ssl",
        "vulnerability",
      ],
      RESEARCH: [
        "research",
        "analyze",
        "investigate",
        "explore",
        "study",
        "review",
      ],
    };

    let bestSection = "";
    let bestKeywordCount = 0;

    for (const [section, keywords] of Object.entries(sectionKeywords)) {
      const count = keywords.filter((kw) => lower.includes(kw)).length;
      if (count > bestKeywordCount) {
        bestKeywordCount = count;
        bestSection = section;
      }
    }

    if (!bestSection || bestKeywordCount === 0) return null;

    const sectionAgents = agents.filter((a) =>
      a.sections.includes(bestSection as any),
    );
    if (sectionAgents.length === 0) return null;

    const idle = sectionAgents.find((a) => a.status === "idle");
    const agent = idle ?? sectionAgents[0];

    return {
      agent,
      confidence: Math.min(0.7, 0.3 + bestKeywordCount * 0.1),
      strategy: "section-fallback",
      reason:
        'Section "' +
        bestSection +
        '" matched ' +
        bestKeywordCount +
        " keywords",
    };
  }

  private loadBalance(agents: AgentDefinition[]): RoutingDecision | null {
    const available = agents.filter(
      (a) => a.status !== "offline" && a.status !== "error",
    );
    if (available.length === 0) return null;

    const idle = available.filter((a) => a.status === "idle");
    const agent =
      idle.length > 0
        ? idle[Math.floor(Math.random() * idle.length)]
        : available[Math.floor(Math.random() * available.length)];

    return {
      agent,
      confidence: 0.3,
      strategy: "load-balance",
      reason: "Fallback load-balanced selection",
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  /** Extract file paths mentioned in a task description */
  static extractFilePaths(text: string): string[] {
    const patterns = [
      /(?:^|\s)((?:\.\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.\w+)/gm,
      /`((?:[\w.-]+\/)+[\w.-]+\.\w+)`/g,
    ];

    const paths = new Set<string>();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        paths.add(match[1].trim());
      }
    }
    return [...paths];
  }
}
