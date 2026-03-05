// ─────────────────────────────────────────────────────────────
// AETHER Net Scheduler — Interaction Combinator Reducer
//
// Finds active pairs in the interaction net and reduces them
// in parallel across worker threads. Reduction rules model
// the 6 fundamental IC interactions + task-specific rules.
//
// Guarantees:
//   - Deadlock-free (strong confluence of ICs)
//   - Order-independent (any reduction order → same result)
//   - Automatic parallelism (independent pairs reduce in parallel)
// ─────────────────────────────────────────────────────────────

import {
  InteractionNet,
  type ActivePair,
  type INetNode,
  type ReductionResult,
  type ReductionEffect,
  type ReductionPriority,
  type CombinatorKind,
  type Wire,
  type TaskPayload,
  type ConstructorPayload,
  type DuplicatorPayload,
  type EraserPayload,
} from "./interaction-net.ts";
import type { SynapseLogger } from "./logger.ts";

// ─────────────────────────────────────────────────────────────
// Scheduler Configuration
// ─────────────────────────────────────────────────────────────

export interface SchedulerConfig {
  /** Max concurrent reductions (default: navigator.hardwareConcurrency or 4) */
  maxConcurrency: number;
  /** Interval between active pair scans in ms (default: 50) */
  scanIntervalMs: number;
  /** Max reductions before forcing a GC sweep (default: 1000) */
  gcThreshold: number;
  /** Timeout for a single reduction in ms (default: 120_000) */
  reductionTimeout: number;
  /** Whether to enable reduction metrics (default: true) */
  enableMetrics: boolean;
  /** Task executor function — supplied by the runtime */
  taskExecutor?: TaskExecutorFn;
}

/** Callback that actually executes a task (pluggable — the runtime provides this) */
export type TaskExecutorFn = (
  task: TaskPayload,
  context: Record<string, unknown>,
) => Promise<unknown>;

const DEFAULT_CONFIG: SchedulerConfig = {
  maxConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4,
  scanIntervalMs: 50,
  gcThreshold: 1000,
  reductionTimeout: 120_000,
  enableMetrics: true,
};

// ─────────────────────────────────────────────────────────────
// Scheduler Metrics
// ─────────────────────────────────────────────────────────────

export interface SchedulerMetrics {
  totalReductions: number;
  successfulReductions: number;
  failedReductions: number;
  totalActivePairsDetected: number;
  peakConcurrency: number;
  currentConcurrency: number;
  averageReductionMs: number;
  nodesCreated: number;
  nodesDestroyed: number;
  /** Reductions per second (rolling window) */
  throughput: number;
}

// ─────────────────────────────────────────────────────────────
// Net Scheduler
// ─────────────────────────────────────────────────────────────

export class NetScheduler {
  private net: InteractionNet;
  private config: SchedulerConfig;
  private logger: SynapseLogger;
  private running = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private activeConcurrency = 0;
  private reductionsSinceGC = 0;
  private effects: ReductionEffect[] = [];

  private metrics: SchedulerMetrics = {
    totalReductions: 0,
    successfulReductions: 0,
    failedReductions: 0,
    totalActivePairsDetected: 0,
    peakConcurrency: 0,
    currentConcurrency: 0,
    averageReductionMs: 0,
    nodesCreated: 0,
    nodesDestroyed: 0,
    throughput: 0,
  };

  /** Rolling window for throughput calculation */
  private reductionTimestamps: number[] = [];

  constructor(
    net: InteractionNet,
    logger: SynapseLogger,
    config?: Partial<SchedulerConfig>,
  ) {
    this.net = net;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Start the reduction loop */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info("NetScheduler", `Started (concurrency: ${this.config.maxConcurrency})`);

    this.scanTimer = setInterval(() => {
      this.scan().catch((err) => {
        this.logger.error("NetScheduler", `Scan error: ${err}`);
      });
    }, this.config.scanIntervalMs);
  }

  /** Stop the reduction loop (in-flight reductions will complete) */
  stop(): void {
    this.running = false;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.logger.info("NetScheduler", "Stopped");
  }

  /** Run until the net reaches normal form (no more active pairs) */
  async runToCompletion(maxIterations: number = 10_000): Promise<void> {
    let iterations = 0;

    while (iterations < maxIterations) {
      const pairs = this.net.getReadyPairs();
      if (pairs.length === 0) {
        // Check if any nodes are still reducing
        const stats = this.net.getStats();
        if (stats.byStatus.reducing === 0) break;
        // Wait for in-flight reductions
        await new Promise((r) => setTimeout(r, this.config.scanIntervalMs));
        iterations++;
        continue;
      }

      // Reduce up to maxConcurrency pairs in parallel
      const batch = pairs.slice(0, this.config.maxConcurrency);
      await this.reduceBatch(batch);
      iterations++;
    }

    if (iterations >= maxIterations) {
      this.logger.warn("NetScheduler", `Hit max iterations (${maxIterations})`);
    }
  }

  // ── Core Scan + Reduce ─────────────────────────────────────

  /** Single scan: find active pairs and schedule reductions */
  private async scan(): Promise<void> {
    if (!this.running) return;

    // Find ready pairs
    const pairs = this.net.getReadyPairs();
    if (pairs.length === 0) return;

    this.metrics.totalActivePairsDetected += pairs.length;

    // How many slots are available?
    const available = this.config.maxConcurrency - this.activeConcurrency;
    if (available <= 0) return;

    // Take the highest-priority pairs up to available slots
    const batch = pairs.slice(0, available);
    await this.reduceBatch(batch);
  }

  /** Reduce a batch of active pairs in parallel */
  private async reduceBatch(pairs: ActivePair[]): Promise<void> {
    const promises = pairs.map((pair) => this.reducePair(pair));
    await Promise.allSettled(promises);

    // GC check
    this.reductionsSinceGC += pairs.length;
    if (this.reductionsSinceGC >= this.config.gcThreshold) {
      this.gc();
      this.reductionsSinceGC = 0;
    }
  }

  /** Reduce a single active pair */
  private async reducePair(pair: ActivePair): Promise<void> {
    const workerId = `w-${Date.now().toString(36)}`;
    const start = performance.now();

    // Claim the pair (atomic status transition)
    const claimed = this.net.claimPair(pair.id, workerId);
    if (!claimed) return; // Another scan already claimed it

    this.activeConcurrency++;
    this.metrics.currentConcurrency = this.activeConcurrency;
    if (this.activeConcurrency > this.metrics.peakConcurrency) {
      this.metrics.peakConcurrency = this.activeConcurrency;
    }

    try {
      // Determine reduction rule based on node kinds
      const result = await this.applyReductionRule(claimed);

      // Apply the result to the net
      this.net.applyReduction(result);

      // Collect effects
      this.effects.push(...result.effects);

      // Update metrics
      this.metrics.totalReductions++;
      this.metrics.successfulReductions++;
      this.metrics.nodesCreated += result.add.length;
      this.metrics.nodesDestroyed += result.remove.length;

      const elapsed = performance.now() - start;
      this.updateThroughput(elapsed);

      this.logger.debug(
        "NetScheduler",
        `Reduced ${pair.left.kind}-${pair.right.kind} in ${elapsed.toFixed(1)}ms ` +
        `(removed ${result.remove.length}, added ${result.add.length})`,
      );
    } catch (err) {
      this.metrics.totalReductions++;
      this.metrics.failedReductions++;

      // Mark nodes as errored
      pair.left.status = "completed";
      pair.left.error = err instanceof Error ? err.message : String(err);
      pair.right.status = "completed";
      pair.right.error = err instanceof Error ? err.message : String(err);

      this.logger.error(
        "NetScheduler",
        `Reduction failed for ${pair.id}: ${err}`,
      );
    } finally {
      this.activeConcurrency--;
      this.metrics.currentConcurrency = this.activeConcurrency;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Reduction Rules — The heart of the combinator engine
  //
  // Each rule takes an active pair and returns a ReductionResult
  // describing what nodes/wires to add/remove.
  // ─────────────────────────────────────────────────────────────

  private async applyReductionRule(pair: ActivePair): Promise<ReductionResult> {
    const leftKind = pair.left.payload.kind;
    const rightKind = pair.right.payload.kind;

    // Determine rule key
    const ruleKey = this.getRuleKey(leftKind, rightKind);

    switch (ruleKey) {
      case "task-task":
        return this.reduceTaskTask(pair);
      case "task-constructor":
        return this.reduceTaskConstructor(pair);
      case "task-duplicator":
        return await this.reduceTaskDuplicator(pair);
      case "task-eraser":
        return this.reduceTaskEraser(pair);
      case "constructor-constructor":
        return this.reduceConstructorConstructor(pair);
      case "constructor-duplicator":
        return this.reduceConstructorDuplicator(pair);
      case "constructor-eraser":
        return this.reduceConstructorEraser(pair);
      case "duplicator-duplicator":
        return this.reduceDuplicatorDuplicator(pair);
      case "duplicator-eraser":
        return this.reduceDuplicatorEraser(pair);
      case "eraser-eraser":
        return this.reduceEraserEraser(pair);
      default:
        // Execute the task if one side is a task
        if (leftKind === "task") {
          return await this.executeTask(pair.left, pair);
        }
        if (rightKind === "task") {
          return await this.executeTask(pair.right, pair);
        }
        throw new Error(`Unknown reduction rule: ${leftKind}-${rightKind}`);
    }
  }

  private getRuleKey(left: string, right: string): string {
    // Normalize order for symmetric rules
    const kinds = [left, right].sort();
    return `${kinds[0]}-${kinds[1]}`;
  }

  // ── Rule: task-task (parallel execution) ───────────────────
  /** Two tasks connected: execute both in parallel */
  private async reduceTaskTask(pair: ActivePair): Promise<ReductionResult> {
    const [resultA, resultB] = await Promise.all([
      this.executeTask(pair.left, pair),
      this.executeTask(pair.right, pair),
    ]);

    return {
      remove: [...resultA.remove, ...resultB.remove],
      add: [...resultA.add, ...resultB.add],
      addWires: [...resultA.addWires, ...resultB.addWires],
      removeWires: [pair.wire.id, ...resultA.removeWires, ...resultB.removeWires],
      effects: [...resultA.effects, ...resultB.effects],
    };
  }

  // ── Rule: task → constructor (feed result into join) ───────
  /** Task result feeds into a constructor's inputs */
  private reduceTaskConstructor(pair: ActivePair): ReductionResult {
    const [taskNode, joinNode] = pair.left.payload.kind === "task"
      ? [pair.left, pair.right]
      : [pair.right, pair.left];

    const joinPayload = joinNode.payload as ConstructorPayload;

    // Add task result to join's inputs
    joinPayload.inputs.push(taskNode.result);

    // If all inputs received, mark join as complete
    if (joinPayload.inputs.length >= joinPayload.arity) {
      let merged: unknown;
      switch (joinPayload.mergeStrategy) {
        case "concat":
          merged = joinPayload.inputs;
          break;
        case "first":
          merged = joinPayload.inputs[0];
          break;
        case "custom":
          if (joinPayload.mergeFn) {
            const fn = new Function("inputs", joinPayload.mergeFn);
            merged = fn(joinPayload.inputs);
          } else {
            merged = joinPayload.inputs;
          }
          break;
      }

      joinNode.status = "completed";
      joinNode.result = merged;

      return {
        remove: [taskNode.id],
        add: [],
        addWires: [],
        removeWires: [pair.wire.id],
        effects: [{
          type: "emit",
          data: { event: "join:complete", nodeId: joinNode.id, result: merged },
        }],
      };
    }

    // Not complete yet — just remove the task node
    return {
      remove: [taskNode.id],
      add: [],
      addWires: [],
      removeWires: [pair.wire.id],
      effects: [],
    };
  }

  // ── Rule: task → duplicator (fan out the task) ─────────────
  /** Duplicator creates copies of the task for each target */
  private async reduceTaskDuplicator(pair: ActivePair): Promise<ReductionResult> {
    const [taskNode, dupNode] = pair.left.payload.kind === "task"
      ? [pair.left, pair.right]
      : [pair.right, pair.left];

    const dupPayload = dupNode.payload as DuplicatorPayload;
    const newNodes: INetNode[] = [];
    const newWires: Wire[] = [];

    // Create a task copy for each target
    for (const target of dupPayload.targets) {
      const copyId = this.net.nextId("task");
      const taskPayload = taskNode.payload as TaskPayload;

      const copy: INetNode = {
        id: copyId,
        kind: "constructor",
        status: "idle",
        priority: taskPayload.priority,
        principal: { nodeId: copyId, index: 0 },
        aux: [
          { nodeId: copyId, index: 1 },
          { nodeId: copyId, index: 2 },
        ],
        payload: {
          kind: "task",
          description: taskPayload.description,
          agentId: target,
          context: { ...taskPayload.context },
          priority: taskPayload.priority,
          timeout: taskPayload.timeout,
        },
        createdAt: Date.now(),
        claimedBy: null,
      };
      newNodes.push(copy);
    }

    // If fan-out mode is "all", create a join to collect results
    if (dupPayload.fanoutMode === "all" || dupPayload.fanoutMode === "quorum") {
      const joinId = this.net.nextId("join");
      const join: INetNode = {
        id: joinId,
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: joinId, index: 0 },
        aux: [
          { nodeId: joinId, index: 1 },
          { nodeId: joinId, index: 2 },
        ],
        payload: {
          kind: "constructor",
          mergeStrategy: "concat",
          arity: dupPayload.fanoutMode === "quorum"
            ? (dupPayload.quorumSize ?? Math.ceil(dupPayload.targets.length / 2))
            : dupPayload.targets.length,
          inputs: [],
        },
        createdAt: Date.now(),
        claimedBy: null,
      };
      newNodes.push(join);

      // Wire each task copy's principal → join's principal
      for (const copy of newNodes) {
        if (copy.id === joinId) continue;
        newWires.push({
          id: this.net.nextId("w"),
          from: copy.principal,
          to: join.principal,
        });
      }
    }

    return {
      remove: [taskNode.id, dupNode.id],
      add: newNodes,
      addWires: newWires,
      removeWires: [pair.wire.id],
      effects: [{
        type: "log",
        data: `Fan-out: ${dupPayload.targets.length} copies created`,
      }],
    };
  }

  // ── Rule: task → eraser (cancel the task) ──────────────────
  private reduceTaskEraser(pair: ActivePair): ReductionResult {
    const [taskNode, eraserNode] = pair.left.payload.kind === "task"
      ? [pair.left, pair.right]
      : [pair.right, pair.left];

    const eraserPayload = eraserNode.payload as EraserPayload;

    taskNode.status = "cancelled";
    taskNode.error = `Cancelled: ${eraserPayload.reason}`;

    return {
      remove: [taskNode.id, eraserNode.id],
      add: [],
      addWires: [],
      removeWires: [pair.wire.id],
      effects: [{
        type: "log",
        data: `Task ${taskNode.id} cancelled: ${eraserPayload.reason}`,
      }],
    };
  }

  // ── Rule: γ-γ (constructor-constructor annihilation) ───────
  /** Two constructors annihilate — wire their aux ports directly */
  private reduceConstructorConstructor(pair: ActivePair): ReductionResult {
    const newWires: Wire[] = [
      // Cross-connect aux ports: left.aux1 ↔ right.aux1, left.aux2 ↔ right.aux2
      {
        id: this.net.nextId("w"),
        from: pair.left.aux[0],
        to: pair.right.aux[0],
      },
      {
        id: this.net.nextId("w"),
        from: pair.left.aux[1],
        to: pair.right.aux[1],
      },
    ];

    return {
      remove: [pair.left.id, pair.right.id],
      add: [],
      addWires: newWires,
      removeWires: [pair.wire.id],
      effects: [],
    };
  }

  // ── Rule: γ-δ (constructor-duplicator commutation) ─────────
  /** Constructor and duplicator commute — creates 2 new of each */
  private reduceConstructorDuplicator(pair: ActivePair): ReductionResult {
    const [con, dup] = pair.left.kind === "constructor"
      ? [pair.left, pair.right]
      : [pair.right, pair.left];

    // Create 2 new constructors (one per dup branch)
    const newCon1 = this.makeNode("constructor", con.payload, con.priority);
    const newCon2 = this.makeNode("constructor", con.payload, con.priority);

    // Create 2 new duplicators (one per con aux port)
    const newDup1 = this.makeNode("duplicator", dup.payload, dup.priority);
    const newDup2 = this.makeNode("duplicator", dup.payload, dup.priority);

    // Cross-wire:
    //   newCon1.aux1 ↔ newDup1.principal
    //   newCon1.aux2 ↔ newDup2.principal
    //   newCon2.aux1 ↔ newDup1.aux1
    //   newCon2.aux2 ↔ newDup2.aux1
    const newWires: Wire[] = [
      { id: this.net.nextId("w"), from: newCon1.aux[0], to: newDup1.principal },
      { id: this.net.nextId("w"), from: newCon1.aux[1], to: newDup2.principal },
      { id: this.net.nextId("w"), from: newCon2.aux[0], to: newDup1.aux[0] },
      { id: this.net.nextId("w"), from: newCon2.aux[1], to: newDup2.aux[0] },
    ];

    return {
      remove: [con.id, dup.id],
      add: [newCon1, newCon2, newDup1, newDup2],
      addWires: newWires,
      removeWires: [pair.wire.id],
      effects: [],
    };
  }

  // ── Rule: γ-ε (constructor-eraser) ─────────────────────────
  /** Eraser annihilates constructor; propagates to aux ports */
  private reduceConstructorEraser(pair: ActivePair): ReductionResult {
    const [con, era] = pair.left.kind === "constructor"
      ? [pair.left, pair.right]
      : [pair.right, pair.left];

    const eraPayload = era.payload as EraserPayload;
    const add: INetNode[] = [];
    const addWires: Wire[] = [];

    if (eraPayload.propagate) {
      // Create erasers for each aux port's connection
      for (const auxPort of con.aux) {
        const connected = this.net.getConnectedNode(auxPort.nodeId, auxPort.index);
        if (connected && connected.status === "idle") {
          const newEraser = this.makeNode("eraser", {
            kind: "eraser",
            reason: `Propagated from ${era.id}`,
            propagate: true,
          }, 5 as ReductionPriority);
          add.push(newEraser);
          addWires.push({
            id: this.net.nextId("w"),
            from: newEraser.principal,
            to: connected.principal,
          });
        }
      }
    }

    return {
      remove: [con.id, era.id],
      add,
      addWires,
      removeWires: [pair.wire.id],
      effects: [{
        type: "log",
        data: `Erased constructor ${con.id}: ${eraPayload.reason}`,
      }],
    };
  }

  // ── Rule: δ-δ (duplicator commutation) ─────────────────────
  /** Two duplicators commute — swap connections */
  private reduceDuplicatorDuplicator(pair: ActivePair): ReductionResult {
    // In standard ICs, δ-δ creates 4 new nodes with cross-wiring
    // For our agent system, we simplify: just cross-connect aux ports
    return {
      remove: [pair.left.id, pair.right.id],
      add: [],
      addWires: [
        { id: this.net.nextId("w"), from: pair.left.aux[0], to: pair.right.aux[0] },
        { id: this.net.nextId("w"), from: pair.left.aux[1], to: pair.right.aux[1] },
      ],
      removeWires: [pair.wire.id],
      effects: [],
    };
  }

  // ── Rule: δ-ε (duplicator-eraser) ──────────────────────────
  /** Eraser annihilates duplicator; propagates to aux ports */
  private reduceDuplicatorEraser(pair: ActivePair): ReductionResult {
    return this.reduceConstructorEraser(pair); // Same behavior
  }

  // ── Rule: ε-ε (eraser annihilation) ────────────────────────
  /** Two erasers annihilate — both disappear */
  private reduceEraserEraser(pair: ActivePair): ReductionResult {
    return {
      remove: [pair.left.id, pair.right.id],
      add: [],
      addWires: [],
      removeWires: [pair.wire.id],
      effects: [],
    };
  }

  // ── Task Execution ─────────────────────────────────────────

  /** Execute a task node via the pluggable task executor */
  private async executeTask(
    taskNode: INetNode,
    pair: ActivePair,
  ): Promise<ReductionResult> {
    if (!this.config.taskExecutor) {
      throw new Error("No task executor configured");
    }

    const payload = taskNode.payload as TaskPayload;

    try {
      // Execute with timeout
      const result = await Promise.race([
        this.config.taskExecutor(payload, payload.context),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Task timeout (${payload.timeout}ms)`)),
            payload.timeout,
          ),
        ),
      ]);

      taskNode.status = "completed";
      taskNode.result = result;

      return {
        remove: [],
        add: [],
        addWires: [],
        removeWires: [],
        effects: [{
          type: "emit",
          data: { event: "task:completed", nodeId: taskNode.id, result },
        }],
      };
    } catch (err) {
      taskNode.status = "completed";
      taskNode.error = err instanceof Error ? err.message : String(err);

      return {
        remove: [],
        add: [],
        addWires: [],
        removeWires: [],
        effects: [{
          type: "emit",
          data: { event: "task:failed", nodeId: taskNode.id, error: taskNode.error },
        }],
      };
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  /** Create a new INetNode with auto-generated ID and ports */
  private makeNode(
    kind: CombinatorKind,
    payload: INetNode["payload"],
    priority: ReductionPriority,
  ): INetNode {
    const id = this.net.nextId(kind[0]); // c, d, or e prefix
    return {
      id,
      kind,
      status: "idle",
      priority,
      principal: { nodeId: id, index: 0 },
      aux: [
        { nodeId: id, index: 1 },
        { nodeId: id, index: 2 },
      ],
      payload,
      createdAt: Date.now(),
      claimedBy: null,
    };
  }

  /** Update throughput calculation */
  private updateThroughput(durationMs: number): void {
    const now = Date.now();
    this.reductionTimestamps.push(now);

    // Keep only last 10 seconds
    const cutoff = now - 10_000;
    this.reductionTimestamps = this.reductionTimestamps.filter((t) => t > cutoff);

    this.metrics.throughput = this.reductionTimestamps.length / 10;
    this.metrics.averageReductionMs =
      (this.metrics.averageReductionMs * (this.metrics.totalReductions - 1) + durationMs) /
      this.metrics.totalReductions;
  }

  /** Garbage collect completed/cancelled nodes */
  private gc(): void {
    const allNodes = this.net.getAllNodes();
    let removed = 0;

    for (const node of allNodes) {
      if (node.status === "completed" || node.status === "cancelled") {
        // Only remove if no other idle node references this one
        const wires = [0, 1, 2].flatMap((i) =>
          this.net.getWiresForPort(node.id, i)
        );

        const hasIdleDeps = wires.some((w) => {
          const otherId = w.from.nodeId === node.id ? w.to.nodeId : w.from.nodeId;
          const other = this.net.getNode(otherId);
          return other && (other.status === "idle" || other.status === "active");
        });

        if (!hasIdleDeps) {
          this.net.removeNode(node.id);
          removed++;
        }
      }
    }

    if (removed > 0) {
      this.logger.debug("NetScheduler", `GC: removed ${removed} dead nodes`);
    }
  }

  // ── Public API ─────────────────────────────────────────────

  /** Get the underlying interaction net */
  getNet(): InteractionNet {
    return this.net;
  }

  /** Get scheduler metrics */
  getMetrics(): SchedulerMetrics {
    return { ...this.metrics };
  }

  /** Drain pending effects and return them */
  drainEffects(): ReductionEffect[] {
    const drained = this.effects;
    this.effects = [];
    return drained;
  }

  /** Check if the scheduler is running */
  isRunning(): boolean {
    return this.running;
  }
}
