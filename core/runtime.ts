// ─────────────────────────────────────────────────────────────
// AETHER Runtime
// Bootstraps and orchestrates all subsystems: registry,
// escalation, logging, config, server, and providers.
// ─────────────────────────────────────────────────────────────

import { AgentRegistry } from "./registry.ts";
import { EscalationManager } from "./escalation.ts";
import { SynapseLogger } from "./logger.ts";
import { ConfigManager, WorkspaceScanner } from "./config.ts";
import { AetherLinkServer } from "../protocol/server.ts";
import { ProviderManager } from "../providers/manager.ts";
import { AgentExecutor } from "./executor.ts";
import { SQLiteStore } from "./storage/sqlite-store.ts";
import type { AetherStore } from "./storage/store.ts";
import type {
  AetherConfig,
  AgentDefinition,
  AgentTier,
  LLMProvider,
  RegistrySection,
  AgentFormat,
  LLMModelTier,
  TaskRequest,
  TaskResult,
  TransportConfig,
} from "./types.ts";
import { TransportManager } from "../transports/manager.ts";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";

// Phase 3 subsystem imports (Supercharge)
import { GuardrailsPipeline, createDefaultGuardrails } from "./guardrails.ts";
import { AgentRouter } from "./router.ts";
import { EntityMemory } from "./entity-memory.ts";
import { ConversationManager } from "./conversation.ts";
import { ProgressTracker } from "./progress-tracker.ts";
import { HandoffManager } from "./handoff.ts";
import { PluginRegistry } from "./plugin.ts";
import { SchemaValidator } from "./schema.ts";
import { ReactionEngine } from "./reaction-engine.ts";
import { DurableWorkflow } from "./durable.ts";

// Phase 9: Settings
import { SettingsManager } from "./settings.ts";
import type { AetherSettings } from "./types.ts";

// Phase 8 subsystem imports (ACP, Structured Logging, Shared State)
import { StructuredLogger } from "./structured-logger.ts";
import { SharedStateBus } from "./shared-state.ts";
import { ACPBus } from "./acp.ts";

// Phase 11: Embedder + RAG Index for vector-powered routing
import { Embedder } from "./embedder.ts";
import { RAGIndex } from "./rag-index.ts";

// Phase 13: Extensible Tiers — Forge, Sentinel, TierRegistry
import { TierRegistry } from "./tier-registry.ts";
import { AgentForge } from "./forge.ts";
import { SystemSentinel } from "./sentinel.ts";

// New subsystems: Hooks, Powers, Steering, Fallback
import { EventBus, HookRegistry } from "./hooks/index.ts";
import { PowerRegistry } from "./powers/index.ts";
import { loadSteering, type LoadSteeringResult } from "./steering/index.ts";
import { FallbackChainManager, FallbackLogger } from "./fallback/index.ts";

// ─────────────────────────────────────────────────────────────

export class AetherRuntime {
  public registry: AgentRegistry;
  public escalation: EscalationManager;
  public logger: SynapseLogger;
  public config: ConfigManager;
  public server: AetherLinkServer | null = null;
  public providers: ProviderManager | null = null;
  public transports: TransportManager;
  public store: AetherStore | null = null;

  // Phase 3 subsystems (Supercharge)
  public guardrails: GuardrailsPipeline | null = null;
  public agentRouter: AgentRouter | null = null;
  public entityMemory: EntityMemory | null = null;
  public conversationManager: ConversationManager | null = null;
  public progressTracker: ProgressTracker | null = null;
  public handoffManager: HandoffManager | null = null;
  public pluginRegistry: PluginRegistry | null = null;
  public schemaValidator: SchemaValidator | null = null;
  public reactionEngine: ReactionEngine | null = null;

  // Phase 8 subsystems (ACP, Structured Logging, Shared State)
  public structuredLogger: StructuredLogger | null = null;
  public sharedStateBus: SharedStateBus | null = null;
  public acpBus: ACPBus | null = null;

  // Phase 11: Embedder + RAG Index for vector-powered routing
  public embedder: Embedder | null = null;
  public ragIndex: RAGIndex | null = null;

  // Phase 13: Extensible Tiers — Forge, Sentinel, TierRegistry
  public tierRegistry: TierRegistry;
  public forge: AgentForge | null = null;
  public sentinel: SystemSentinel | null = null;

  // Phase 9: Settings
  public settings: AetherSettings;
  public settingsManager: SettingsManager;

  // New subsystems: Hooks, Powers, Steering, Fallback
  public hookEventBus: EventBus | null = null;
  public hookRegistry: HookRegistry | null = null;
  public powerRegistry: PowerRegistry | null = null;
  public steeringResult: LoadSteeringResult | null = null;
  public fallbackChain: FallbackChainManager | null = null;
  public fallbackLogger: FallbackLogger | null = null;

  private rootPath: string;
  private aetherConfig: AetherConfig | null = null;
  private running = false;
  private startTime = 0;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.registry = new AgentRegistry();
    this.escalation = new EscalationManager(this.registry);
    this.config = new ConfigManager(rootPath);
    this.transports = new TransportManager();

    // Phase 13: Initialize tier registry with builtin tiers
    this.tierRegistry = TierRegistry.builtinTiers();

    // Phase 9: Load user settings (or defaults if no file yet)
    const aetherDir = join(rootPath, ".aether");
    this.settingsManager = new SettingsManager(aetherDir);
    this.settings = this.settingsManager.load();

    // Logger: write to .aether/logs (created lazily by logger itself)
    const logDir = join(rootPath, ".aether", "logs");
    this.logger = new SynapseLogger(logDir, this.settings.logging.level);
  }

  // ───────────────── Lifecycle ─────────────────

  /**
   * Initialize the runtime:
   *  1. Load or create config
   *  2. Initialize providers
   *  3. Discover agents
   */
  async init(): Promise<void> {
    this.logger.info("Runtime", "Initializing AETHER runtime...");

    // Initialize persistent store
    try {
      const aetherDir = join(this.rootPath, ".aether");
      const sqliteStore = new SQLiteStore(aetherDir);
      await sqliteStore.init();
      this.store = sqliteStore;
      this.logger.info(
        "Runtime",
        `SQLite store initialized at ${aetherDir}/aether.db`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        "Runtime",
        `Store init failed (running in-memory only): ${msg}`,
      );
      this.store = null;
    }

    // Reload settings (init may have created them via config.init)
    this.settings = this.settingsManager.load();

    // Re-create registry and escalation with store backing + settings
    if (this.store) {
      this.registry = new AgentRegistry(this.store);
      this.escalation = new EscalationManager(this.registry, {
        threshold: this.settings.escalation.threshold,
        windowMs: this.settings.escalation.windowMs,
        store: this.store,
      });
    }

    // Load existing config or scan + init
    if (this.config.isInitialized()) {
      this.aetherConfig = await this.config.load();
    }

    if (!this.aetherConfig) {
      this.logger.info("Runtime", "No existing config — scanning workspace");
      const profile = await WorkspaceScanner.scan(this.rootPath);
      this.aetherConfig = await this.config.init(profile);
    }

    // Initialize provider manager — detect available providers from env vars
    // and rebuild tier mapping if the saved config references unconfigured providers
    try {
      const detected = await ProviderManager.detectProviders();

      // Normalize config: support both flat {master,manager,worker} and nested {tiers:{...}}
      const rawProviders = this.aetherConfig.providers as any;
      const normalizedConfig: import("./types.ts").ProviderConfig =
        rawProviders.tiers
          ? rawProviders
          : {
              tiers: {
                ...(rawProviders.master && { master: rawProviders.master }),
                ...(rawProviders.manager && { manager: rawProviders.manager }),
                ...(rawProviders.worker && { worker: rawProviders.worker }),
                ...(rawProviders.sentinel && { sentinel: rawProviders.sentinel }),
                ...(rawProviders.forge && { forge: rawProviders.forge }),
              },
              fallbackChain: rawProviders.fallbackChain ?? [],
              apiKeys: rawProviders.apiKeys,
            };
      // Write back normalized form so downstream code always sees {tiers, fallbackChain}
      this.aetherConfig.providers = normalizedConfig;

      // Providers with explicit apiKeys in config are always considered available
      if (normalizedConfig.apiKeys) {
        for (const provider of Object.keys(normalizedConfig.apiKeys) as LLMProvider[]) {
          if (normalizedConfig.apiKeys[provider] && !detected.includes(provider)) {
            detected.push(provider);
          }
        }
      }

      const savedPrimary =
        normalizedConfig.tiers?.master?.provider ??
        normalizedConfig.tiers?.[
          Object.keys(normalizedConfig.tiers ?? {})[0]
        ]?.provider;
      const primaryAvailable = detected.includes(savedPrimary as LLMProvider);

      if (primaryAvailable) {
        // Saved config matches an available provider — use it
        this.providers = new ProviderManager(normalizedConfig);
      } else if (detected.length > 0) {
        // Saved config doesn't match — rebuild from detected providers
        const providerConfig = AetherRuntime.buildProviderConfig(detected);
        this.providers = new ProviderManager(providerConfig);
        this.logger.info(
          "Runtime",
          `Re-mapped providers from detected: ${detected.join(", ")}`,
        );
      } else {
        // No providers detected — use saved config (will fail at call time)
        this.providers = new ProviderManager(normalizedConfig);
      }

      this.logger.info(
        "Runtime",
        `Providers initialized. Available: ${this.providers.getAvailableProviders().join(", ") || "none"}`,
      );

      // Attach FallbackChainManager to ProviderManager (wired later in init)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `Provider init warning: ${msg}`);
      this.providers = new ProviderManager();
    }

    // Discover agents — use smart sync (mtime-based) when store is available
    const agentDirs = [
      join(this.rootPath, ".github", "agents"),
      join(this.rootPath, ".aether", "agents"),
      join(this.rootPath, "agents"),
    ];

    if (this.store) {
      await this.smartSyncAgents(agentDirs);
    } else {
      for (const dir of agentDirs) {
        if (existsSync(dir)) {
          const agents = await this.discoverAgents(dir);
          this.logger.info(
            "Runtime",
            `Discovered ${agents.length} agents in ${dir}`,
          );
        }
      }
    }

    // Load persisted escalation records now that agents are registered
    if (this.store) {
      try {
        this.escalation.loadFromStore();
        this.logger.info("Runtime", "Escalation records loaded from store");
      } catch {
        // Non-fatal — fresh start
      }
    }

    // ── Initialize Phase 11 subsystems (Embedder + RAG Index) ──
    if (this.store) {
      try {
        this.embedder = new Embedder(this.logger);
        this.ragIndex = new RAGIndex(
          this.embedder,
          this.logger,
          {},
          this.store,
        );
        await this.ragIndex.initialize();
        this.logger.info("Runtime", "Embedder + RAGIndex initialized");

        // Index all registered agents for vector-powered routing
        const allAgents = this.registry.getAll();
        let indexed = 0;
        for (const agent of allAgents) {
          try {
            await this.ragIndex.indexAgent(agent);
            indexed++;
          } catch {
            // Best-effort — don't block startup for individual agent indexing
          }
        }
        if (indexed > 0) {
          this.logger.info(
            "Runtime",
            `Indexed ${indexed}/${allAgents.length} agents into RAGIndex`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn("Runtime", `Embedder/RAGIndex init warning: ${msg}`);
        this.embedder = null;
        this.ragIndex = null;
      }
    }

    // ── Initialize Phase 3 subsystems (Supercharge) ──────────
    try {
      this.guardrails = createDefaultGuardrails();
      this.schemaValidator = new SchemaValidator();
      this.pluginRegistry = new PluginRegistry(this.rootPath);
      this.logger.info(
        "Runtime",
        "Guardrails, SchemaValidator, PluginRegistry initialized",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `Non-store subsystem init warning: ${msg}`);
    }

    if (this.store) {
      try {
        this.agentRouter = new AgentRouter(
          this.store,
          this.settings.routing.confidenceThreshold,
          this.ragIndex,
        );
        this.agentRouter.configureContexts({
          activeContext: this.settings.routing.activeContext,
          contexts: this.settings.routing.contexts,
          contextFallback: this.settings.routing.contextFallback,
        });
        this.agentRouter.configureCache(this.settings.routing.cache);
        this.entityMemory = new EntityMemory(this.store);
        this.conversationManager = new ConversationManager(
          this.store,
          this.settings.conversation.maxMessages,
        );
        this.progressTracker = new ProgressTracker(
          this.store,
          this.settings.progress,
        );
        this.handoffManager = new HandoffManager(
          this.store,
          this.settings.handoff.maxChainLength,
        );
        this.logger.info(
          "Runtime",
          "Router, EntityMemory, ConversationManager, ProgressTracker, HandoffManager initialized",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          "Runtime",
          `Store-backed subsystem init warning: ${msg}`,
        );
      }

      // Check for incomplete durable workflows from previous runs
      try {
        const incomplete = DurableWorkflow.findIncomplete(this.store);
        if (incomplete.length > 0) {
          this.logger.info(
            "Runtime",
            `Found ${incomplete.length} incomplete durable workflow(s): ${incomplete.join(", ")}`,
          );
        }
      } catch {
        // Non-fatal — no recovery needed if check fails
      }
    }

    // ── Initialize Phase 8 subsystems (ACP, Structured Logging, Shared State) ──
    try {
      this.structuredLogger = new StructuredLogger(this.logger, {
        auditLogPath: join(this.rootPath, ".aether", "logs", "audit.jsonl"),
        structuredLogPath: join(
          this.rootPath,
          ".aether",
          "logs",
          "structured.jsonl",
        ),
        maxRetainedEntries: this.settings.logging.maxRetainedEntries,
        forwardToSynapse: this.settings.logging.forwardToSynapse,
      });
      this.logger.info("Runtime", "StructuredLogger initialized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `StructuredLogger init warning: ${msg}`);
    }

    // Start periodic InteractionNet checkpoint (every 30s)
    this.checkpointTimer = setInterval(() => {
      // checkpoint is best-effort, fire-and-forget
    }, 30_000);

    // ── Phase 13: Initialize Forge + Sentinel ──
    try {
      const agentsDir = join(this.rootPath, "agents");
      if (this.store) {
        this.forge = new AgentForge(
          this.registry,
          this.tierRegistry,
          this.store,
          this.logger,
          agentsDir,
        );
        this.logger.info("Runtime", "AgentForge initialized");
      }

      this.sentinel = new SystemSentinel(
        this.registry,
        this.tierRegistry,
        this.logger,
      );
      this.logger.info("Runtime", "SystemSentinel initialized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `Forge/Sentinel init warning: ${msg}`);
    }

    // ── Initialize new subsystems: Hooks, Powers, Steering, Fallback ──
    try {
      this.hookEventBus = new EventBus();
      this.hookRegistry = new HookRegistry(this.hookEventBus);
      const hooksDir = join(this.rootPath, ".aether", "hooks");
      if (existsSync(hooksDir)) {
        await this.hookRegistry.loadFromDirectory(hooksDir);
      }
      this.logger.info("Runtime", "HookRegistry initialized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `HookRegistry init warning: ${msg}`);
    }

    try {
      this.powerRegistry = new PowerRegistry();
      const powersDir = join(this.rootPath, ".aether", "powers");
      if (existsSync(powersDir)) {
        await this.powerRegistry.loadInstalled(powersDir);
      }
      this.logger.info("Runtime", "PowerRegistry initialized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `PowerRegistry init warning: ${msg}`);
    }

    try {
      this.steeringResult = loadSteering(this.rootPath);
      this.logger.info("Runtime", `Steering loaded: ${this.steeringResult.files.length} files (${this.steeringResult.source})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `Steering init warning: ${msg}`);
    }

    try {
      this.fallbackLogger = new FallbackLogger();
      this.fallbackChain = new FallbackChainManager({
        chains: {
          master:  ["claude-opus-4-6",  "gpt-4o",      "gemini-2.5-pro"],
          manager: ["claude-sonnet-4",  "gpt-4o-mini",  "llama3.1:70b"],
          worker:  ["claude-haiku",     "gpt-4o-mini",  "local"],
        },
      });
      this.logger.info("Runtime", "FallbackChainManager initialized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn("Runtime", `FallbackChainManager init warning: ${msg}`);
    }

    // Wire fallback chain into provider manager
    if (this.fallbackChain && this.providers) {
      this.providers.setFallbackChain(this.fallbackChain);
    }

    this.running = true;
    this.startTime = Date.now();
    this.logger.info("Runtime", "AETHER runtime started");
  }

  /**
   * Start the Aether-Link WebSocket server.
   */
  async startServer(): Promise<void> {
    if (this.server) {
      this.logger.warn(
        "Runtime",
        "Server already running — ignoring start request",
      );
      return;
    }

    const port = this.settings.server.port;
    const logDir = join(this.rootPath, ".aether", "logs");

    this.server = new AetherLinkServer(port, logDir);
    await this.server.start();

    this.logger.info("Runtime", `Aether-Link server started on port ${port}`);
  }

  /**
   * Gracefully stop everything: server, logger, timers.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Runtime", "Shutting down AETHER runtime...");

    // Stop checkpoint timer
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    if (this.server) {
      await this.server.stop();
      this.server = null;
    }

    // Tear down Phase 3 subsystems (Supercharge)
    if (this.reactionEngine) {
      try {
        this.reactionEngine.stop();
      } catch {
        // Best-effort
      }
      this.reactionEngine = null;
    }

    if (this.pluginRegistry) {
      try {
        await this.pluginRegistry.destroyAll();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn("Runtime", `Plugin cleanup warning: ${msg}`);
      }
      this.pluginRegistry = null;
    }

    this.guardrails = null;
    this.agentRouter = null;
    this.entityMemory = null;
    this.conversationManager = null;
    this.progressTracker = null;
    this.handoffManager = null;
    this.schemaValidator = null;

    // Tear down Phase 8 subsystems (ACP, Structured Logging, Shared State)
    if (this.acpBus) {
      try {
        this.acpBus.stop();
      } catch {
        // Best-effort
      }
      this.acpBus = null;
    }

    if (this.sharedStateBus) {
      try {
        this.sharedStateBus.stop();
      } catch {
        // Best-effort
      }
      this.sharedStateBus = null;
    }

    if (this.structuredLogger) {
      try {
        await this.structuredLogger.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn("Runtime", `StructuredLogger close warning: ${msg}`);
      }
      this.structuredLogger = null;
    }

    // Tear down new subsystems
    this.hookEventBus = null;
    this.hookRegistry = null;
    this.powerRegistry = null;
    this.steeringResult = null;
    this.fallbackChain = null;
    this.fallbackLogger = null;

    // Close persistent store (flushes WAL)
    if (this.store) {
      try {
        await this.store.close();
        this.logger.info("Runtime", "Store closed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn("Runtime", `Store close warning: ${msg}`);
      }
      this.store = null;
    }

    await this.logger.close();

    this.running = false;
  }

  // ───────────────── Task Execution ─────────────────

  /**
   * Run a task end-to-end: resolve agent → call LLM → return result.
   * This is the primary entry point for `aether run "task"`.
   */
  async run(
    taskDescription: string,
    options?: { agent?: string; provider?: LLMProvider; model?: string },
  ): Promise<TaskResult> {
    // Auto-init if not already running
    if (!this.running) {
      await this.init();
    }

    if (!this.providers) {
      throw new Error(
        "No LLM providers available. Set an API key (e.g. GOOGLE_AI_KEY) and try again.",
      );
    }

    // Create executor with settings-driven options
    const executor = new AgentExecutor(
      this.registry,
      this.escalation,
      this.logger,
      this.providers,
      this.transports,
      {
        maxDepth: this.settings.execution.maxDepth,
        defaultTimeout: this.settings.execution.defaultTimeoutMs,
        maxTokens: this.settings.execution.maxTokens,
        temperature: this.settings.execution.temperature,
        enableEscalation: this.settings.execution.enableEscalation,
        enableSubTasks: this.settings.execution.enableSubTasks,
        useInteractionNet: this.settings.execution.useInteractionNet,
        useRAGContext: this.settings.execution.useRAGContext,
        ragTopK: this.settings.execution.ragTopK,
        useMemoryHighway: this.settings.execution.useMemoryHighway,
      },
    );

    // Wire persistent store into executor
    if (this.store) {
      executor.setStore(this.store);
    }

    // Wire Phase 3 subsystems into executor
    executor.setSubsystems({
      ...(this.guardrails ? { guardrails: this.guardrails } : {}),
      ...(this.agentRouter ? { router: this.agentRouter } : {}),
      ...(this.entityMemory ? { entityMemory: this.entityMemory } : {}),
      ...(this.conversationManager
        ? { conversationManager: this.conversationManager }
        : {}),
      ...(this.progressTracker
        ? { progressTracker: this.progressTracker }
        : {}),
      ...(this.handoffManager ? { handoffManager: this.handoffManager } : {}),
      ...(this.pluginRegistry ? { pluginRegistry: this.pluginRegistry } : {}),
      ...(this.schemaValidator
        ? { schemaValidator: this.schemaValidator }
        : {}),
      // Phase 8 subsystems
      ...(this.acpBus ? { acpBus: this.acpBus } : {}),
      ...(this.structuredLogger
        ? { structuredLogger: this.structuredLogger }
        : {}),
      ...(this.sharedStateBus ? { sharedState: this.sharedStateBus } : {}),
      // Steering files
      ...(this.steeringResult?.files?.length ? { steeringFiles: this.steeringResult.files } : {}),
    });

    // Resolve target agent
    let targetId = options?.agent;
    if (!targetId) {
      // Try to find the general-purpose worker
      const general = this.registry.resolve("general");
      if (general) {
        targetId = general.id;
      } else {
        // Fall back to any available worker, then cortex-0
        const anyWorker = this.registry.findByTier("worker")[0];
        targetId = anyWorker?.id ?? "cortex-0";
      }
    }

    // Build TaskRequest
    const task: TaskRequest = {
      id: crypto.randomUUID(),
      description: taskDescription,
      requester: "cli",
      target: targetId,
      priority: 3,
      context: {},
    };

    // Attach provider/model overrides if specified
    if (options?.provider || options?.model) {
      task.overrides = {};
      if (options.provider) task.overrides.provider = options.provider;
      if (options.model) task.overrides.model = options.model;
    }

    return executor.execute(task);
  }

  // ───────────────── Agent Management ─────────────────

  /**
   * Parse a .agent.md file and register the agent it defines.
   *
   * Supported metadata formats:
   *  - YAML frontmatter between `---` markers
   *  - Key-value lines like `id: some-id`
   *  - XML tags like `<agent_id>some-id</agent_id>`
   *  - Fallback: infer from filename and directory
   */
  async registerAgentFromFile(filePath: string): Promise<AgentDefinition> {
    const content = await Bun.file(filePath).text();
    const fileName = basename(filePath, ".agent.md");

    // Attempt to extract structured metadata
    const meta = AetherRuntime.parseAgentMetadata(content, fileName, filePath);

    // Register in the registry
    this.registry.register(meta);
    this.logger.info(
      "Runtime",
      `Registered agent "${meta.id}" (${meta.tier}) from ${filePath}`,
    );

    // Index into RAGIndex for vector-powered routing (best-effort)
    if (this.ragIndex) {
      try {
        await this.ragIndex.indexAgent(meta);
      } catch {
        // Non-fatal — agent still works without vector index
      }
    }

    return meta;
  }

  /**
   * Recursively discover all *.agent.md files in a directory
   * and register each one.
   */
  async discoverAgents(agentDir: string): Promise<AgentDefinition[]> {
    const agents: AgentDefinition[] = [];

    if (!existsSync(agentDir)) return agents;

    const agentFiles = AetherRuntime.findFilesRecursive(agentDir, ".agent.md");

    for (const file of agentFiles) {
      try {
        const agent = await this.registerAgentFromFile(file);
        agents.push(agent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          "Runtime",
          `Failed to register agent from ${file}: ${msg}`,
        );
      }
    }

    return agents;
  }

  /**
   * Smart agent sync: load agents from store first, then only re-parse
   * .agent.md files whose mtime has changed since last sync.
   * Removes agents whose files no longer exist on disk.
   */
  async smartSyncAgents(agentDirs: string[]): Promise<void> {
    if (!this.store) {
      throw new Error("smartSyncAgents requires a persistent store");
    }

    // Step 1: Load all agents from store into registry (fast, no disk I/O per file)
    try {
      await this.registry.loadFromStore();
      this.logger.info(
        "Runtime",
        `Loaded ${this.registry.getAll().length} agents from store`,
      );
    } catch {
      // Empty store — fresh start
    }

    // Step 2: Collect all .agent.md files from disk
    const diskFiles = new Map<string, number>(); // filePath → mtime
    for (const dir of agentDirs) {
      if (!existsSync(dir)) continue;
      const files = AetherRuntime.findFilesRecursive(dir, ".agent.md");
      for (const file of files) {
        try {
          const stat = statSync(file);
          diskFiles.set(file, stat.mtimeMs);
        } catch {
          // Skip inaccessible files
        }
      }
    }

    // Step 3: Get stored mtimes
    const storedMtimes = this.store.getAllAgentFileMtimes();
    const storedByPath = new Map<string, { id: string; mtime: number }>();
    for (const entry of storedMtimes) {
      storedByPath.set(entry.filePath, { id: entry.id, mtime: entry.mtime });
    }

    // Step 4: Determine which files need re-parsing
    let reloaded = 0;
    let unchanged = 0;
    let removed = 0;

    for (const [filePath, diskMtime] of diskFiles) {
      const stored = storedByPath.get(filePath);

      if (stored && Math.abs(stored.mtime - diskMtime) < 1) {
        // File unchanged — already loaded from store
        unchanged++;
        continue;
      }

      // File is new or changed — re-parse
      try {
        // Remove old version if it exists (by file path match)
        if (stored) {
          this.registry.unregister(stored.id);
        }

        const agent = await this.registerAgentFromFile(filePath);
        // Save with mtime for future sync
        this.store.saveAgentWithMtime(agent, diskMtime);
        reloaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          "Runtime",
          `Failed to sync agent from ${filePath}: ${msg}`,
        );
      }
    }

    // Step 5: Remove agents whose files no longer exist on disk
    for (const [filePath, stored] of storedByPath) {
      if (!diskFiles.has(filePath)) {
        this.registry.unregister(stored.id);
        this.store.deleteAgent(stored.id);
        removed++;
      }
    }

    this.logger.info(
      "Runtime",
      `Smart sync: ${unchanged} unchanged, ${reloaded} reloaded, ${removed} removed`,
    );
  }

  /**
   * Send a prompt to a specific agent, routing through the
   * appropriate LLM provider for its tier.
   */
  async executeAgentTask(agentId: string, prompt: string): Promise<string> {
    const agent = this.registry.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found in registry`);
    }

    if (!this.providers) {
      throw new Error("No LLM providers configured");
    }

    // Mark agent as busy
    this.registry.updateStatus(agentId, "busy");

    try {
      const response = await this.providers.sendForTier(agent.tier, prompt);
      this.registry.updateStatus(agentId, "idle");
      return typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    } catch (err) {
      this.registry.updateStatus(agentId, "error");
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("Runtime", `Agent "${agentId}" task failed: ${msg}`);
      throw err;
    }
  }

  // ───────────────── Status & Introspection ─────────────────

  /**
   * Get a snapshot of the current runtime state.
   */
  getStatus(): {
    running: boolean;
    uptime: number;
    agents: {
      total: number;
      byTier: Record<string, number>;
      byStatus: Record<string, number>;
    };
    server: { active: boolean; port: number | null; connectedAgents: number };
    providers: {
      available: string[];
      usage: { input: number; output: number };
    };
    config: { initialized: boolean; version: string | null };
    store: { active: boolean; dbSizeBytes: number };
  } {
    const allAgents = this.registry.getAll();

    // Count by tier (dynamically — not hardcoded)
    const byTier: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const a of allAgents) {
      byTier[a.tier] = (byTier[a.tier] ?? 0) + 1;
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    }

    // Server info
    let serverConnected = 0;
    let serverPort: number | null = null;
    if (this.server) {
      const metrics = this.server.getMetrics();
      serverConnected = metrics.connectedAgents;
      serverPort = this.aetherConfig?.server?.port ?? 9999;
    }

    // Provider info
    const availableProviders = this.providers?.getAvailableProviders() ?? [];
    const usage = this.providers?.getTotalUsage() ?? { input: 0, output: 0 };

    return {
      running: this.running,
      uptime: this.getUptime(),
      agents: {
        total: allAgents.length,
        byTier,
        byStatus,
      },
      server: {
        active: this.server !== null,
        port: serverPort,
        connectedAgents: serverConnected,
      },
      providers: {
        available: availableProviders,
        usage,
      },
      config: {
        initialized: this.config.isInitialized(),
        version: this.aetherConfig?.version ?? null,
      },
      store: {
        active: this.store !== null,
        dbSizeBytes:
          this.store && "getDBSizeBytes" in this.store
            ? (
                this.store as import("./storage/sqlite-store.ts").SQLiteStore
              ).getDBSizeBytes()
            : 0,
      },
    };
  }

  /**
   * Get uptime in milliseconds (0 if not running).
   */
  getUptime(): number {
    return this.running ? Date.now() - this.startTime : 0;
  }

  // ───────────────── Static Helpers ─────────────────

  /**
   * Parse agent metadata from a .agent.md file's content.
   * Tries multiple formats: YAML frontmatter, key-value lines, XML tags.
   */
  static parseAgentMetadata(
    content: string,
    fallbackName: string,
    filePath: string,
  ): AgentDefinition {
    let id = fallbackName;
    let name = fallbackName
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    let tier: AgentTier = "worker";
    let sections: RegistrySection[] = [];
    let capabilities: string[] = [];
    let dependencies: string[] = [];
    let llmRequirement: LLMModelTier = "haiku";
    let format: AgentFormat = "markdown";
    let escalationTarget: string | null = null;
    const metadata: Record<string, unknown> = {};

    // ── Strategy 1: YAML frontmatter ───────────────────────
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatterMatch) {
      const fmBlock = frontmatterMatch[1];
      const parsed = AetherRuntime.parseSimpleYaml(fmBlock);

      if (parsed.id) id = String(parsed.id);
      if (parsed.name) name = String(parsed.name);
      if (parsed.tier) tier = String(parsed.tier) as AgentTier;
      if (parsed.sections)
        sections = AetherRuntime.toStringArray(
          parsed.sections,
        ) as RegistrySection[];
      if (parsed.capabilities)
        capabilities = AetherRuntime.toStringArray(parsed.capabilities);
      if (parsed.dependencies)
        dependencies = AetherRuntime.toStringArray(parsed.dependencies);
      if (parsed.llmRequirement || parsed.llm_requirement || parsed.model)
        llmRequirement = String(
          parsed.llmRequirement ?? parsed.llm_requirement ?? parsed.model,
        ) as LLMModelTier;
      if (parsed.format) format = String(parsed.format) as AgentFormat;
      if (parsed.escalationTarget || parsed.escalation_target)
        escalationTarget = String(
          parsed.escalationTarget ?? parsed.escalation_target,
        );

      // Parse transport config if present
      const transport = AetherRuntime.parseTransportFromYaml(fmBlock);

      return {
        id,
        name,
        tier,
        sections,
        capabilities,
        dependencies,
        llmRequirement,
        format,
        escalationTarget,
        filePath,
        status: "idle",
        ...(transport ? { transport } : {}),
        metadata,
      };
    }

    // ── Strategy 2: Key-value lines ────────────────────────
    // Match lines like `id: some-value` or `tier: worker`
    const kvPatterns: [string, string][] = [
      ["id", "id"],
      ["name", "name"],
      ["tier", "tier"],
      ["format", "format"],
      ["llmRequirement", "llmRequirement"],
      ["llm_requirement", "llmRequirement"],
      ["model", "llmRequirement"],
      ["escalationTarget", "escalationTarget"],
      ["escalation_target", "escalationTarget"],
    ];

    let kvFound = false;
    const kvValues: Record<string, string> = {};

    for (const [key] of kvPatterns) {
      const regex = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im");
      const match = content.match(regex);
      if (match) {
        kvValues[key] = match[1].trim();
        kvFound = true;
      }
    }

    // Array-style key-value
    const arrayKvPatterns: [string, string][] = [
      ["sections", "sections"],
      ["capabilities", "capabilities"],
      ["dependencies", "dependencies"],
    ];

    for (const [key] of arrayKvPatterns) {
      const regex = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im");
      const match = content.match(regex);
      if (match) {
        kvValues[key] = match[1].trim();
        kvFound = true;
      }
    }

    if (kvFound) {
      if (kvValues.id) id = kvValues.id;
      if (kvValues.name) name = kvValues.name;
      if (kvValues.tier) tier = kvValues.tier as AgentTier;
      if (kvValues.format) format = kvValues.format as AgentFormat;
      if (kvValues.llmRequirement || kvValues.llm_requirement || kvValues.model)
        llmRequirement = (kvValues.llmRequirement ??
          kvValues.llm_requirement ??
          kvValues.model) as LLMModelTier;
      if (kvValues.escalationTarget || kvValues.escalation_target)
        escalationTarget =
          kvValues.escalationTarget ?? kvValues.escalation_target ?? null;
      if (kvValues.sections)
        sections = AetherRuntime.parseCSV(
          kvValues.sections,
        ) as RegistrySection[];
      if (kvValues.capabilities)
        capabilities = AetherRuntime.parseCSV(kvValues.capabilities);
      if (kvValues.dependencies)
        dependencies = AetherRuntime.parseCSV(kvValues.dependencies);

      return {
        id,
        name,
        tier,
        sections,
        capabilities,
        dependencies,
        llmRequirement,
        format,
        escalationTarget,
        filePath,
        status: "idle",
        metadata,
      };
    }

    // ── Strategy 3: XML tags ───────────────────────────────
    const xmlMap: [string, string][] = [
      ["agent_id", "id"],
      ["agent_name", "name"],
      ["tier", "tier"],
      ["format", "format"],
      ["llm_requirement", "llmRequirement"],
      ["escalation_target", "escalationTarget"],
    ];

    let xmlFound = false;
    const xmlValues: Record<string, string> = {};

    for (const [tag, field] of xmlMap) {
      const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, "i");
      const match = content.match(regex);
      if (match) {
        xmlValues[field] = match[1].trim();
        xmlFound = true;
      }
    }

    // XML array tags
    const xmlArrayTags: [string, string][] = [
      ["sections", "sections"],
      ["capabilities", "capabilities"],
      ["dependencies", "dependencies"],
    ];

    for (const [tag, field] of xmlArrayTags) {
      const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, "i");
      const match = content.match(regex);
      if (match) {
        xmlValues[field] = match[1].trim();
        xmlFound = true;
      }
    }

    if (xmlFound) {
      if (xmlValues.id) id = xmlValues.id;
      if (xmlValues.name) name = xmlValues.name;
      if (xmlValues.tier) tier = xmlValues.tier as AgentTier;
      if (xmlValues.format) format = xmlValues.format as AgentFormat;
      if (xmlValues.llmRequirement)
        llmRequirement = xmlValues.llmRequirement as LLMModelTier;
      if (xmlValues.escalationTarget)
        escalationTarget = xmlValues.escalationTarget;
      if (xmlValues.sections)
        sections = AetherRuntime.parseCSV(
          xmlValues.sections,
        ) as RegistrySection[];
      if (xmlValues.capabilities)
        capabilities = AetherRuntime.parseCSV(xmlValues.capabilities);
      if (xmlValues.dependencies)
        dependencies = AetherRuntime.parseCSV(xmlValues.dependencies);

      return {
        id,
        name,
        tier,
        sections,
        capabilities,
        dependencies,
        llmRequirement,
        format,
        escalationTarget,
        filePath,
        status: "idle",
        metadata,
      };
    }

    // ── Strategy 4: Infer from filename / directory ────────
    // e.g. agents/frontend/react-specialist.agent.md → section=FRONTEND
    const dirName = basename(join(filePath, "..")).toUpperCase();
    const sectionGuess = [
      "TOOLS",
      "MCP_SERVER",
      "SKILL",
      "WORKFLOW",
      "RESEARCH",
      "FRONTEND",
      "BACKEND",
      "MARKETING",
      "AUDIT",
      "META",
    ];
    if (sectionGuess.includes(dirName)) {
      sections = [dirName as RegistrySection];
    }

    // Infer capabilities from filename
    capabilities = [fallbackName.replace(/-/g, " ")];

    return {
      id,
      name,
      tier,
      sections,
      capabilities,
      dependencies,
      llmRequirement,
      format,
      escalationTarget,
      filePath,
      status: "idle",
      metadata,
    };
  }

  /**
   * Recursively find all files ending with a given suffix.
   */
  static findFilesRecursive(dir: string, suffix: string): string[] {
    const results: string[] = [];

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return results;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(...AetherRuntime.findFilesRecursive(full, suffix));
        } else if (entry.endsWith(suffix)) {
          results.push(full);
        }
      } catch {
        // Skip inaccessible entries
      }
    }

    return results;
  }

  /**
   * Minimal YAML-like parser for frontmatter blocks.
   * Handles simple `key: value` and `key: [a, b, c]` patterns.
   */
  private static parseSimpleYaml(
    block: string,
  ): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    const lines = block.split(/\r?\n/);

    let currentKey = "";
    let collectingList = false;

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("#")) continue;

      // Check for list item (indented `- value`)
      const listItemMatch = line.match(/^\s+-\s+(.+)$/);
      if (listItemMatch && collectingList && currentKey) {
        const arr = result[currentKey];
        if (Array.isArray(arr)) {
          arr.push(listItemMatch[1].trim());
        }
        continue;
      }

      // End any ongoing list collection if we hit a non-list line
      collectingList = false;

      // Key-value pair
      const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        let value = kvMatch[2].trim();

        // Inline array: [a, b, c]
        if (value.startsWith("[") && value.endsWith("]")) {
          const inner = value.slice(1, -1);
          result[key] = inner
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else if (value === "" || value === "|" || value === ">") {
          // Start of list on next lines
          currentKey = key;
          collectingList = true;
          result[key] = [];
        } else {
          // Strip surrounding quotes
          result[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    }

    return result;
  }

  /**
   * Convert a value to a string array.
   * Handles: string (CSV split), string[], or single-value wrap.
   */
  private static toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") return AetherRuntime.parseCSV(val);
    return [];
  }

  /**
   * Parse a comma-separated (or bracket-wrapped) string into an array.
   */
  private static parseCSV(val: string): string[] {
    let cleaned = val.trim();
    if (cleaned.startsWith("[")) cleaned = cleaned.slice(1);
    if (cleaned.endsWith("]")) cleaned = cleaned.slice(0, -1);
    return cleaned
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  /**
   * Parse transport configuration from YAML frontmatter block.
   * Looks for a `transport:` block with indented sub-keys.
   */
  static parseTransportFromYaml(yamlBlock: string): TransportConfig | null {
    // Check if there's a transport: line
    const transportMatch = yamlBlock.match(/^\s*transport:\s*$/m);
    if (!transportMatch) return null;

    // Find the transport block: everything indented after "transport:"
    const lines = yamlBlock.split(/\r?\n/);
    const transportIdx = lines.findIndex((l) => /^\s*transport:\s*$/.test(l));
    if (transportIdx === -1) return null;

    // Collect indented lines under transport:
    const transportLines: string[] = [];
    for (let i = transportIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.match(/^\s+\S/)) {
        if (line.trim()) transportLines.push(line);
      } else {
        break; // Hit a non-indented line
      }
    }

    // Parse the transport sub-keys
    const config: Record<string, unknown> = {};
    const nestedBlocks: Record<string, Record<string, unknown>> = {};
    let currentNested = "";

    for (const line of transportLines) {
      // Check for nested block (double indent)
      const nestedMatch = line.match(/^\s{4,}(\w[\w_.]*):\s*(.*)$/);
      if (nestedMatch && currentNested) {
        nestedBlocks[currentNested] = nestedBlocks[currentNested] || {};
        let val: unknown = nestedMatch[2].trim().replace(/^["']|["']$/g, "");
        // Try to parse numbers
        if (/^\d+$/.test(val as string)) val = parseInt(val as string, 10);
        // Parse booleans
        if (val === "true") val = true;
        if (val === "false") val = false;
        nestedBlocks[currentNested][nestedMatch[1]] = val;
        continue;
      }

      // Top-level transport key
      const kvMatch = line.match(/^\s{2}(\w[\w_]*):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        let value: unknown = kvMatch[2].trim();

        if (value === "" || value === "|") {
          // This is a nested block
          currentNested = key;
          continue;
        }

        currentNested = "";

        // Handle inline arrays
        if (typeof value === "string" && (value as string).startsWith("[")) {
          value = AetherRuntime.parseCSV(value as string);
        } else {
          // Strip quotes
          value = (value as string).replace(/^["']|["']$/g, "");
          // Parse numbers
          if (/^\d+$/.test(value as string))
            value = parseInt(value as string, 10);
          // Parse booleans
          if (value === "true") value = true;
          if (value === "false") value = false;
          if (value === "null") value = null;
        }

        config[key] = value;
      }
    }

    // Merge nested blocks
    for (const [key, block] of Object.entries(nestedBlocks)) {
      config[key] = block;
    }

    // Build the TransportConfig based on type
    const transportType = config.type as string;
    if (!transportType) return null;

    // Rename "type" to "transport" (TransportConfig uses "transport" discriminator)
    config.transport = transportType;
    delete config.type;

    return config as unknown as TransportConfig;
  }

  /**
   * Build a ProviderConfig from a list of detected providers.
   * Maps the first detected provider to all tiers, using appropriate
   * model defaults per provider.
   */
  static buildProviderConfig(
    detected: LLMProvider[],
  ): import("./types.ts").ProviderConfig {
    // Model defaults per provider — best balance of quality/cost per tier
    const modelDefaults: Record<string, Record<string, string>> = {
      claude: {
        sentinel: "opus",
        forge: "opus",
        master: "opus",
        manager: "sonnet",
        worker: "haiku",
      },
      openai: {
        sentinel: "gpt4o",
        forge: "gpt4o",
        master: "gpt4o",
        manager: "gpt4o",
        worker: "gpt4o-mini",
      },
      gemini: {
        sentinel: "gemini-pro",
        forge: "gemini-pro",
        master: "gemini-pro",
        manager: "gemini-pro",
        worker: "gemini-flash",
      },
      ollama: {
        sentinel: "local",
        forge: "local",
        master: "local",
        manager: "local",
        worker: "local",
      },
      copilot: {
        sentinel: "gpt-4o",
        forge: "gpt-4o",
        master: "gpt-4o",
        manager: "gpt-4o",
        worker: "gpt-4o-mini",
      },
      lmstudio: {
        sentinel: "local",
        forge: "local",
        master: "local",
        manager: "local",
        worker: "local",
      },
    };

    const primary = detected[0];
    const models = modelDefaults[primary] ?? modelDefaults.ollama;

    // Build fallback chain from remaining detected providers + always include ollama
    const fallbackProviders = detected.filter((p) => p !== primary);
    if (!fallbackProviders.includes("ollama") && !detected.includes("ollama")) {
      // Don't add ollama to fallback if it wasn't detected
    }
    const fallbackChain = fallbackProviders.map((p) => ({
      provider: p,
      model: (modelDefaults[p] ?? modelDefaults.ollama).worker,
    }));

    // Build tiers record from model defaults
    const tiers: Record<string, { provider: LLMProvider; model: string }> = {};
    for (const [tierName, model] of Object.entries(models)) {
      tiers[tierName] = { provider: primary, model };
    }

    return {
      tiers,
      fallbackChain,
    };
  }
}
