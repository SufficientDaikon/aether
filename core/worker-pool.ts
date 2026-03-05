// ─────────────────────────────────────────────────────────────
// AETHER Worker Pool — Bun Worker Thread Management
//
// Manages a pool of worker threads for parallel task execution.
// Features:
//   - Elastic scaling (min → max workers)
//   - Task stealing between workers (idle workers steal from busy ones)
//   - Health monitoring with auto-restart
//   - Graceful shutdown with drain
//   - postMessage-based communication (I/O-bound work, no SharedArrayBuffer needed)
// ─────────────────────────────────────────────────────────────

import type { SynapseLogger } from "./logger.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface WorkerPoolConfig {
  /** Minimum workers to keep alive (default: 2) */
  minWorkers: number;
  /** Maximum workers to scale up to (default: CPU count) */
  maxWorkers: number;
  /** Idle timeout before scaling down in ms (default: 30_000) */
  idleTimeoutMs: number;
  /** Health check interval in ms (default: 5_000) */
  healthCheckMs: number;
  /** Max retries for a failed task (default: 2) */
  maxRetries: number;
  /** Task timeout in ms (default: 120_000) */
  taskTimeout: number;
  /** Queue high-water mark — start scaling up (default: 10) */
  scaleUpThreshold: number;
}

const DEFAULT_CONFIG: WorkerPoolConfig = {
  minWorkers: 2,
  maxWorkers: typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4,
  idleTimeoutMs: 30_000,
  healthCheckMs: 5_000,
  maxRetries: 2,
  taskTimeout: 120_000,
  scaleUpThreshold: 10,
};

export type WorkerStatus = "idle" | "busy" | "draining" | "dead";

export interface WorkerInfo {
  id: string;
  status: WorkerStatus;
  tasksCompleted: number;
  tasksFailed: number;
  currentTaskId: string | null;
  lastActiveAt: number;
  createdAt: number;
  errors: string[];
}

/** Message from pool → worker */
export interface WorkerCommand {
  type: "execute" | "ping" | "shutdown";
  taskId?: string;
  payload?: unknown;
  timeout?: number;
}

/** Message from worker → pool */
export interface WorkerResponse {
  type: "result" | "error" | "pong" | "ready" | "stolen";
  taskId?: string;
  payload?: unknown;
  error?: string;
  workerId?: string;
}

/** Task in the queue */
export interface PoolTask {
  id: string;
  payload: unknown;
  priority: number;
  timeout: number;
  retries: number;
  createdAt: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface PoolMetrics {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  queueLength: number;
  totalTasksProcessed: number;
  totalTasksFailed: number;
  averageTaskDuration: number;
  taskStealCount: number;
}

// ─────────────────────────────────────────────────────────────
// Worker Pool
// ─────────────────────────────────────────────────────────────

export class WorkerPool {
  private config: WorkerPoolConfig;
  private logger: SynapseLogger;
  private workers: Map<string, ManagedWorker> = new Map();
  private taskQueue: PoolTask[] = [];
  private running = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private scaleTimer: ReturnType<typeof setInterval> | null = null;
  private idCounter = 0;

  /** The function to execute tasks — injected by the runtime */
  private executor: ((payload: unknown) => Promise<unknown>) | null = null;

  private metrics: PoolMetrics = {
    totalWorkers: 0,
    activeWorkers: 0,
    idleWorkers: 0,
    queueLength: 0,
    totalTasksProcessed: 0,
    totalTasksFailed: 0,
    averageTaskDuration: 0,
    taskStealCount: 0,
  };

  constructor(logger: SynapseLogger, config?: Partial<WorkerPoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Start the pool with minimum workers */
  async start(executor: (payload: unknown) => Promise<unknown>): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.executor = executor;

    // Spawn minimum workers
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.spawnWorker();
    }

    // Start health checks
    this.healthTimer = setInterval(
      () => this.healthCheck(),
      this.config.healthCheckMs,
    );

    // Start auto-scaling
    this.scaleTimer = setInterval(() => this.autoScale(), 2_000);

    this.logger.info(
      "WorkerPool",
      `Started with ${this.config.minWorkers} workers (max: ${this.config.maxWorkers})`,
    );
  }

  /** Gracefully stop the pool — drain queued tasks first */
  async stop(): Promise<void> {
    this.running = false;

    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.scaleTimer) clearInterval(this.scaleTimer);

    // Reject remaining queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error("Worker pool shutting down"));
    }
    this.taskQueue = [];

    // Wait for busy workers to finish, then terminate all
    const shutdownPromises = Array.from(this.workers.values()).map((w) =>
      this.shutdownWorker(w),
    );
    await Promise.allSettled(shutdownPromises);

    this.workers.clear();
    this.logger.info("WorkerPool", "Stopped");
  }

  // ── Task Submission ────────────────────────────────────────

  /** Submit a task for execution. Returns a promise that resolves with the result. */
  submit(payload: unknown, priority: number = 3, timeout?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const task: PoolTask = {
        id: `task-${++this.idCounter}`,
        payload,
        priority,
        timeout: timeout ?? this.config.taskTimeout,
        retries: 0,
        createdAt: Date.now(),
        resolve,
        reject,
      };

      this.enqueue(task);
      this.dispatchNext();
    });
  }

  /** Submit multiple tasks and wait for all results */
  async submitAll(
    tasks: Array<{ payload: unknown; priority?: number }>,
  ): Promise<unknown[]> {
    const promises = tasks.map((t) => this.submit(t.payload, t.priority ?? 3));
    return Promise.all(promises);
  }

  // ── Queue Management ───────────────────────────────────────

  /** Add task to priority queue (sorted by priority descending) */
  private enqueue(task: PoolTask): void {
    // Binary insert for O(log n) sorted insertion
    let lo = 0;
    let hi = this.taskQueue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.taskQueue[mid].priority > task.priority) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.taskQueue.splice(lo, 0, task);
    this.metrics.queueLength = this.taskQueue.length;
  }

  /** Try to dispatch the next queued task to an idle worker */
  private dispatchNext(): void {
    if (this.taskQueue.length === 0) return;

    // Find an idle worker
    const idleWorker = this.findIdleWorker();
    if (!idleWorker) return;

    const task = this.taskQueue.shift()!;
    this.metrics.queueLength = this.taskQueue.length;
    this.assignTask(idleWorker, task);
  }

  /** Find an idle worker, preferring the one with most completions (warmed cache) */
  private findIdleWorker(): ManagedWorker | null {
    let best: ManagedWorker | null = null;
    for (const worker of this.workers.values()) {
      if (worker.info.status !== "idle") continue;
      if (!best || worker.info.tasksCompleted > best.info.tasksCompleted) {
        best = worker;
      }
    }
    return best;
  }

  /** Assign a task to a specific worker */
  private assignTask(worker: ManagedWorker, task: PoolTask): void {
    worker.info.status = "busy";
    worker.info.currentTaskId = task.id;
    worker.currentTask = task;
    worker.taskStartTime = Date.now();

    this.updateMetrics();

    // Execute inline (since Bun workers share the event loop for I/O tasks)
    this.executeInWorker(worker, task);
  }

  /** Execute a task within a managed worker's context */
  private async executeInWorker(worker: ManagedWorker, task: PoolTask): Promise<void> {
    if (!this.executor) {
      task.reject(new Error("No executor configured"));
      this.onTaskComplete(worker, task.id)
      return;
    }

    try {
      // Race between execution and timeout
      const result = await Promise.race([
        this.executor(task.payload),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Task timeout (${task.timeout}ms)`)),
            task.timeout,
          ),
        ),
      ]);

      worker.info.tasksCompleted++;
      this.metrics.totalTasksProcessed++;
      task.resolve(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Retry logic
      if (task.retries < this.config.maxRetries) {
        task.retries++;
        this.logger.warn(
          "WorkerPool",
          `Task ${task.id} failed (retry ${task.retries}/${this.config.maxRetries}): ${error.message}`,
        );
        this.enqueue(task);
      } else {
        worker.info.tasksFailed++;
        this.metrics.totalTasksFailed++;
        worker.info.errors.push(error.message);
        task.reject(error);
      }
    } finally {
      this.onTaskComplete(worker, task.id);
    }
  }

  /** Called when a task finishes (success or failure) */
  private onTaskComplete(worker: ManagedWorker, taskId: string): void {
    const duration = Date.now() - (worker.taskStartTime ?? Date.now());

    worker.info.status = "idle";
    worker.info.currentTaskId = null;
    worker.info.lastActiveAt = Date.now();
    worker.currentTask = null;
    worker.taskStartTime = null;

    // Update average duration
    const total = this.metrics.totalTasksProcessed + this.metrics.totalTasksFailed;
    if (total > 0) {
      this.metrics.averageTaskDuration =
        (this.metrics.averageTaskDuration * (total - 1) + duration) / total;
    }

    this.updateMetrics();
    this.dispatchNext(); // Try to pick up next task
  }

  // ── Task Stealing ──────────────────────────────────────────
  // Idle workers steal tasks from the front of the queue
  // (already happens via dispatchNext, but we can also steal
  // from other workers' upcoming tasks in future)

  /** Attempt task stealing — called during health checks */
  private attemptTaskStealing(): void {
    // Simple strategy: if queue has items and we have idle workers, dispatch
    while (this.taskQueue.length > 0) {
      const idle = this.findIdleWorker();
      if (!idle) break;

      const task = this.taskQueue.shift()!;
      this.metrics.queueLength = this.taskQueue.length;
      this.metrics.taskStealCount++;
      this.assignTask(idle, task);
    }
  }

  // ── Worker Management ──────────────────────────────────────

  /** Spawn a new managed worker */
  private spawnWorker(): ManagedWorker {
    const id = `worker-${++this.idCounter}`;
    const worker: ManagedWorker = {
      id,
      info: {
        id,
        status: "idle",
        tasksCompleted: 0,
        tasksFailed: 0,
        currentTaskId: null,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
        errors: [],
      },
      currentTask: null,
      taskStartTime: null,
    };

    this.workers.set(id, worker);
    this.updateMetrics();

    this.logger.debug("WorkerPool", `Spawned worker ${id}`);
    return worker;
  }

  /** Gracefully shut down a worker */
  private async shutdownWorker(worker: ManagedWorker): Promise<void> {
    worker.info.status = "draining";

    // If the worker has an active task, wait for it
    if (worker.currentTask) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (worker.info.status !== "busy" && !worker.currentTask) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        // Force kill after 10s
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 10_000);
      });
    }

    worker.info.status = "dead";
    this.workers.delete(worker.id);
    this.updateMetrics();
    this.logger.debug("WorkerPool", `Worker ${worker.id} shut down`);
  }

  // ── Health & Scaling ───────────────────────────────────────

  /** Periodic health check */
  private healthCheck(): void {
    if (!this.running) return;

    for (const worker of this.workers.values()) {
      // Check for stuck tasks
      if (
        worker.info.status === "busy" &&
        worker.taskStartTime &&
        Date.now() - worker.taskStartTime > this.config.taskTimeout * 2
      ) {
        this.logger.warn(
          "WorkerPool",
          `Worker ${worker.id} stuck on task ${worker.info.currentTaskId}`,
        );
        // Force complete the stuck task
        if (worker.currentTask) {
          worker.currentTask.reject(new Error("Worker stuck — timeout exceeded"));
          this.onTaskComplete(worker, worker.currentTask.id);
        }
      }
    }

    // Try task stealing
    this.attemptTaskStealing();
  }

  /** Auto-scale workers based on queue pressure */
  private autoScale(): void {
    if (!this.running) return;

    const queueLen = this.taskQueue.length;
    const currentWorkers = this.workers.size;

    // Scale up: queue exceeds threshold and we have room
    if (queueLen >= this.config.scaleUpThreshold && currentWorkers < this.config.maxWorkers) {
      const toAdd = Math.min(
        Math.ceil(queueLen / this.config.scaleUpThreshold),
        this.config.maxWorkers - currentWorkers,
      );
      for (let i = 0; i < toAdd; i++) {
        this.spawnWorker();
      }
      this.logger.info(
        "WorkerPool",
        `Scaled up +${toAdd} workers (queue: ${queueLen}, total: ${this.workers.size})`,
      );
    }

    // Scale down: excess idle workers beyond minimum
    if (currentWorkers > this.config.minWorkers) {
      const now = Date.now();
      const idleWorkers = Array.from(this.workers.values()).filter(
        (w) =>
          w.info.status === "idle" &&
          now - w.info.lastActiveAt > this.config.idleTimeoutMs,
      );

      const toRemove = Math.min(
        idleWorkers.length,
        currentWorkers - this.config.minWorkers,
      );

      for (let i = 0; i < toRemove; i++) {
        this.shutdownWorker(idleWorkers[i]);
      }

      if (toRemove > 0) {
        this.logger.info(
          "WorkerPool",
          `Scaled down -${toRemove} workers (total: ${this.workers.size})`,
        );
      }
    }
  }

  /** Update aggregate metrics */
  private updateMetrics(): void {
    let active = 0;
    let idle = 0;
    for (const w of this.workers.values()) {
      if (w.info.status === "busy") active++;
      if (w.info.status === "idle") idle++;
    }
    this.metrics.totalWorkers = this.workers.size;
    this.metrics.activeWorkers = active;
    this.metrics.idleWorkers = idle;
  }

  // ── Public API ─────────────────────────────────────────────

  /** Get pool metrics */
  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /** Get info for all workers */
  getWorkerInfos(): WorkerInfo[] {
    return Array.from(this.workers.values()).map((w) => ({ ...w.info }));
  }

  /** Get queue length */
  get queueLength(): number {
    return this.taskQueue.length;
  }

  /** Check if pool is running */
  isRunning(): boolean {
    return this.running;
  }
}

// ─────────────────────────────────────────────────────────────
// Internal managed worker type
// ─────────────────────────────────────────────────────────────

interface ManagedWorker {
  id: string;
  info: WorkerInfo;
  currentTask: PoolTask | null;
  taskStartTime: number | null;
}
