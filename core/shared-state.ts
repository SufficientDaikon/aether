// -----------------------------------------------------------------
// AETHER Observable Shared State Bus
//
// Centralized workflow state visible to all participants.
// Immutable state transitions via update() with versioning,
// transition history, communication graph tracking,
// MemoryHighway notifications, and KV persistence.
// -----------------------------------------------------------------

import type { MemoryHighway } from "./memory-highway.ts";
import type { SynapseLogger } from "./logger.ts";
import type { AetherStore } from "./storage/store.ts";
import type {
  BusState,
  BusUpdate,
  StateTransition,
  CommEdge,
  ACPMessageType,
} from "./types.ts";

// -----------------------------------------------------------------
// Config
// -----------------------------------------------------------------

export interface SharedStateBusConfig {
  /** Interval in ms for background KV cleanup (default: 300_000 = 5 min) */
  cleanupIntervalMs: number;
  /** Max transitions to retain per session (default: 1000) */
  maxTransitionsPerSession: number;
  /** Publish state changes to MemoryHighway (default: true) */
  publishChanges: boolean;
  /** Persist sessions to KV store (default: true) */
  persistSessions: boolean;
}

const DEFAULT_CONFIG: SharedStateBusConfig = {
  cleanupIntervalMs: 300_000,
  maxTransitionsPerSession: 1000,
  publishChanges: true,
  persistSessions: true,
};

// -----------------------------------------------------------------
// Shared State Bus
// -----------------------------------------------------------------

export class SharedStateBus {
  private highway: MemoryHighway;
  private logger: SynapseLogger;
  private store: AetherStore | null;
  private config: SharedStateBusConfig;

  /** Active sessions */
  private sessions: Map<string, BusState> = new Map();

  /** Transition history per session */
  private transitions: Map<string, StateTransition[]> = new Map();

  /** Background cleanup timer handle */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    highway: MemoryHighway,
    logger: SynapseLogger,
    store?: AetherStore | null,
    config?: Partial<SharedStateBusConfig>,
  ) {
    this.highway = highway;
    this.logger = logger;
    this.store = store ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Session Management ──────────────────────────────────────

  /** Create a new session with initial state */
  createSession(
    sessionId: string,
    goal: string,
    initialValues?: Record<string, unknown>,
  ): BusState {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    const now = new Date().toISOString();
    const state: BusState = {
      id: `bus-${sessionId}-${Date.now().toString(36)}`,
      sessionId,
      goal,
      activeRole: null,
      stepCount: 0,
      edges: [],
      values: initialValues ?? {},
      createdAt: now,
      updatedAt: now,
      version: 0,
    };

    this.sessions.set(sessionId, state);
    this.transitions.set(sessionId, []);

    // Persist if configured
    if (this.config.persistSessions && this.store) {
      try {
        this.store.kvSet(`bus:${sessionId}`, JSON.parse(JSON.stringify(state)));
      } catch {
        // Best effort
      }
    }

    this.logger.debug("SharedStateBus", `Created session: ${sessionId}`, {
      goal,
    });

    return { ...state };
  }

  /** Get current state for a session (returns a copy) */
  getState(sessionId: string): BusState | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return { ...state, values: { ...state.values }, edges: [...state.edges] };
  }

  /** Get a specific value from a session */
  getValue<T = unknown>(sessionId: string, key: string): T | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    return state.values[key] as T | undefined;
  }

  /** Check if a session exists */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Get all active session IDs */
  getSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Close and remove a session */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.transitions.delete(sessionId);

    // Remove from KV
    if (this.store) {
      try {
        this.store.kvDelete(`bus:${sessionId}`);
      } catch {
        // Best effort
      }
    }

    this.logger.debug("SharedStateBus", `Closed session: ${sessionId}`);
  }

  // ── Core Update Pattern ─────────────────────────────────────

  /**
   * Apply an atomic immutable state transition.
   * Returns the new state; the old reference is unchanged.
   */
  update(sessionId: string, command: BusUpdate): BusState {
    const current = this.sessions.get(sessionId);
    if (!current) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = new Date().toISOString();
    const changedFields: string[] = [];

    // Build new values
    const newValues = { ...current.values };
    for (const [key, value] of Object.entries(command.patches)) {
      if (newValues[key] !== value) {
        changedFields.push(`values.${key}`);
      }
      newValues[key] = value;
    }

    // Build new edges
    let newEdges = [...current.edges];
    if (command.addEdge) {
      const { from, to, msgType } = command.addEdge;
      const existing = newEdges.find(
        (e) => e.from === from && e.to === to && e.msgType === msgType,
      );
      if (existing) {
        existing.count++;
        existing.lastAt = now;
      } else {
        newEdges.push({ from, to, msgType, count: 1, lastAt: now });
      }
      changedFields.push("edges");
    }

    // Build new active role
    let newActiveRole = current.activeRole;
    if (command.setActiveRole !== undefined) {
      newActiveRole = command.setActiveRole;
      changedFields.push("activeRole");
    }

    // Build new step count
    let newStepCount = current.stepCount;
    if (command.incrementStep) {
      newStepCount++;
      changedFields.push("stepCount");
    }

    // Build new goal
    let newGoal = current.goal;
    if (command.setGoal !== undefined) {
      newGoal = command.setGoal;
      changedFields.push("goal");
    }

    // Create new state (immutable transition)
    const newState: BusState = {
      id: current.id,
      sessionId: current.sessionId,
      goal: newGoal,
      activeRole: newActiveRole,
      stepCount: newStepCount,
      edges: newEdges,
      values: newValues,
      createdAt: current.createdAt,
      updatedAt: now,
      version: current.version + 1,
    };

    // Record transition
    const transition: StateTransition = {
      changedFields,
      agent: command.agent,
      reason: command.reason,
      fromVersion: current.version,
      toVersion: newState.version,
      timestamp: now,
    };

    // Store new state
    this.sessions.set(sessionId, newState);

    // Append transition
    const history = this.transitions.get(sessionId) ?? [];
    history.push(transition);
    if (history.length > this.config.maxTransitionsPerSession) {
      history.splice(0, history.length - this.config.maxTransitionsPerSession);
    }
    this.transitions.set(sessionId, history);

    // Persist
    if (this.config.persistSessions && this.store) {
      try {
        this.store.kvSet(
          `bus:${sessionId}`,
          JSON.parse(JSON.stringify(newState)),
        );
      } catch {
        // Best effort
      }
    }

    // Publish notification
    if (this.config.publishChanges) {
      this.highway
        .publish("state", "event", {
          type: "state-changed",
          sessionId,
          transition,
        })
        .catch(() => {});
    }

    return {
      ...newState,
      values: { ...newState.values },
      edges: [...newState.edges],
    };
  }

  // ── Communication Graph ─────────────────────────────────────

  /** Get all edges for a session */
  getEdges(sessionId: string): CommEdge[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    return [...state.edges];
  }

  /** Record a communication edge */
  recordEdge(
    sessionId: string,
    from: string,
    to: string,
    msgType: ACPMessageType,
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const now = new Date().toISOString();
    const existing = state.edges.find(
      (e) => e.from === from && e.to === to && e.msgType === msgType,
    );
    if (existing) {
      existing.count++;
      existing.lastAt = now;
    } else {
      state.edges.push({ from, to, msgType, count: 1, lastAt: now });
    }
    state.updatedAt = now;
  }

  /** Get adjacency list for a session's communication graph */
  getAdjacencyList(sessionId: string): Record<string, string[]> {
    const state = this.sessions.get(sessionId);
    if (!state) return {};

    const adj: Record<string, string[]> = {};
    for (const edge of state.edges) {
      if (!adj[edge.from]) adj[edge.from] = [];
      if (!adj[edge.from].includes(edge.to)) {
        adj[edge.from].push(edge.to);
      }
    }
    return adj;
  }

  // ── Transition History ──────────────────────────────────────

  /** Get full transition history for a session */
  getTransitions(sessionId: string): StateTransition[] {
    return [...(this.transitions.get(sessionId) ?? [])];
  }

  /** Get transitions made by a specific agent */
  getTransitionsByAgent(sessionId: string, agentId: string): StateTransition[] {
    const all = this.transitions.get(sessionId) ?? [];
    return all.filter((t) => t.agent === agentId);
  }

  // ── Persistence ─────────────────────────────────────────────

  /** Persist a session to the KV store */
  persistSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || !this.store) return;

    try {
      this.store.kvSet(`bus:${sessionId}`, JSON.parse(JSON.stringify(state)));
    } catch {
      // Best effort
    }
  }

  /** Load a session from the KV store */
  loadSession(sessionId: string): BusState | null {
    if (!this.store) return null;

    try {
      const raw = this.store.kvGet(`bus:${sessionId}`);
      if (!raw || typeof raw !== "object") return null;

      const state = raw as BusState;
      this.sessions.set(sessionId, state);
      if (!this.transitions.has(sessionId)) {
        this.transitions.set(sessionId, []);
      }
      return { ...state };
    } catch {
      return null;
    }
  }

  // ── Background Maintenance ──────────────────────────────────

  /** Clean expired KV entries from the store */
  cleanExpiredKV(): number {
    if (!this.store) return 0;
    try {
      return this.store.cleanExpiredKV();
    } catch {
      return 0;
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /** Start background cleanup timer */
  start(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanExpiredKV();
      } catch {
        // Best effort
      }
    }, this.config.cleanupIntervalMs);

    // Unref so it doesn't prevent process exit
    if (
      this.cleanupTimer &&
      typeof this.cleanupTimer === "object" &&
      "unref" in this.cleanupTimer
    ) {
      (this.cleanupTimer as { unref: () => void }).unref();
    }

    this.logger.debug("SharedStateBus", "Started background cleanup");
  }

  /** Stop background cleanup timer */
  stop(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.logger.debug("SharedStateBus", "Stopped background cleanup");
  }
}
