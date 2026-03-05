// ─────────────────────────────────────────────────────────────
// AETHER Core Type System
// Central type definitions for the agent orchestration framework
// ─────────────────────────────────────────────────────────────

/** Agent hierarchy tiers — extensible string type (any registered tier name is valid) */
export type AgentTier = string;

/** Per-tier settings overrides */
export interface TierSettingsEntry {
  /** Max agents allowed in this tier */
  maxAgents?: number;
  /** Model override for this tier */
  model?: { provider: string; model: string };
  /** Whether this tier is enabled (default: true) */
  enabled?: boolean;
}

/** Supported LLM provider identifiers */
export type LLMProvider = "claude" | "openai" | "gemini" | "ollama";

/** LLM model tiers mapped to providers */
export type LLMModelTier =
  | "opus"
  | "sonnet"
  | "haiku"
  | "gpt4o"
  | "gpt4o-mini"
  | "gemini-ultra"
  | "gemini-pro"
  | "gemini-flash"
  | "local";

/** Agent output format */
export type AgentFormat = "xml" | "markdown" | "json";

/** Registry section tags — how agents are discovered */
export type RegistrySection =
  | "TOOLS"
  | "MCP_SERVER"
  | "SKILL"
  | "WORKFLOW"
  | "RESEARCH"
  | "FRONTEND"
  | "BACKEND"
  | "MARKETING"
  | "AUDIT"
  | "SECURITY"
  | "META";

/** Agent runtime status */
export type AgentStatus = "idle" | "active" | "busy" | "error" | "offline";

/** Priority levels for messages/escalations (1=lowest, 5=critical) */
export type Priority = 1 | 2 | 3 | 4 | 5;

/** Core agent definition */
export interface AgentDefinition {
  /** Unique identifier e.g. "react-specialist" */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Hierarchy tier */
  tier: AgentTier;
  /** Registry sections this agent belongs to */
  sections: RegistrySection[];
  /** What this agent can do */
  capabilities: string[];
  /** Capability strings this agent might need from others */
  dependencies: string[];
  /** Minimum LLM model tier required */
  llmRequirement: LLMModelTier;
  /** Preferred output format */
  format: AgentFormat;
  /** Agent ID to escalate to (null for master) */
  escalationTarget: string | null;
  /** Path to the .agent.md file */
  filePath: string;
  /** Current runtime status */
  status: AgentStatus;
  /** Transport config — undefined means local LLM agent (default) */
  transport?: TransportConfig;
  /** Arbitrary metadata bag */
  metadata: Record<string, unknown>;
}

/** BAP-01 protocol message types */
export type MessageType =
  | "task"
  | "result"
  | "escalation"
  | "broadcast"
  | "heartbeat"
  | "register"
  | "query";

/** BAP-01 Message envelope */
export interface AetherMessage {
  /** UUID */
  id: string;
  /** Sender agent ID */
  from: string;
  /** Recipient agent ID or "*" for broadcast */
  to: string;
  /** Message type discriminator */
  type: MessageType;
  /** Arbitrary payload */
  payload: unknown;
  /** Message priority */
  priority: Priority;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** For request-response correlation */
  correlationId?: string;
  /** Time to live in milliseconds */
  ttl?: number;
}

/** Escalation tracking record */
export interface EscalationRecord {
  /** Agent that escalated */
  agentId: string;
  /** Number of escalations within the window */
  count: number;
  /** Timestamp of last escalation (Unix ms) */
  lastEscalation: number;
  /** Reasons provided for each escalation */
  reasons: string[];
}

/** Result of workspace auto-detection */
export interface WorkspaceProfile {
  /** Detected package manager */
  packageManager: "bun" | "npm" | "pnpm" | "yarn" | "unknown";
  /** Detected frameworks e.g. ["react", "express", "tailwind"] */
  frameworks: string[];
  /** Detected languages e.g. ["typescript", "javascript"]  */
  languages: string[];
  /** Detected databases e.g. ["postgres", "redis"] */
  database: string[];
  /** Detected test frameworks e.g. ["playwright", "jest", "bun-test"] */
  testFramework: string[];
  /** Detected IDEs e.g. ["vscode", "cursor"] */
  ide: string[];
  /** LLM providers with available API keys */
  llmKeys: LLMProvider[];
  /** Absolute path to workspace root */
  rootPath: string;
}

/** LLM provider + model pairing */
export interface ProviderModelConfig {
  provider: LLMProvider;
  model: string;
}

/** Provider configuration per tier — keyed by tier name */
export interface ProviderConfig {
  tiers: Record<string, ProviderModelConfig>;
  fallbackChain: ProviderModelConfig[];
}

/** Aether project configuration — lives in .aether/config.json */
export interface AetherConfig {
  version: string;
  workspace: WorkspaceProfile;
  providers: ProviderConfig;
  server: {
    port: number;
    host: string;
    authToken?: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file: string;
  };
}

/** Development methodology mode */
export type DevelopmentMethodology = "tdd" | "sdd" | "hybrid";

/** Aether user-editable settings — lives in .aether/settings.json */
export interface AetherSettings {
  /** Development methodology */
  methodology: {
    /** "tdd" = test-driven, "sdd" = spec-driven, "hybrid" = both */
    mode: DevelopmentMethodology;
    /** For SDD: path to spec files directory (default: "specs/") */
    specDir: string;
    /** For SDD: auto-generate implementation from specs (default: true) */
    autoImplement: boolean;
    /** For TDD: auto-run tests after code generation (default: true) */
    autoTest: boolean;
    /** For TDD: test command to run (default: auto-detected from workspace) */
    testCommand: string;
  };

  /** Agent orchestration limits */
  agents: {
    /** Max concurrent active agents (default: 10) */
    maxConcurrent: number;
    /** Limits per tier — keyed by tier name */
    tiers: Record<string, TierSettingsEntry>;
    /** Default tier for new agents (default: "worker") */
    defaultTier: string;
    /** Custom tier definitions beyond builtins */
    customTiers?: import("./tier-registry.ts").TierDefinition[];
  };

  /** Executor behavior */
  execution: {
    /** Max sub-task recursion depth (default: 3) */
    maxDepth: number;
    /** Default task timeout in ms (default: 120_000) */
    defaultTimeoutMs: number;
    /** Max tokens per LLM call (default: 4096) */
    maxTokens: number;
    /** LLM temperature (default: 0.7) */
    temperature: number;
    /** Enable escalation on failure (default: true) */
    enableEscalation: boolean;
    /** Enable sub-task decomposition (default: true) */
    enableSubTasks: boolean;
    /** Use InteractionNet for parallel execution (default: false) */
    useInteractionNet: boolean;
    /** Auto-enrich prompts with RAG context (default: false) */
    useRAGContext: boolean;
    /** Number of RAG results to inject (default: 3) */
    ragTopK: number;
    /** Record executions to MemoryHighway (default: false) */
    useMemoryHighway: boolean;
  };

  /** Escalation circuit breaker */
  escalation: {
    /** Escalations before circuit trips (default: 3) */
    threshold: number;
    /** Circuit breaker window in ms (default: 300_000) */
    windowMs: number;
  };

  /** Routing */
  routing: {
    /** Minimum confidence to accept a routing decision (default: 0.6) */
    confidenceThreshold: number;
    /** Active agent context/namespace (default: "default") */
    activeContext: string;
    /** Named agent groups — context name → agent IDs (["*"] = all agents) */
    contexts: Record<string, string[]>;
    /** Fall back to all agents if no match in active context (default: true) */
    contextFallback: boolean;
    /** Routing cache configuration */
    cache: {
      /** Enable routing result caching (default: true) */
      enabled: boolean;
      /** Max cached entries (default: 200) */
      maxSize: number;
      /** Cache entry TTL in ms (default: 300_000) */
      ttlMs: number;
    };
  };

  /** Conversation tracking */
  conversation: {
    /** Max messages per conversation before trimming (default: 100) */
    maxMessages: number;
  };

  /** Agent handoff */
  handoff: {
    /** Max handoff chain length before blocking (default: 5) */
    maxChainLength: number;
  };

  /** Progress tracking */
  progress: {
    /** Max token budget per workflow (default: 500_000) */
    maxTokenBudget: number;
    /** Max wall-clock time per workflow in ms (default: 600_000) */
    maxWallClockMs: number;
    /** Stall detection threshold in ms (default: 60_000) */
    stallThresholdMs: number;
    /** Cosine similarity threshold for loop detection (default: 0.9) */
    loopSimilarityThreshold: number;
    /** Max similar consecutive outputs before loop warning (default: 3) */
    maxConsecutiveSimilar: number;
  };

  /** Memory Highway */
  highway: {
    /** Enable RAG indexing of messages (default: true) */
    enableRAG: boolean;
    /** Enable deduplication (default: true) */
    enableDedup: boolean;
    /** Dedup window in ms (default: 5_000) */
    dedupWindowMs: number;
    /** Max messages in memory (default: 10_000) */
    maxRetainedMessages: number;
    /** KV store TTL in ms (default: 3_600_000) */
    kvTTL: number;
    /** Min priority for RAG indexing (default: 1) */
    indexMinPriority: number;
  };

  /** Agent Communication Protocol */
  acp: {
    /** Request timeout in ms (default: 30_000) */
    defaultRequestTimeoutMs: number;
    /** Max retries before dead-lettering (default: 3) */
    maxRetries: number;
    /** Track communication graph (default: true) */
    trackCommGraph: boolean;
    /** Track acknowledgments (default: true) */
    trackAcknowledgments: boolean;
    /** Max dead letters (default: 100) */
    maxDeadLetters: number;
  };

  /** Structured logging */
  logging: {
    /** Log level (default: "info") */
    level: "debug" | "info" | "warn" | "error";
    /** Max retained log entries for querying (default: 5000) */
    maxRetainedEntries: number;
    /** Forward to SynapseLogger text file (default: true) */
    forwardToSynapse: boolean;
  };

  /** Shared state bus */
  sharedState: {
    /** Cleanup interval in ms (default: 300_000) */
    cleanupIntervalMs: number;
    /** Max transitions per session (default: 1000) */
    maxTransitionsPerSession: number;
    /** Publish changes to MemoryHighway (default: true) */
    publishChanges: boolean;
    /** Persist sessions to KV (default: true) */
    persistSessions: boolean;
  };

  /** Server */
  server: {
    /** WebSocket server port (default: 9999) */
    port: number;
    /** Server host (default: "localhost") */
    host: string;
  };
}

/** Agent task request */
export interface TaskRequest {
  /** Unique task ID */
  id: string;
  /** Human-readable description */
  description: string;
  /** Agent ID of the requester */
  requester: string;
  /** Target agent ID or capability query string */
  target: string;
  /** Task priority */
  priority: Priority;
  /** Arbitrary context data */
  context: Record<string, unknown>;
  /** Optional deadline (Unix ms) */
  deadline?: number;
  /** Optional LLM overrides — bypass tier routing with explicit provider/model */
  overrides?: {
    /** Target provider: "claude" | "openai" | "gemini" | "ollama" */
    provider?: LLMProvider;
    /** Model name — short alias ("opus", "gemini-flash") or full ID ("gpt-4o", "gemini-2.0-flash") */
    model?: string;
  };
}

/** Agent task result */
export interface TaskResult {
  /** Corresponding TaskRequest.id */
  requestId: string;
  /** Agent ID that executed the task */
  executor: string;
  /** Outcome status */
  status: "success" | "failure" | "partial" | "escalated";
  /** Task output (type depends on agent) */
  output: unknown;
  /** Execution duration in ms */
  duration: number;
  /** Optional LLM token usage */
  tokensUsed?: number;
}

/** Registry query filter */
export interface RegistryQuery {
  section?: RegistrySection;
  capability?: string;
  tier?: AgentTier;
  status?: AgentStatus;
}

// ─────────────────────────────────────────────────────────────
// Transport Types — External Agent Communication
// Agents can live locally (LLM), or externally via API, CLI,
// MCP, or federation with another AETHER instance.
// ─────────────────────────────────────────────────────────────

/** How an agent is reached */
export type AgentTransport = "local" | "api" | "cli" | "mcp" | "federation";

/** HTTP API transport — cloud services like Banana, Replicate, etc. */
export interface APITransportConfig {
  transport: "api";
  /** Endpoint URL */
  endpoint: string;
  /** HTTP method */
  method: "POST" | "GET" | "PUT";
  /** Static headers to include */
  headers?: Record<string, string>;
  /** Authentication type */
  authType: "bearer" | "api-key" | "header" | "none";
  /** Env var holding the secret (e.g. "BANANA_API_KEY") */
  authEnvVar?: string;
  /** Header name for api-key auth (default: "Authorization") */
  authHeader?: string;
  /** Map TaskRequest fields → API request body fields */
  requestMapping?: Record<string, string>;
  /** Map API response fields → TaskResult output fields */
  responseMapping?: Record<string, string>;
  /** Request timeout in ms (default: 60_000) */
  timeout?: number;
  /** Polling config for async APIs (e.g. image gen that returns a job ID) */
  polling?: {
    /** URL template for status checks — {{jobId}} is replaced */
    statusEndpoint: string;
    /** Field in initial response containing the job ID */
    jobIdField: string;
    /** Field in status response indicating completion */
    completionField: string;
    /** Value that means "done" */
    completionValue: string;
    /** Field containing the final result */
    resultField: string;
    /** Polling interval in ms */
    intervalMs: number;
    /** Max polls before giving up */
    maxPolls: number;
  };
}

/** CLI subprocess transport — local tools, scripts, other runtimes */
export interface CLITransportConfig {
  transport: "cli";
  /** Command to execute (e.g. "python", "node", "./my-agent") */
  command: string;
  /** Arguments to pass (task JSON is appended or piped) */
  args?: string[];
  /** Working directory for the subprocess */
  cwd?: string;
  /** Additional env vars for the subprocess */
  env?: Record<string, string>;
  /** How to send the task to the process */
  inputFormat: "stdin-json" | "args" | "file";
  /** How to read the result from the process */
  outputFormat: "stdout-json" | "stdout-text" | "file";
  /** Path for file-based I/O (when inputFormat/outputFormat is "file") */
  ioFilePath?: string;
  /** Process timeout in ms (default: 120_000) */
  timeout?: number;
}

/** MCP (Model Context Protocol) transport — MCP servers */
export interface MCPTransportConfig {
  transport: "mcp";
  /** For stdio-based MCP servers: command to spawn */
  serverCommand?: string;
  /** Args for the server command */
  serverArgs?: string[];
  /** For HTTP-based MCP servers: base URL */
  serverUrl?: string;
  /** Which MCP tool to invoke */
  toolName: string;
  /** Static tool arguments to always include */
  staticArgs?: Record<string, unknown>;
  /** Map TaskRequest fields → MCP tool argument names */
  argMapping?: Record<string, string>;
  /** Env vars for the MCP server process */
  env?: Record<string, string>;
  /** Connection timeout in ms (default: 30_000) */
  timeout?: number;
}

/** Federation transport — another AETHER instance */
export interface FederationTransportConfig {
  transport: "federation";
  /** WebSocket URL of the remote instance (e.g. ws://remote:9999) */
  instanceUrl: string;
  /** Agent ID on the remote instance to target */
  remoteAgentId: string;
  /** Channel to join on the remote instance */
  channel?: string;
  /** Auth token for the remote instance */
  authToken?: string;
  /** Request timeout in ms (default: 60_000) */
  timeout?: number;
}

/** Union of all transport configs */
export type TransportConfig =
  | APITransportConfig
  | CLITransportConfig
  | MCPTransportConfig
  | FederationTransportConfig;

/** Event map for the runtime event emitter */
export interface RuntimeEvents {
  "agent:registered": AgentDefinition;
  "agent:status": { id: string; status: AgentStatus };
  "message:sent": AetherMessage;
  "message:received": AetherMessage;
  "escalation:triggered": EscalationRecord;
  "escalation:circuit-break": { agentId: string; count: number };
  "task:started": TaskRequest;
  "task:completed": TaskResult;
  "transport:connected": { agentId: string; transport: AgentTransport };
  "transport:error": {
    agentId: string;
    transport: AgentTransport;
    error: string;
  };
  "server:started": { port: number };
  "server:stopped": void;
}

// ─────────────────────────────────────────────────────────────
// Phase 2 Types — Supercharge Extensions
// Handoff, StateGraph, GroupChat, Router, Progress, Guardrails,
// Conversations, Entities, Plugins, Reactions, Durable, Conflicts
// ─────────────────────────────────────────────────────────────

// ── Conversation State ─────────────────────────────────────────

/** Message role in a conversation */
export type ConversationRole = "system" | "user" | "assistant" | "tool";

/** Status of a conversation */
export type ConversationStatus = "active" | "paused" | "completed" | "aborted";

/** A single message within a conversation */
export interface ConversationMessage {
  id: string;
  conversationId: string;
  agentId: string;
  role: ConversationRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Conversation state for tracking multi-turn agent interactions */
export interface ConversationState {
  id: string;
  participants: string[];
  messages: ConversationMessage[];
  state: Record<string, unknown>;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

// ── Handoff Protocol ───────────────────────────────────────────

/** Request to transfer control between agents */
export interface HandoffRequest {
  fromAgent: string;
  toAgent: string;
  reason: string;
  conversationId?: string;
  preserveHistory: boolean;
  taskContext: Record<string, unknown>;
}

/** Result of a handoff attempt */
export interface HandoffResult {
  success: boolean;
  fromAgent: string;
  toAgent: string;
  conversationId: string;
  reason?: string;
}

// ── State Graph ────────────────────────────────────────────────

/** Configuration for a state graph */
export interface StateGraphConfig {
  id: string;
  maxIterations: number;
  entryNode: string;
  exitNodes: string[];
}

/** A node in the state graph */
export interface GraphNode {
  id: string;
  label: string;
  executor: (state: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/** An edge in the state graph */
export interface GraphEdge {
  from: string;
  to: string;
  condition?: (state: Record<string, unknown>) => string | null;
}

// ── Group Chat ─────────────────────────────────────────────────

/** Configuration for a group chat session */
export interface GroupChatConfig {
  id: string;
  participants: string[];
  maxRounds: number;
  speakerSelection: "round-robin" | "capability" | "llm" | "custom";
  terminationKeyword?: string;
  topic: string;
}

/** Speaker selection strategy interface */
export interface SpeakerSelector {
  selectNext(
    history: ConversationMessage[],
    participants: AgentDefinition[],
    round: number,
  ): AgentDefinition;
}

/** Termination condition interface */
export interface TerminationCondition {
  shouldTerminate(
    history: ConversationMessage[],
    round: number,
  ): boolean;
}

// ── Context-Aware Router ───────────────────────────────────────

/** Result of a routing decision */
export interface RoutingDecision {
  agent: AgentDefinition;
  confidence: number;
  strategy: string;
  reason: string;
}

/** File ownership rules for routing */
export interface FileOwnershipRule {
  pattern: string;
  agentId: string;
  ruleType: "owns" | "watches";
}

// ── Progress Tracking ──────────────────────────────────────────

/** Configuration for progress tracking */
export interface ProgressConfig {
  maxTokenBudget: number;
  maxWallClockMs: number;
  stallThresholdMs: number;
  loopSimilarityThreshold: number;
  maxConsecutiveSimilar: number;
}

/** Warning about execution stalling */
export interface StallWarning {
  workflowId: string;
  stepIndex: number;
  elapsedMs: number;
  expectedMs: number;
  message: string;
}

/** Warning about execution looping */
export interface LoopWarning {
  workflowId: string;
  agentId: string;
  similarity: number;
  consecutiveCount: number;
  message: string;
}

/** Budget estimate for a workflow */
export interface BudgetEstimate {
  estimatedTokens: number;
  estimatedTimeMs: number;
  withinBudget: boolean;
  warnings: string[];
}

// ── Guardrails ─────────────────────────────────────────────────

/** Result of a guardrail check */
export interface GuardResult {
  allowed: boolean;
  modified?: string;
  reason?: string;
  guardId: string;
}

/** Pre-LLM guard interface */
export interface PreGuard {
  id: string;
  check(prompt: string, agent: AgentDefinition): GuardResult;
}

/** Post-LLM guard interface */
export interface PostGuard {
  id: string;
  check(output: string, agent: AgentDefinition): GuardResult;
}

// ── Schema Validation ──────────────────────────────────────────

/** JSON Schema-compatible output schema definition */
export interface OutputSchema {
  type: "object" | "array" | "string";
  properties?: Record<string, {
    type: string;
    description?: string;
    required?: boolean;
    items?: OutputSchema;
  }>;
  required?: string[];
  description?: string;
}

// ── Plugin System ──────────────────────────────────────────────

/** Plugin lifecycle slots */
export type PluginSlot =
  | "pre-execution"
  | "post-execution"
  | "pre-routing"
  | "post-routing"
  | "on-escalation"
  | "on-error"
  | "on-startup"
  | "on-shutdown";

/** Context passed to plugins */
export interface PluginContext {
  slot: PluginSlot;
  task?: TaskRequest;
  result?: TaskResult;
  agent?: AgentDefinition;
  error?: Error;
  metadata: Record<string, unknown>;
}

/** Result from a plugin execution */
export interface PluginResult {
  handled: boolean;
  modified?: Record<string, unknown>;
  abort?: boolean;
  reason?: string;
}

// ── Reaction Engine ────────────────────────────────────────────

/** Rule for automatic reactions to events */
export interface ReactionRule {
  id: string;
  trigger: {
    channel: string;
    messageType?: string;
    condition?: string;
  };
  action: {
    type: "execute_task" | "execute_workflow" | "notify" | "custom";
    target?: string;
    taskTemplate?: string;
  };
  cooldownMs: number;
  maxFires: number;
  enabled: boolean;
}

// ── Entity Memory ──────────────────────────────────────────────

/** Entity types for knowledge extraction */
export type EntityType = "file" | "module" | "api" | "concept" | "person" | "config";

/** An entity in the knowledge graph */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  firstSeen: string;
  lastUpdated: string;
}

/** A fact about an entity */
export interface EntityFact {
  id: string;
  entityId: string;
  fact: string;
  sourceTask?: string;
  confidence: number;
  createdAt: string;
}

// ── Workflow Checkpoints (Durable) ─────────────────────────────

/** Checkpoint for durable workflow resume */
export interface WorkflowCheckpoint {
  id: string;
  workflowId: string;
  stepIndex: number;
  state: Record<string, unknown>;
  conversationId?: string;
  createdAt: string;
}

/** Status for durable workflows */
export type DurableWorkflowStatus = "running" | "paused" | "completed" | "failed" | "aborted";

// ── Pre-flight Verification ────────────────────────────────────

/** Result of a pre-flight verification */
export interface PreflightResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
  budget: BudgetEstimate;
  agentHealth: Record<string, "healthy" | "degraded" | "offline">;
}

// ── Conflict Resolution ────────────────────────────────────────

/** Strategy for resolving conflicts between agent outputs */
export type ConflictStrategy =
  | "majority-vote"
  | "weighted-by-tier"
  | "weighted-by-confidence"
  | "llm-mediator"
  | "merge";

/** Report of identified conflicts */
export interface ConflictReport {
  agreements: string[];
  contradictions: Array<{
    topic: string;
    positions: Array<{ agentId: string; output: string }>;
  }>;
  uniqueContributions: Array<{ agentId: string; content: string }>;
}

// ── Progress Event ─────────────────────────────────────────────

/** A tracked event for workflow progress monitoring */
export interface ProgressEvent {
  id: string;
  workflowId: string;
  stepIndex: number;
  agentId: string;
  outputHash?: string;
  tokensUsed: number;
  duration: number;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────
// Phase 8 Types — Multi-Agent Communication Protocol
// ACP, Structured Logging, Observable Shared State
// ─────────────────────────────────────────────────────────────

// ── ACP (Agent Communication Protocol) ───────────────────────

/** ACP message type discriminator */
export type ACPMessageType =
  | "task"
  | "plan"
  | "result"
  | "validation"
  | "error"
  | "control"
  | "ack"
  | "query"
  | "broadcast";

/** Trace context for debugging and policy tracking */
export interface ACPTrace {
  taskId?: string;
  workflowId?: string;
  parentMsgId?: string;
  hopCount: number;
  hops: string[];
  policyTags: string[];
}

/** Structured metadata headers */
export interface ACPMeta {
  schemaId?: string;
  expectsResponse?: ACPMessageType;
  responseTimeoutMs?: number;
  retryCount: number;
  maxRetries: number;
  [key: string]: unknown;
}

/** The ACP message envelope */
export interface ACPEnvelope {
  msgId: string;
  timestamp: string;
  sender: string;
  receiver: string;
  msgType: ACPMessageType;
  content: unknown;
  meta: ACPMeta;
  trace: ACPTrace;
  acknowledged: boolean;
  highwayMsgId?: string;
}

/** Communication edge in the agent graph */
export interface CommEdge {
  from: string;
  to: string;
  msgType: ACPMessageType;
  count: number;
  lastAt: string;
}

/** Dead letter entry */
export interface DeadLetter {
  envelope: ACPEnvelope;
  reason: string;
  failedAt: string;
  attempts: number;
}

// ── Structured Observability Logging ─────────────────────────

/** A structured log entry with machine-parseable fields */
export interface StructuredLogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  context: {
    taskId?: string;
    workflowId?: string;
    agentId?: string;
    correlationId?: string;
    conversationId?: string;
  };
  data?: Record<string, unknown>;
  durationMs?: number;
}

/** LLM call instrumentation record */
export interface LLMCallRecord {
  timestamp: string;
  agentId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  attempt: number;
  success: boolean;
  error?: string;
  taskId?: string;
}

/** Log query filter */
export interface LogQueryFilter {
  level?: "debug" | "info" | "warn" | "error";
  source?: string;
  taskId?: string;
  workflowId?: string;
  agentId?: string;
  since?: string;
  until?: string;
  limit?: number;
}

// ── Observable Shared State Bus ──────────────────────────────

/** A snapshot of the shared workflow state */
export interface BusState {
  id: string;
  sessionId: string;
  goal: string;
  activeRole: string | null;
  stepCount: number;
  edges: CommEdge[];
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Description of a state transition */
export interface StateTransition {
  changedFields: string[];
  agent: string;
  reason: string;
  fromVersion: number;
  toVersion: number;
  timestamp: string;
}

/** Update command for bus state */
export interface BusUpdate {
  agent: string;
  reason: string;
  patches: Record<string, unknown>;
  setActiveRole?: string | null;
  incrementStep?: boolean;
  setGoal?: string;
  addEdge?: { from: string; to: string; msgType: ACPMessageType };
}
