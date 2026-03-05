// ─────────────────────────────────────────────────────────────
// AETHER Interaction Net — HVM2-Inspired Parallel Computation
//
// Based on Yves Lafont's Interaction Combinators (1997):
//   3 agent types → can model ANY computation
//   Strong Confluence → no race conditions by construction
//   Locality → only connected pairs interact
//
// Agent mapping:
//   Constructor (γ) → Join / merge results
//   Duplicator   (δ) → Fan-out / broadcast tasks
//   Eraser       (ε) → Cleanup / cancel dead branches
//
// This module defines the data structures and graph operations.
// The scheduler (net-scheduler.ts) handles execution.
// ─────────────────────────────────────────────────────────────

/** The 3 fundamental combinator types from Interaction Combinators */
export type CombinatorKind = "constructor" | "duplicator" | "eraser";

/** Node status in the interaction net */
export type NodeStatus =
  | "idle" // Not part of any active pair
  | "active" // Part of an active pair, ready to reduce
  | "reducing" // Currently being reduced (claimed by a worker)
  | "completed" // Reduction finished, result available
  | "cancelled"; // Erased / cancelled

/** Priority levels for reduction ordering */
export type ReductionPriority = 0 | 1 | 2 | 3 | 4 | 5;

// ─────────────────────────────────────────────────────────────
// Port — Connection point on a node (like agent ports in HVM2)
// ─────────────────────────────────────────────────────────────

export interface Port {
  /** Owning node ID */
  nodeId: string;
  /** Port index: 0 = principal, 1 = aux1, 2 = aux2 */
  index: 0 | 1 | 2;
}

/** A wire connects two ports */
export interface Wire {
  /** Unique wire identifier */
  id: string;
  /** Source port */
  from: Port;
  /** Target port */
  to: Port;
}

// ─────────────────────────────────────────────────────────────
// Node — An agent in the interaction net
// ─────────────────────────────────────────────────────────────

export interface INetNode {
  /** Unique node identifier */
  id: string;
  /** Combinator kind determines reduction rules */
  kind: CombinatorKind;
  /** Runtime status */
  status: NodeStatus;
  /** Reduction priority (higher = reduce first) */
  priority: ReductionPriority;
  /** Principal port — always port 0 */
  principal: Port;
  /** Auxiliary ports — port 1 and port 2 */
  aux: [Port, Port];
  /** The actual task/data payload */
  payload: NodePayload;
  /** Timestamp of creation */
  createdAt: number;
  /** Worker ID that claimed this node for reduction */
  claimedBy: string | null;
  /** Result after reduction completes */
  result?: unknown;
  /** Error if reduction failed */
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Payload — What each node actually carries
// ─────────────────────────────────────────────────────────────

/** Constructor (γ): Joins/merges results from child nodes */
export interface ConstructorPayload {
  kind: "constructor";
  /** How to merge child results */
  mergeStrategy: "concat" | "first" | "custom";
  /** Custom merge function (serialised) */
  mergeFn?: string;
  /** Expected number of inputs before reduction */
  arity: number;
  /** Accumulated inputs */
  inputs: unknown[];
}

/** Duplicator (δ): Fans out a task to multiple targets */
export interface DuplicatorPayload {
  kind: "duplicator";
  /** The task to broadcast */
  task: TaskPayload;
  /** Target agent IDs or capability queries */
  targets: string[];
  /** Whether all targets must complete (all) or just one (race) */
  fanoutMode: "all" | "race" | "quorum";
  /** For quorum mode: minimum successes needed */
  quorumSize?: number;
}

/** Eraser (ε): Cancels a branch of computation */
export interface EraserPayload {
  kind: "eraser";
  /** Reason for cancellation */
  reason: string;
  /** Whether to propagate cancellation to connected nodes */
  propagate: boolean;
}

/** A concrete task that an agent should execute */
export interface TaskPayload {
  kind: "task";
  /** Task description for the LLM */
  description: string;
  /** Target agent ID */
  agentId: string;
  /** Context data */
  context: Record<string, unknown>;
  /** Priority */
  priority: ReductionPriority;
  /** Timeout in ms */
  timeout: number;
}

export type NodePayload =
  | ConstructorPayload
  | DuplicatorPayload
  | EraserPayload
  | TaskPayload;

import type { AetherStore } from "./storage/store.ts";

// ─────────────────────────────────────────────────────────────
// Active Pair — Two nodes connected via principal ports
// This is the fundamental unit of computation in ICs.
// An active pair is "ready to reduce" — no dependencies.
// ─────────────────────────────────────────────────────────────

export interface ActivePair {
  /** Unique pair identifier */
  id: string;
  /** Left node in the pair */
  left: INetNode;
  /** Right node in the pair */
  right: INetNode;
  /** The wire connecting their principal ports */
  wire: Wire;
  /** Combined priority (max of both nodes) */
  priority: ReductionPriority;
  /** Timestamp when this pair was detected */
  detectedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Reduction Rule — What happens when an active pair reduces
// ─────────────────────────────────────────────────────────────

export type ReductionRuleKey =
  | "γ-γ" // Constructor-Constructor: annihilate → wire aux ports
  | "δ-δ" // Duplicator-Duplicator: commute → swap and duplicate
  | "γ-δ" // Constructor-Duplicator: commute → distribute
  | "γ-ε" // Constructor-Eraser: erase → propagate erasure
  | "δ-ε" // Duplicator-Eraser: erase → propagate erasure
  | "ε-ε" // Eraser-Eraser: annihilate → both disappear
  | "task-γ" // Task flows into constructor (join)
  | "task-δ" // Task encounters duplicator (fan-out)
  | "task-ε"; // Task meets eraser (cancel)

export interface ReductionResult {
  /** Nodes to remove from the net */
  remove: string[];
  /** New nodes to add to the net */
  add: INetNode[];
  /** New wires to add */
  addWires: Wire[];
  /** Wires to remove */
  removeWires: string[];
  /** Side effects (e.g., emit events, log) */
  effects: ReductionEffect[];
}

export interface ReductionEffect {
  type: "emit" | "log" | "escalate" | "store";
  data: unknown;
}

// ─────────────────────────────────────────────────────────────
// Interaction Net — The computation graph
// ─────────────────────────────────────────────────────────────

export class InteractionNet {
  /** All nodes in the net, indexed by ID */
  private nodes: Map<string, INetNode> = new Map();
  /** All wires in the net, indexed by ID */
  private wires: Map<string, Wire> = new Map();
  /** Cache of detected active pairs */
  private activePairCache: Map<string, ActivePair> = new Map();
  /** Monotonic counter for ID generation */
  private idCounter = 0;
  /** Persistent store for checkpoint/restore */
  private store: AetherStore | null = null;

  /** Attach a persistent store for checkpoint/restore */
  setStore(store: AetherStore): void {
    this.store = store;
  }

  // ── Node Operations ────────────────────────────────────────

  /** Generate a unique ID */
  nextId(prefix: string = "n"): string {
    return `${prefix}-${++this.idCounter}-${Date.now().toString(36)}`;
  }

  /** Add a node to the net */
  addNode(node: INetNode): void {
    this.nodes.set(node.id, node);
    this.invalidateCache();
  }

  /** Remove a node and all its connected wires */
  removeNode(id: string): INetNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;

    // Remove all wires connected to this node
    for (const [wireId, wire] of this.wires) {
      if (wire.from.nodeId === id || wire.to.nodeId === id) {
        this.wires.delete(wireId);
      }
    }

    this.nodes.delete(id);
    this.invalidateCache();
    return node;
  }

  /** Get a node by ID */
  getNode(id: string): INetNode | undefined {
    return this.nodes.get(id);
  }

  /** Get all nodes */
  getAllNodes(): INetNode[] {
    return Array.from(this.nodes.values());
  }

  /** Count of nodes */
  get nodeCount(): number {
    return this.nodes.size;
  }

  // ── Wire Operations ────────────────────────────────────────

  /** Connect two ports with a wire */
  connect(from: Port, to: Port): Wire {
    const wire: Wire = {
      id: this.nextId("w"),
      from,
      to,
    };
    this.wires.set(wire.id, wire);
    this.invalidateCache();
    return wire;
  }

  /** Remove a wire by ID */
  removeWire(id: string): boolean {
    const existed = this.wires.delete(id);
    if (existed) this.invalidateCache();
    return existed;
  }

  /** Find all wires connected to a port */
  getWiresForPort(nodeId: string, portIndex: number): Wire[] {
    const results: Wire[] = [];
    for (const wire of this.wires.values()) {
      if (
        (wire.from.nodeId === nodeId && wire.from.index === portIndex) ||
        (wire.to.nodeId === nodeId && wire.to.index === portIndex)
      ) {
        results.push(wire);
      }
    }
    return results;
  }

  /** Get the node connected to a given port via wire */
  getConnectedNode(nodeId: string, portIndex: number): INetNode | undefined {
    const wires = this.getWiresForPort(nodeId, portIndex);
    if (wires.length === 0) return undefined;

    const wire = wires[0];
    const targetId =
      wire.from.nodeId === nodeId ? wire.to.nodeId : wire.from.nodeId;
    return this.nodes.get(targetId);
  }

  // ── Active Pair Detection ──────────────────────────────────
  // An active pair = two nodes connected via PRINCIPAL ports.
  // This is O(|wires|) — we cache results and invalidate on changes.

  /** Find all active pairs in the net (cached) */
  findActivePairs(): ActivePair[] {
    if (this.activePairCache.size > 0) {
      return Array.from(this.activePairCache.values());
    }

    for (const wire of this.wires.values()) {
      // Active pair: both ends are principal ports (index 0)
      if (wire.from.index !== 0 || wire.to.index !== 0) continue;

      const left = this.nodes.get(wire.from.nodeId);
      const right = this.nodes.get(wire.to.nodeId);
      if (!left || !right) continue;

      // Both must be idle (not already being reduced)
      if (left.status !== "idle" || right.status !== "idle") continue;

      const pair: ActivePair = {
        id: `ap-${left.id}:${right.id}`,
        left,
        right,
        wire,
        priority: Math.max(left.priority, right.priority) as ReductionPriority,
        detectedAt: Date.now(),
      };

      this.activePairCache.set(pair.id, pair);
    }

    return Array.from(this.activePairCache.values());
  }

  /** Sort active pairs by priority (highest first) */
  getReadyPairs(): ActivePair[] {
    return this.findActivePairs().sort((a, b) => b.priority - a.priority);
  }

  /** Claim an active pair for reduction by a worker */
  claimPair(pairId: string, workerId: string): ActivePair | null {
    const pair = this.activePairCache.get(pairId);
    if (!pair) return null;

    // Double-check nodes are still idle (no TOCTOU race)
    if (pair.left.status !== "idle" || pair.right.status !== "idle") {
      this.activePairCache.delete(pairId);
      return null;
    }

    // Atomically claim both nodes
    pair.left.status = "reducing";
    pair.left.claimedBy = workerId;
    pair.right.status = "reducing";
    pair.right.claimedBy = workerId;

    this.activePairCache.delete(pairId);
    return pair;
  }

  // ── Reduction Application ──────────────────────────────────

  /** Apply a reduction result to the net */
  applyReduction(result: ReductionResult): void {
    // Remove old nodes
    for (const id of result.remove) {
      this.nodes.delete(id);
    }

    // Remove old wires
    for (const id of result.removeWires) {
      this.wires.delete(id);
    }

    // Add new nodes
    for (const node of result.add) {
      this.nodes.set(node.id, node);
    }

    // Add new wires
    for (const wire of result.addWires) {
      this.wires.set(wire.id, wire);
    }

    this.invalidateCache();
  }

  // ── Graph Helpers ──────────────────────────────────────────

  /** Check if the net has reached normal form (no active pairs) */
  isNormalForm(): boolean {
    return this.findActivePairs().length === 0;
  }

  /** Get net statistics */
  getStats(): NetStats {
    const nodes = Array.from(this.nodes.values());
    return {
      totalNodes: nodes.length,
      totalWires: this.wires.size,
      activePairs: this.findActivePairs().length,
      byKind: {
        constructor: nodes.filter((n) => n.kind === "constructor").length,
        duplicator: nodes.filter((n) => n.kind === "duplicator").length,
        eraser: nodes.filter((n) => n.kind === "eraser").length,
      },
      byStatus: {
        idle: nodes.filter((n) => n.status === "idle").length,
        active: nodes.filter((n) => n.status === "active").length,
        reducing: nodes.filter((n) => n.status === "reducing").length,
        completed: nodes.filter((n) => n.status === "completed").length,
        cancelled: nodes.filter((n) => n.status === "cancelled").length,
      },
    };
  }

  /** Invalidate the active pair cache */
  private invalidateCache(): void {
    this.activePairCache.clear();
  }

  // ── Checkpoint / Restore ────────────────────────────────────

  /** Save current graph state to persistent store */
  checkpoint(): void {
    if (!this.store) return;
    try {
      const nodes = Array.from(this.nodes.values());
      const wires = Array.from(this.wires.values());
      this.store.saveNetSnapshot(nodes, wires);
    } catch {
      // Checkpoint is best-effort
    }
  }

  /** Restore graph state from persistent store */
  restore(): boolean {
    if (!this.store) return false;
    try {
      const snapshot = this.store.loadNetSnapshot();
      if (!snapshot) return false;

      // Clear current state
      this.nodes.clear();
      this.wires.clear();
      this.activePairCache.clear();

      // Restore nodes
      for (const node of snapshot.nodes) {
        this.nodes.set(node.id, node);
        // Update idCounter to avoid collisions
        const numMatch = node.id.match(/-(\d+)-/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          if (num > this.idCounter) this.idCounter = num;
        }
      }

      // Restore wires
      for (const wire of snapshot.wires) {
        this.wires.set(wire.id, wire);
      }

      return true;
    } catch {
      return false;
    }
  }

  /** Clear the persisted snapshot */
  clearCheckpoint(): void {
    this.store?.clearNetSnapshot();
  }

  // ── Factory Methods ────────────────────────────────────────
  // Convenience methods to build common graph patterns

  /** Create a task node ready for execution */
  createTaskNode(
    description: string,
    agentId: string,
    context: Record<string, unknown> = {},
    priority: ReductionPriority = 3,
    timeout: number = 120_000,
  ): INetNode {
    const id = this.nextId("task");
    const node: INetNode = {
      id,
      kind: "constructor", // Tasks are constructors — they produce results
      status: "idle",
      priority,
      principal: { nodeId: id, index: 0 },
      aux: [
        { nodeId: id, index: 1 },
        { nodeId: id, index: 2 },
      ],
      payload: {
        kind: "task",
        description,
        agentId,
        context,
        priority,
        timeout,
      },
      createdAt: Date.now(),
      claimedBy: null,
    };
    this.addNode(node);
    return node;
  }

  /** Create a fan-out duplicator that broadcasts to multiple agents */
  createFanOut(
    task: TaskPayload,
    targets: string[],
    mode: "all" | "race" | "quorum" = "all",
    quorumSize?: number,
  ): INetNode {
    const id = this.nextId("dup");
    const node: INetNode = {
      id,
      kind: "duplicator",
      status: "idle",
      priority: task.priority,
      principal: { nodeId: id, index: 0 },
      aux: [
        { nodeId: id, index: 1 },
        { nodeId: id, index: 2 },
      ],
      payload: {
        kind: "duplicator",
        task,
        targets,
        fanoutMode: mode,
        quorumSize,
      },
      createdAt: Date.now(),
      claimedBy: null,
    };
    this.addNode(node);
    return node;
  }

  /** Create a join constructor that merges N results */
  createJoin(
    arity: number,
    mergeStrategy: "concat" | "first" | "custom" = "concat",
    mergeFn?: string,
  ): INetNode {
    const id = this.nextId("join");
    const node: INetNode = {
      id,
      kind: "constructor",
      status: "idle",
      priority: 3,
      principal: { nodeId: id, index: 0 },
      aux: [
        { nodeId: id, index: 1 },
        { nodeId: id, index: 2 },
      ],
      payload: {
        kind: "constructor",
        mergeStrategy,
        mergeFn,
        arity,
        inputs: [],
      },
      createdAt: Date.now(),
      claimedBy: null,
    };
    this.addNode(node);
    return node;
  }

  /** Create an eraser that cancels connected computation */
  createEraser(reason: string, propagate: boolean = true): INetNode {
    const id = this.nextId("era");
    const node: INetNode = {
      id,
      kind: "eraser",
      status: "idle",
      priority: 5, // Erasers are highest priority
      principal: { nodeId: id, index: 0 },
      aux: [
        { nodeId: id, index: 1 },
        { nodeId: id, index: 2 },
      ],
      payload: {
        kind: "eraser",
        reason,
        propagate,
      },
      createdAt: Date.now(),
      claimedBy: null,
    };
    this.addNode(node);
    return node;
  }

  /**
   * Build a parallel execution DAG:
   *   task₁ ─┐
   *   task₂ ─┤─ join ─→ result
   *   task₃ ─┘
   *
   * Creates N task nodes + 1 join node, wired together.
   */
  buildParallelDAG(
    tasks: Array<{
      description: string;
      agentId: string;
      context?: Record<string, unknown>;
      priority?: ReductionPriority;
    }>,
    mergeStrategy: "concat" | "first" | "custom" = "concat",
  ): { tasks: INetNode[]; join: INetNode } {
    const joinNode = this.createJoin(tasks.length, mergeStrategy);
    const taskNodes: INetNode[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const taskNode = this.createTaskNode(
        t.description,
        t.agentId,
        t.context ?? {},
        t.priority ?? 3,
      );
      taskNodes.push(taskNode);

      // Wire each task's principal port to join's principal port
      // This creates active pairs that the scheduler can detect
      this.connect(taskNode.principal, joinNode.principal);
    }

    return { tasks: taskNodes, join: joinNode };
  }

  /**
   * Build a sequential pipeline:
   *   task₁ → task₂ → task₃ → result
   *
   * Each task's output feeds into the next task's context.
   */
  buildPipeline(
    tasks: Array<{
      description: string;
      agentId: string;
      context?: Record<string, unknown>;
    }>,
  ): INetNode[] {
    const nodes: INetNode[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const node = this.createTaskNode(
        t.description,
        t.agentId,
        { ...t.context, pipelineStep: i + 1, pipelineTotal: tasks.length },
        3,
      );
      nodes.push(node);

      // Wire sequential dependencies: aux[1] of prev → principal of next
      if (i > 0) {
        this.connect(nodes[i - 1].aux[1], node.principal);
      }
    }

    return nodes;
  }
}

// ─────────────────────────────────────────────────────────────
// Stats type
// ─────────────────────────────────────────────────────────────

export interface NetStats {
  totalNodes: number;
  totalWires: number;
  activePairs: number;
  byKind: Record<CombinatorKind, number>;
  byStatus: Record<NodeStatus, number>;
}
