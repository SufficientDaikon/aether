// ─────────────────────────────────────────────────────────────
// AETHER Agent Executor
// Orchestrates multi-step LLM task execution through the
// agent hierarchy with escalation, budget tracking, and
// recursive sub-task decomposition.
//
// Phase 2 upgrades:
//   - InteractionNet + NetScheduler for parallel DAG execution
//   - RAG context enrichment (auto-inject relevant knowledge)
//   - MemoryHighway integration (pub/sub + persistent history)
//   - WorkerPool for elastic parallel execution
// ─────────────────────────────────────────────────────────────

import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  AgentTier,
  Priority,
} from "./types.ts";
import type { AgentRegistry } from "./registry.ts";
import type { EscalationManager } from "./escalation.ts";
import type { SynapseLogger } from "./logger.ts";
import type { ProviderManager } from "../providers/manager.ts";
import type { LLMResponse } from "../providers/base.ts";
import { TransportManager } from "../transports/manager.ts";

// Phase 2 subsystem imports
import type { InteractionNet } from "./interaction-net.ts";
import type { NetScheduler } from "./net-scheduler.ts";
import type { WorkerPool } from "./worker-pool.ts";
import type { MemoryHighway, HighwayMessage } from "./memory-highway.ts";
import type { RAGIndex } from "./rag-index.ts";
import type { Embedder } from "./embedder.ts";
import type { AetherStore } from "./storage/store.ts";

// Phase 3 subsystem imports (Supercharge)
import type { GuardrailsPipeline } from "./guardrails.ts";
import type { AgentRouter } from "./router.ts";
import type { EntityMemory } from "./entity-memory.ts";
import type { ConversationManager } from "./conversation.ts";
import type { ProgressTracker } from "./progress-tracker.ts";
import type { HandoffManager } from "./handoff.ts";
import type { PluginRegistry } from "./plugin.ts";
import type { SchemaValidator } from "./schema.ts";

// Phase 8 subsystem imports (ACP, Structured Logging, Shared State)
import type { ACPBus } from "./acp.ts";
import type { StructuredLogger } from "./structured-logger.ts";
import type { SharedStateBus } from "./shared-state.ts";

// New subsystem imports: Security + Steering
import { sanitizePromptInput } from "./security/index.ts";
import { loadSteering, compose, type SteeringFile } from "./steering/index.ts";

// ─────────────────────────────────────────────────────────────

/** Options for configuring executor behavior */
export interface ExecutorOptions {
  /** Maximum recursion depth for sub-task decomposition (default: 3) */
  maxDepth: number;
  /** Default timeout per task in ms (default: 120_000 — 2 minutes) */
  defaultTimeout: number;
  /** Maximum tokens per LLM call (default: 4096) */
  maxTokens: number;
  /** Temperature for LLM calls (default: 0.7) */
  temperature: number;
  /** Whether to attempt escalation on failure (default: true) */
  enableEscalation: boolean;
  /** Whether to allow recursive sub-task decomposition (default: true) */
  enableSubTasks: boolean;
  /** Use InteractionNet graph for parallel pipeline execution (default: false) */
  useInteractionNet: boolean;
  /** Auto-enrich prompts with RAG context (default: false) */
  useRAGContext: boolean;
  /** Number of RAG results to inject into context (default: 3) */
  ragTopK: number;
  /** Record all executions to MemoryHighway (default: false) */
  useMemoryHighway: boolean;
}

const DEFAULT_OPTIONS: ExecutorOptions = {
  maxDepth: 3,
  defaultTimeout: 120_000,
  maxTokens: 4096,
  temperature: 0.7,
  enableEscalation: true,
  enableSubTasks: true,
  useInteractionNet: false,
  useRAGContext: false,
  ragTopK: 3,
  useMemoryHighway: false,
};

/** Phase 2 subsystems — injected after construction */
export interface ExecutorSubsystems {
  interactionNet?: InteractionNet;
  scheduler?: NetScheduler;
  workerPool?: WorkerPool;
  highway?: MemoryHighway;
  ragIndex?: RAGIndex;
  embedder?: Embedder;
  // Phase 3 (Supercharge)
  guardrails?: GuardrailsPipeline;
  router?: AgentRouter;
  entityMemory?: EntityMemory;
  conversationManager?: ConversationManager;
  progressTracker?: ProgressTracker;
  handoffManager?: HandoffManager;
  pluginRegistry?: PluginRegistry;
  schemaValidator?: SchemaValidator;
  // Phase 8 (ACP, Structured Logging, Shared State)
  acpBus?: ACPBus;
  structuredLogger?: StructuredLogger;
  sharedState?: SharedStateBus;
  // Steering files for prompt injection
  steeringFiles?: SteeringFile[];
}

/** Execution context threaded through recursive calls */
interface ExecutionContext {
  depth: number;
  parentTaskId: string | null;
  accumulatedContext: Record<string, unknown>;
  startTime: number;
}

/** Internal execution metrics */
export interface ExecutorMetrics {
  totalTasks: number;
  successful: number;
  failed: number;
  escalated: number;
  totalTokens: number;
  totalDuration: number;
  averageLatency: number;
}

// ─────────────────────────────────────────────────────────────

export class AgentExecutor {
  private registry: AgentRegistry;
  private escalation: EscalationManager;
  private logger: SynapseLogger;
  private providers: ProviderManager;
  private transportManager: TransportManager;
  private options: ExecutorOptions;

  // Phase 2 subsystems (injected via setSubsystems)
  private interactionNet: InteractionNet | null = null;
  private scheduler: NetScheduler | null = null;
  private workerPool: WorkerPool | null = null;
  private highway: MemoryHighway | null = null;
  private ragIndex: RAGIndex | null = null;
  private embedder: Embedder | null = null;

  // Persistent storage (optional)
  private store: AetherStore | null = null;

  // Phase 3 subsystems (Supercharge)
  private guardrails: GuardrailsPipeline | null = null;
  private router: AgentRouter | null = null;
  private entityMemory: EntityMemory | null = null;
  private conversationManager: ConversationManager | null = null;
  private progressTracker: ProgressTracker | null = null;
  private handoffManager: HandoffManager | null = null;
  private pluginRegistry: PluginRegistry | null = null;
  private schemaValidator: SchemaValidator | null = null;

  // Phase 8 subsystems (ACP, Structured Logging, Shared State)
  private acpBus: ACPBus | null = null;
  private structuredLogger: StructuredLogger | null = null;
  private sharedState: SharedStateBus | null = null;

  // Steering files for prompt injection
  private steeringFiles: SteeringFile[] = [];

  // Task history for introspection
  private taskHistory: TaskResult[] = [];
  private metrics: ExecutorMetrics = {
    totalTasks: 0,
    successful: 0,
    failed: 0,
    escalated: 0,
    totalTokens: 0,
    totalDuration: 0,
    averageLatency: 0,
  };

  constructor(
    registry: AgentRegistry,
    escalation: EscalationManager,
    logger: SynapseLogger,
    providers: ProviderManager,
    transportManager?: TransportManager,
    options?: Partial<ExecutorOptions>,
  ) {
    this.registry = registry;
    this.escalation = escalation;
    this.logger = logger;
    this.providers = providers;
    this.transportManager = transportManager ?? new TransportManager();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Inject Phase 2 subsystems. Call after construction.
   * Automatically enables features when subsystems are provided.
   */
  setSubsystems(subsystems: ExecutorSubsystems): void {
    if (subsystems.interactionNet)
      this.interactionNet = subsystems.interactionNet;
    if (subsystems.scheduler) this.scheduler = subsystems.scheduler;
    if (subsystems.workerPool) this.workerPool = subsystems.workerPool;
    if (subsystems.highway) {
      this.highway = subsystems.highway;
      this.options.useMemoryHighway = true;
    }
    if (subsystems.ragIndex) {
      this.ragIndex = subsystems.ragIndex;
      this.options.useRAGContext = true;
    }
    if (subsystems.embedder) this.embedder = subsystems.embedder;

    // Phase 3 subsystems (Supercharge)
    if (subsystems.guardrails) this.guardrails = subsystems.guardrails;
    if (subsystems.router) this.router = subsystems.router;
    if (subsystems.entityMemory) this.entityMemory = subsystems.entityMemory;
    if (subsystems.conversationManager)
      this.conversationManager = subsystems.conversationManager;
    if (subsystems.progressTracker)
      this.progressTracker = subsystems.progressTracker;
    if (subsystems.handoffManager)
      this.handoffManager = subsystems.handoffManager;
    if (subsystems.pluginRegistry)
      this.pluginRegistry = subsystems.pluginRegistry;
    if (subsystems.schemaValidator)
      this.schemaValidator = subsystems.schemaValidator;

    // Phase 8 subsystems (ACP, Structured Logging, Shared State)
    if (subsystems.acpBus) this.acpBus = subsystems.acpBus;
    if (subsystems.structuredLogger)
      this.structuredLogger = subsystems.structuredLogger;
    if (subsystems.sharedState) this.sharedState = subsystems.sharedState;

    // Steering files
    if (subsystems.steeringFiles) this.steeringFiles = subsystems.steeringFiles;

    // Auto-enable interaction net if both net + scheduler provided
    if (this.interactionNet && this.scheduler) {
      this.options.useInteractionNet = true;
    }

    this.logger.info(
      "Executor",
      `Subsystems loaded: ${[
        this.interactionNet && "InteractionNet",
        this.scheduler && "NetScheduler",
        this.workerPool && "WorkerPool",
        this.highway && "MemoryHighway",
        this.ragIndex && "RAGIndex",
        this.embedder && "Embedder",
        this.guardrails && "Guardrails",
        this.router && "Router",
        this.entityMemory && "EntityMemory",
        this.conversationManager && "ConversationManager",
        this.progressTracker && "ProgressTracker",
        this.handoffManager && "HandoffManager",
        this.pluginRegistry && "PluginRegistry",
        this.schemaValidator && "SchemaValidator",
        this.acpBus && "ACPBus",
        this.structuredLogger && "StructuredLogger",
        this.sharedState && "SharedStateBus",
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  }

  /**
   * Attach a persistent store. Loads cumulative metrics from DB
   * so counters survive restarts.
   */
  setStore(store: AetherStore): void {
    this.store = store;
    try {
      const dbMetrics = store.getTaskMetrics();
      this.metrics.totalTasks = dbMetrics.totalTasks;
      this.metrics.successful = dbMetrics.successful;
      this.metrics.failed = dbMetrics.failed;
      this.metrics.escalated = dbMetrics.escalated;
      this.metrics.totalTokens = dbMetrics.totalTokens;
      this.metrics.totalDuration = dbMetrics.totalDuration;
      this.metrics.averageLatency = dbMetrics.averageLatency;
    } catch {
      // Store may be empty — that's fine
    }
  }

  // ── Primary Execution ──────────────────────────────────────

  /**
   * Execute a single task.
   * Resolves the target agent, loads its prompt, calls the LLM,
   * parses the response, and optionally handles sub-tasks/escalation.
   */
  async execute(task: TaskRequest): Promise<TaskResult> {
    const ctx: ExecutionContext = {
      depth: 0,
      parentTaskId: null,
      accumulatedContext: {},
      startTime: Date.now(),
    };

    this.logger.info(
      "Executor",
      `Starting task "${task.id}": ${task.description}`,
    );
    return this.executeInternal(task, ctx);
  }

  /**
   * Execute a sequential workflow: each task's result feeds into
   * the next task's context under the key "previousResult".
   */
  async executeWorkflow(tasks: TaskRequest[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    let accContext: Record<string, unknown> = {};

    this.logger.info(
      "Executor",
      `Starting workflow with ${tasks.length} tasks`,
    );

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      // Thread accumulated context into the task
      const enrichedTask: TaskRequest = {
        ...task,
        context: {
          ...task.context,
          previousResult:
            results.length > 0 ? results[results.length - 1].output : undefined,
          workflowStep: i + 1,
          workflowTotal: tasks.length,
          accumulatedContext: accContext,
        },
      };

      const result = await this.execute(enrichedTask);
      results.push(result);

      // Break workflow on critical failure (non-partial)
      if (result.status === "failure") {
        this.logger.warn(
          "Executor",
          `Workflow halted at step ${i + 1}: task "${task.id}" failed`,
        );
        break;
      }

      // Accumulate successful output into context
      if (result.status === "success" || result.status === "partial") {
        accContext[`step_${i + 1}`] = result.output;
      }
    }

    this.logger.info(
      "Executor",
      `Workflow complete: ${results.filter((r) => r.status === "success").length}/${tasks.length} succeeded`,
    );
    return results;
  }

  /**
   * Execute tasks in parallel. All tasks run simultaneously.
   * Returns results in the same order as input tasks.
   *
   * When InteractionNet is available, tasks are modeled as
   * interaction combinator nodes and reduced by the NetScheduler,
   * enabling deadlock-free parallelism with automatic fan-out.
   */
  async executePipeline(tasks: TaskRequest[]): Promise<TaskResult[]> {
    this.logger.info(
      "Executor",
      `Starting pipeline with ${tasks.length} parallel tasks`,
    );

    // ── InteractionNet Path ──────────────────────────────────
    if (
      this.options.useInteractionNet &&
      this.interactionNet &&
      this.scheduler
    ) {
      return this.executePipelineViaNet(tasks);
    }

    // ── Classic Path (Promise.allSettled) ─────────────────────
    const promises = tasks.map((task) => this.execute(task));
    const settled = await Promise.allSettled(promises);

    return settled.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      // Promise rejected — wrap in a failure TaskResult
      return {
        requestId: tasks[i].id,
        executor: "pipeline-error",
        status: "failure" as const,
        output: {
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        },
        duration: 0,
      };
    });
  }

  /**
   * Execute a pipeline using InteractionNet graph reduction.
   * Creates a fresh scheduler with a task executor wired to
   * this executor's internal execution logic, builds a parallel
   * DAG, and reduces to normal form.
   */
  private async executePipelineViaNet(
    tasks: TaskRequest[],
  ): Promise<TaskResult[]> {
    // We need dynamic imports to avoid circular dependencies at load time
    const { InteractionNet } = await import("./interaction-net.ts");
    const { NetScheduler } = await import("./net-scheduler.ts");

    const net = new InteractionNet();

    // Map to collect results keyed by taskId
    const resultMap = new Map<string, TaskResult>();

    // Create a scheduler with a task executor that delegates to this.execute()
    const scheduler = new NetScheduler(net, this.logger, {
      maxConcurrency: Math.min(tasks.length, 8),
      scanIntervalMs: 10,
      taskExecutor: async (taskPayload) => {
        const request = taskPayload.context?.request as TaskRequest | undefined;
        if (!request) {
          return {
            error: `No request in task payload ${taskPayload.description}`,
          };
        }

        const result = await this.execute(request);
        resultMap.set(request.id, result);
        return result.output;
      },
    });

    // Build a parallel DAG: one task node per request
    const { tasks: taskNodes } = net.buildParallelDAG(
      tasks.map((t) => ({
        description: t.description,
        agentId: t.target,
        context: { request: t },
        priority: t.priority as 0 | 1 | 2 | 3 | 4 | 5,
      })),
    );

    this.logger.info(
      "Executor",
      `Built InteractionNet DAG with ${taskNodes.length} task nodes`,
    );

    // Run to completion
    await scheduler.runToCompletion();

    // Collect results in original task order
    return tasks.map((task) => {
      const result = resultMap.get(task.id);
      if (result) return result;

      // Task wasn't executed (erased/cancelled by net reduction)
      return {
        requestId: task.id,
        executor: "net-cancelled",
        status: "failure" as const,
        output: { error: "Task was cancelled during graph reduction" },
        duration: 0,
      };
    });
  }

  // ── Internal Recursive Execution ───────────────────────────

  private async executeInternal(
    task: TaskRequest,
    ctx: ExecutionContext,
  ): Promise<TaskResult> {
    const taskStart = Date.now();
    this.metrics.totalTasks++;

    // Depth check
    if (ctx.depth > this.options.maxDepth) {
      this.logger.warn(
        "Executor",
        `Max depth ${this.options.maxDepth} reached for task "${task.id}"`,
      );
      return this.failResult(
        task.id,
        "system",
        "Maximum recursion depth exceeded",
        taskStart,
      );
    }

    // Resolve the target agent
    const agent = await this.resolveAgent(task.target);
    if (!agent) {
      this.logger.warn(
        "Executor",
        `No agent found for target "${task.target}"`,
      );
      return this.failResult(
        task.id,
        "unknown",
        `No agent found for target: ${task.target}`,
        taskStart,
      );
    }

    this.logger.info(
      "Executor",
      `Resolved agent "${agent.id}" (${agent.tier}) for task "${task.id}"`,
    );

    // Mark agent as active
    try {
      this.registry.updateStatus(agent.id, "busy");
    } catch {
      // Agent status update is best-effort
    }

    // Deadline check
    if (task.deadline && Date.now() > task.deadline) {
      this.releaseAgent(agent.id);
      return this.failResult(
        task.id,
        agent.id,
        "Task deadline exceeded before execution",
        taskStart,
      );
    }

    // ── External Transport Path ─────────────────────────────
    // If the agent has a transport config, route through
    // TransportManager instead of the local LLM path.
    if (this.transportManager.isExternalAgent(agent)) {
      this.logger.info(
        "Executor",
        `Routing task "${task.id}" via ${agent.transport!.transport} transport to "${agent.id}"`,
      );
      try {
        const result = await this.transportManager.execute(task, agent);
        this.releaseAgent(agent.id);
        this.recordResult(result);
        if (result.status === "success") {
          this.metrics.successful++;
          this.metrics.totalDuration += result.duration;
        } else {
          this.metrics.failed++;
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          "Executor",
          `Transport execution failed for "${agent.id}": ${msg}`,
        );
        this.releaseAgent(agent.id);

        // Attempt escalation for external agent failures too
        if (this.options.enableEscalation) {
          return this.handleEscalation(task, agent, ctx, msg, taskStart);
        }
        const result = this.failResult(task.id, agent.id, msg, taskStart);
        this.recordResult(result);
        return result;
      }
    }

    // ── Local LLM Path ──────────────────────────────────────
    try {
      // Sanitize user-provided task description before building prompt
      const sanitized = sanitizePromptInput(task.description, { field: "task" });
      if (sanitized.patternsDetected.length > 0) {
        this.logger.warn("Executor", `Prompt security: detected patterns in task "${task.id}": ${sanitized.patternsDetected.join(", ")}`);
      }
      const sanitizedTask = { ...task, description: sanitized.sanitized };

      // Load the agent's prompt template
      let systemPrompt = await this.loadAgentPrompt(agent);

      // Inject steering context if steering files are loaded
      if (this.steeringFiles.length > 0) {
        const steering = compose(this.steeringFiles, agent.id, 4000);
        if (steering.content) {
          systemPrompt = systemPrompt + `\n\n## Project Steering\n\n${steering.content}`;
          if (steering.truncated) {
            this.logger.warn("Executor", `Steering context truncated for agent "${agent.id}"`);
          }
        }
      }

      // Build the full prompt (includes RAG context if enabled)
      const prompt = await this.buildPromptWithRAG(sanitizedTask, ctx, agent);

      // Record task start in MemoryHighway
      if (this.options.useMemoryHighway && this.highway) {
        this.highway.publish(
          "executor",
          "task",
          {
            taskId: task.id,
            agentId: agent.id,
            description: task.description,
            depth: ctx.depth,
          },
          {
            summary: `Task ${task.id} started on ${agent.id}`,
            sender: "executor",
          },
        );
      }

      // Call the LLM
      const response = await this.callLLM(
        agent,
        prompt,
        systemPrompt,
        task.overrides,
      );

      // Track tokens
      this.metrics.totalTokens += response.tokensUsed.total;

      // Parse the response for sub-task requests
      const parsed = this.parseResponse(response.content, task.id);

      // If the agent requested sub-tasks and we allow them, recurse
      if (
        parsed.subTasks.length > 0 &&
        this.options.enableSubTasks &&
        ctx.depth < this.options.maxDepth
      ) {
        this.logger.info(
          "Executor",
          `Agent "${agent.id}" requested ${parsed.subTasks.length} sub-tasks`,
        );

        const subResults: TaskResult[] = [];
        for (const subTask of parsed.subTasks) {
          const subCtx: ExecutionContext = {
            depth: ctx.depth + 1,
            parentTaskId: task.id,
            accumulatedContext: {
              ...ctx.accumulatedContext,
              parentOutput: parsed.mainOutput,
            },
            startTime: ctx.startTime,
          };
          const subResult = await this.executeInternal(subTask, subCtx);
          subResults.push(subResult);
        }

        // Combine outputs
        const combinedOutput = {
          mainOutput: parsed.mainOutput,
          subTaskResults: subResults.map((r) => ({
            requestId: r.requestId,
            status: r.status,
            output: r.output,
          })),
        };

        const result = this.successResult(
          task.id,
          agent.id,
          combinedOutput,
          taskStart,
          response.tokensUsed.total,
        );
        this.releaseAgent(agent.id);
        this.recordResult(result);
        return result;
      }

      // No sub-tasks — return the direct result
      const result = this.successResult(
        task.id,
        agent.id,
        parsed.mainOutput,
        taskStart,
        response.tokensUsed.total,
      );
      this.releaseAgent(agent.id);
      this.recordResult(result);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        "Executor",
        `Agent "${agent.id}" failed on task "${task.id}": ${errorMsg}`,
      );

      this.releaseAgent(agent.id);

      // Attempt escalation if enabled
      if (this.options.enableEscalation) {
        return this.handleEscalation(task, agent, ctx, errorMsg, taskStart);
      }

      const result = this.failResult(task.id, agent.id, errorMsg, taskStart);
      this.recordResult(result);
      return result;
    }
  }

  // ── Agent Resolution ───────────────────────────────────────

  private async resolveAgent(target: string): Promise<AgentDefinition | null> {
    // Use the context-aware router when available
    if (this.router) {
      try {
        const allAgents = this.registry
          .getAll()
          .filter((a) => a.status !== "offline");
        const decision = await this.router.resolve(target, allAgents, {
          targetId: target,
        });
        if (decision) return decision.agent;
      } catch {
        // Router failed — fall through to manual resolution
      }
    }

    // Try direct ID lookup first
    const direct = this.registry.get(target);
    if (direct) return direct;

    // Try capability-based resolution
    const byCapability = this.registry.resolve(target);
    if (byCapability) return byCapability;

    // Try section-based resolution
    const sectionMap: Record<string, string> = {
      frontend: "FRONTEND",
      backend: "BACKEND",
      research: "RESEARCH",
      tools: "TOOLS",
      mcp: "MCP_SERVER",
      marketing: "MARKETING",
      audit: "AUDIT",
      meta: "META",
      workflow: "WORKFLOW",
      skill: "SKILL",
    };

    const section = sectionMap[target.toLowerCase()];
    if (section) {
      const bySection = this.registry.findBySection(section as any);
      if (bySection.length > 0) {
        const available = bySection.filter((a) => a.status !== "offline");
        if (available.length > 0) return available[0];
      }
    }

    return null;
  }

  // ── Prompt Construction ────────────────────────────────────

  private async loadAgentPrompt(agent: AgentDefinition): Promise<string> {
    try {
      const content = await Bun.file(agent.filePath).text();
      // Strip YAML frontmatter if present
      const stripped = content.replace(/^---[\s\S]*?---\s*/m, "");
      return stripped.trim();
    } catch {
      // Fallback: generate a basic system prompt from agent metadata
      return [
        `You are ${agent.name}, a ${agent.tier}-tier agent.`,
        `Capabilities: ${agent.capabilities.join(", ")}`,
        `Output format: ${agent.format}`,
        `Respond thoroughly and accurately to the task given.`,
      ].join("\n");
    }
  }

  private buildPrompt(
    task: TaskRequest,
    ctx: ExecutionContext,
    agent: AgentDefinition,
  ): string {
    const parts: string[] = [];

    parts.push(`## Task: ${task.description}`);
    parts.push(`Priority: ${task.priority}/5`);

    if (Object.keys(task.context).length > 0) {
      parts.push(`\n### Context`);
      parts.push("```json");
      parts.push(JSON.stringify(task.context, null, 2));
      parts.push("```");
    }

    if (ctx.depth > 0 && Object.keys(ctx.accumulatedContext).length > 0) {
      parts.push(`\n### Previous Work (depth ${ctx.depth})`);
      parts.push("```json");
      parts.push(JSON.stringify(ctx.accumulatedContext, null, 2));
      parts.push("```");
    }

    if (task.deadline) {
      const remaining = task.deadline - Date.now();
      parts.push(
        `\nDeadline: ${remaining > 0 ? `${Math.round(remaining / 1000)}s remaining` : "EXPIRED"}`,
      );
    }

    // Instructions for sub-task requests
    if (this.options.enableSubTasks && ctx.depth < this.options.maxDepth) {
      parts.push(`\n### Sub-task Protocol`);
      parts.push(
        `If this task requires work from other specialized agents, you may request sub-tasks.`,
      );
      parts.push(
        `Include a JSON block wrapped in \`\`\`subtasks ... \`\`\` with an array of objects:`,
      );
      parts.push(
        `[{"target": "agent-id-or-capability", "description": "what to do", "priority": 3}]`,
      );
      parts.push(
        `Available agents: ${this.registry
          .getAll()
          .map((a) => `${a.id} (${a.capabilities.join(", ")})`)
          .join("; ")}`,
      );
    }

    return parts.join("\n");
  }

  /**
   * Build prompt with optional RAG context enrichment.
   * Queries the RAG index for relevant knowledge and injects
   * it as additional context before the main task description.
   */
  private async buildPromptWithRAG(
    task: TaskRequest,
    ctx: ExecutionContext,
    agent: AgentDefinition,
  ): Promise<string> {
    const basePrompt = this.buildPrompt(task, ctx, agent);

    // Skip RAG if not enabled or no index available
    if (!this.options.useRAGContext || !this.ragIndex) {
      return basePrompt;
    }

    try {
      // Search for relevant context using the task description
      const ragResults = await this.ragIndex.query(task.description, {
        topK: this.options.ragTopK,
      });

      if (ragResults.length === 0) return basePrompt;

      // Format RAG context
      const ragContext = ragResults
        .map(
          (r, i) =>
            `[${i + 1}] (${r.namespace}, score: ${r.score.toFixed(2)})\n${r.text}`,
        )
        .join("\n\n");

      // Inject before the main prompt
      return `### Relevant Context (from knowledge base)\n${ragContext}\n\n---\n\n${basePrompt}`;
    } catch (err) {
      // RAG failure should never block execution
      this.logger.warn(
        "Executor",
        `RAG context enrichment failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return basePrompt;
    }
  }

  // ── LLM Invocation ─────────────────────────────────────────

  private async callLLM(
    agent: AgentDefinition,
    prompt: string,
    systemPrompt: string,
    overrides?: { provider?: string; model?: string },
  ): Promise<LLMResponse> {
    const timeoutMs = this.options.defaultTimeout;

    const baseOpts = {
      model: overrides?.model ?? undefined,
      maxTokens: this.options.maxTokens,
      temperature: this.options.temperature,
      systemPrompt,
    };

    // If an explicit provider is requested, bypass tier routing entirely
    let llmPromise: Promise<LLMResponse>;
    if (overrides?.provider) {
      this.logger.info(
        "Executor",
        `Using direct provider: ${overrides.provider} (model: ${baseOpts.model})`,
      );
      llmPromise = this.providers.sendDirect(
        overrides.provider as import("./types.ts").LLMProvider,
        prompt,
        baseOpts,
      );
    } else {
      // Tier-based routing — model override still flows through via options merge
      llmPromise = this.providers.sendForTier(agent.tier, prompt, baseOpts);
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    return Promise.race([llmPromise, timeoutPromise]);
  }

  // ── Response Parsing ───────────────────────────────────────

  private parseResponse(
    content: string,
    parentTaskId: string,
  ): { mainOutput: string; subTasks: TaskRequest[] } {
    const subTasks: TaskRequest[] = [];

    // Extract sub-task blocks: ```subtasks [ ... ] ```
    const subTaskMatch = content.match(/```subtasks\s*([\s\S]*?)```/);

    if (subTaskMatch) {
      try {
        const parsed = JSON.parse(subTaskMatch[1].trim());
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            subTasks.push({
              id: `${parentTaskId}-sub-${crypto.randomUUID().slice(0, 8)}`,
              description: item.description ?? "Sub-task",
              requester: parentTaskId,
              target: item.target ?? "worker",
              priority: item.priority ?? 3,
              context: item.context ?? {},
              deadline: item.deadline,
            });
          }
        }
      } catch {
        // Invalid JSON in subtasks block — ignore and treat as main output
      }
    }

    // Main output is everything except the subtasks block
    const mainOutput = content.replace(/```subtasks\s*[\s\S]*?```/g, "").trim();

    return { mainOutput, subTasks };
  }

  // ── Escalation ─────────────────────────────────────────────

  private async handleEscalation(
    task: TaskRequest,
    failedAgent: AgentDefinition,
    ctx: ExecutionContext,
    errorMsg: string,
    taskStart: number,
  ): Promise<TaskResult> {
    this.logger.info(
      "Executor",
      `Attempting escalation for task "${task.id}" from "${failedAgent.id}"`,
    );

    const escalationResult = this.escalation.escalate(
      failedAgent.id,
      errorMsg,
      task.priority,
    );

    if (escalationResult.circuitBroken) {
      this.logger.warn(
        "Executor",
        `Circuit breaker tripped for "${failedAgent.id}" — no escalation`,
      );
      this.metrics.escalated++;
      const result: TaskResult = {
        requestId: task.id,
        executor: failedAgent.id,
        status: "escalated",
        output: {
          error: errorMsg,
          escalation: "Circuit breaker tripped — too many escalations",
          recommendation: escalationResult.recommendation,
        },
        duration: Date.now() - taskStart,
      };
      this.recordResult(result);
      return result;
    }

    if (escalationResult.target) {
      this.metrics.escalated++;
      this.logger.info(
        "Executor",
        `Escalating task "${task.id}" to "${escalationResult.target.id}"`,
      );

      // Retry with the escalation target
      const escalatedTask: TaskRequest = {
        ...task,
        target: escalationResult.target.id,
        context: {
          ...task.context,
          escalatedFrom: failedAgent.id,
          escalationReason: errorMsg,
          originalPriority: task.priority,
        },
        priority: Math.min(task.priority + 1, 5) as Priority,
      };

      const escalatedCtx: ExecutionContext = {
        ...ctx,
        depth: ctx.depth + 1,
      };

      return this.executeInternal(escalatedTask, escalatedCtx);
    }

    // No escalation target available
    const result = this.failResult(
      task.id,
      failedAgent.id,
      `${errorMsg} (no escalation target available)`,
      taskStart,
    );
    this.recordResult(result);
    return result;
  }

  // ── Result Builders ────────────────────────────────────────

  private successResult(
    requestId: string,
    executor: string,
    output: unknown,
    startTime: number,
    tokensUsed?: number,
  ): TaskResult {
    this.metrics.successful++;
    const duration = Date.now() - startTime;
    this.metrics.totalDuration += duration;
    this.metrics.averageLatency =
      this.metrics.totalDuration /
      (this.metrics.successful + this.metrics.failed);

    return {
      requestId,
      executor,
      status: "success",
      output,
      duration,
      tokensUsed,
    };
  }

  private failResult(
    requestId: string,
    executor: string,
    error: string,
    startTime: number,
  ): TaskResult {
    this.metrics.failed++;
    const duration = Date.now() - startTime;
    this.metrics.totalDuration += duration;
    this.metrics.averageLatency =
      this.metrics.totalDuration /
      (this.metrics.successful + this.metrics.failed);

    return {
      requestId,
      executor,
      status: "failure",
      output: { error },
      duration,
    };
  }

  private recordResult(result: TaskResult): void {
    this.taskHistory.push(result);
    // Keep last 1000 results to prevent unbounded growth
    if (this.taskHistory.length > 1000) {
      this.taskHistory = this.taskHistory.slice(-500);
    }

    // Persist to store (best-effort, fire-and-forget)
    if (this.store) {
      try {
        this.store.saveTaskResult(result);
        this.store.incrementCounter("tasks.total");
        this.store.incrementCounter(`tasks.${result.status}`);
        if (result.tokensUsed) {
          this.store.incrementCounter("tokens.total", result.tokensUsed);
        }
      } catch {
        // Store write is best-effort — don't break execution flow
      }
    }

    // Publish completion to MemoryHighway (fire-and-forget)
    if (this.options.useMemoryHighway && this.highway) {
      const msgType: HighwayMessage["type"] =
        result.status === "success"
          ? "result"
          : result.status === "escalated"
            ? "escalation"
            : "event";

      this.highway.publish(
        "executor",
        msgType,
        {
          requestId: result.requestId,
          executor: result.executor,
          status: result.status,
          duration: result.duration,
          tokensUsed: result.tokensUsed,
          outputPreview:
            typeof result.output === "string"
              ? result.output.slice(0, 200)
              : JSON.stringify(result.output).slice(0, 200),
        },
        {
          summary: `Task ${result.requestId} ${result.status}`,
          sender: "executor",
        },
      );
    }
  }

  private releaseAgent(agentId: string): void {
    try {
      this.registry.updateStatus(agentId, "idle");
    } catch {
      // Best-effort status update
    }
  }

  // ── Introspection ──────────────────────────────────────────

  /** Get cumulative execution metrics */
  getMetrics(): ExecutorMetrics {
    return { ...this.metrics };
  }

  /** Get task execution history (last N results) */
  getHistory(limit: number = 50): TaskResult[] {
    // Prefer persistent store when available
    if (this.store) {
      try {
        return this.store.getRecentTasks(limit);
      } catch {
        // Fall back to in-memory history
      }
    }
    return this.taskHistory.slice(-limit);
  }

  /** Get current executor configuration */
  getOptions(): ExecutorOptions {
    return { ...this.options };
  }

  /** Update executor options at runtime */
  updateOptions(updates: Partial<ExecutorOptions>): void {
    this.options = { ...this.options, ...updates };
  }

  /** Reset all metrics and history */
  reset(): void {
    this.taskHistory = [];
    this.metrics = {
      totalTasks: 0,
      successful: 0,
      failed: 0,
      escalated: 0,
      totalTokens: 0,
      totalDuration: 0,
      averageLatency: 0,
    };
  }

  /** Check if Phase 2 subsystems are loaded */
  hasSubsystems(): boolean {
    return !!(
      this.interactionNet ||
      this.highway ||
      this.ragIndex ||
      this.guardrails ||
      this.router ||
      this.entityMemory
    );
  }

  /** Get loaded subsystem names */
  getSubsystemNames(): string[] {
    return [
      this.interactionNet && "InteractionNet",
      this.scheduler && "NetScheduler",
      this.workerPool && "WorkerPool",
      this.highway && "MemoryHighway",
      this.ragIndex && "RAGIndex",
      this.embedder && "Embedder",
      this.guardrails && "Guardrails",
      this.router && "Router",
      this.entityMemory && "EntityMemory",
      this.conversationManager && "ConversationManager",
      this.progressTracker && "ProgressTracker",
      this.handoffManager && "HandoffManager",
      this.pluginRegistry && "PluginRegistry",
      this.schemaValidator && "SchemaValidator",
    ].filter(Boolean) as string[];
  }
}
