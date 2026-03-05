// ─────────────────────────────────────────────────────────────
// AETHER MCP Server — Expose AETHER as an MCP Server
//
// Allows external MCP clients (Claude Desktop, Cursor, etc.)
// to interact with AETHER's agent hierarchy. Supports:
//   - Streamable HTTP transport (concurrent connections)
//   - Session management (Mcp-Session-Id)
//   - Tool exposure: submit_task, query_agents, search_memory
//   - Resource exposure: agent registry, RAG index
// ─────────────────────────────────────────────────────────────

import type { SynapseLogger } from "../core/logger.ts";
import type { AgentRegistry } from "../core/registry.ts";
import type { RAGIndex } from "../core/rag-index.ts";
import type { MemoryHighway } from "../core/memory-highway.ts";
import type { AgentRouter } from "../core/router.ts";
import type { SettingsManager } from "../core/settings.ts";
import type { AetherSettings } from "../core/types.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  /** Port to listen on (default: 3001) */
  port: number;
  /** Host to bind to (default: "127.0.0.1") */
  host: string;
  /** Server name for MCP protocol */
  serverName: string;
  /** Server version */
  serverVersion: string;
}

const DEFAULT_CONFIG: MCPServerConfig = {
  port: 3001,
  host: "127.0.0.1",
  serverName: "aether",
  serverVersion: "0.1.0",
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Session {
  id: string;
  createdAt: number;
  lastActivity: number;
}

// ─────────────────────────────────────────────────────────────
// AETHER MCP Server
// ─────────────────────────────────────────────────────────────

export class AetherMCPServer {
  private config: MCPServerConfig;
  private logger: SynapseLogger;
  private registry: AgentRegistry | null;
  private ragIndex: RAGIndex | null;
  private highway: MemoryHighway | null;
  private router: AgentRouter | null;
  private settingsManager: SettingsManager | null;
  private settings: AetherSettings | null;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private sessions: Map<string, Session> = new Map();

  /** Task submission handler — injected by the runtime */
  private taskHandler:
    | ((
        description: string,
        target: string,
        context: Record<string, unknown>,
        overrides?: { provider?: string; model?: string },
      ) => Promise<unknown>)
    | null = null;

  constructor(
    logger: SynapseLogger,
    registry?: AgentRegistry | null,
    ragIndex?: RAGIndex | null,
    highway?: MemoryHighway | null,
    config?: Partial<MCPServerConfig>,
    router?: AgentRouter | null,
    settingsManager?: SettingsManager | null,
    settings?: AetherSettings | null,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.registry = registry ?? null;
    this.ragIndex = ragIndex ?? null;
    this.highway = highway ?? null;
    this.router = router ?? null;
    this.settingsManager = settingsManager ?? null;
    this.settings = settings ?? null;
  }

  /** Set the task submission handler */
  setTaskHandler(
    handler: (
      description: string,
      target: string,
      context: Record<string, unknown>,
      overrides?: { provider?: string; model?: string },
    ) => Promise<unknown>,
  ): void {
    this.taskHandler = handler;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Start the Streamable HTTP MCP server */
  start(): void {
    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.host,
      fetch: (req) => this.handleRequest(req),
    });

    this.logger.info(
      "MCPServer",
      `Listening on http://${this.config.host}:${this.config.port}`,
    );
  }

  /** Stop the server */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    this.sessions.clear();
    this.logger.info("MCPServer", "Stopped");
  }

  // ── HTTP Handler ───────────────────────────────────────────

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", sessions: this.sessions.size });
    }

    // MCP endpoint
    if (url.pathname === "/mcp" && req.method === "POST") {
      return this.handleMCPRequest(req);
    }

    // SSE endpoint for streaming
    if (url.pathname === "/mcp" && req.method === "GET") {
      return this.handleSSE(req);
    }

    return new Response("Not Found", { status: 404 });
  }

  /** Handle MCP JSON-RPC POST requests */
  private async handleMCPRequest(req: Request): Promise<Response> {
    let rpcRequest: JsonRpcRequest;

    try {
      rpcRequest = (await req.json()) as JsonRpcRequest;
    } catch {
      return Response.json(this.makeError(-32700, "Parse error"), {
        status: 400,
      });
    }

    // Session management
    let sessionId = req.headers.get("Mcp-Session-Id");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });
    } else {
      const session = this.sessions.get(sessionId);
      if (session) session.lastActivity = Date.now();
    }

    // Route to handler
    const response = await this.handleMethod(rpcRequest);

    return Response.json(response, {
      headers: {
        "Mcp-Session-Id": sessionId,
        "Content-Type": "application/json",
      },
    });
  }

  /** Handle SSE connection for streaming */
  private handleSSE(req: Request): Response {
    const sessionId = req.headers.get("Mcp-Session-Id") ?? crypto.randomUUID();

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        controller.enqueue(
          new TextEncoder().encode(
            `event: open\ndata: {"sessionId":"${sessionId}"}\n\n`,
          ),
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Mcp-Session-Id": sessionId,
      },
    });
  }

  // ── Method Routing ─────────────────────────────────────────

  private async handleMethod(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (req.method) {
        case "initialize":
          return this.handleInitialize(req);
        case "tools/list":
          return this.handleToolsList(req);
        case "tools/call":
          return await this.handleToolsCall(req);
        case "resources/list":
          return this.handleResourcesList(req);
        case "resources/read":
          return await this.handleResourcesRead(req);
        case "ping":
          return { jsonrpc: "2.0", id: req.id, result: {} };
        default:
          // Notifications (no id) don't get responses
          if (req.id === undefined) {
            return { jsonrpc: "2.0", result: {} };
          }
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // ── MCP Methods ────────────────────────────────────────────

  private handleInitialize(req: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: this.config.serverName,
          version: this.config.serverVersion,
        },
      },
    };
  }

  private handleToolsList(req: JsonRpcRequest): JsonRpcResponse {
    const tools = [
      {
        name: "submit_task",
        description:
          "Submit a task to AETHER's agent hierarchy for execution. The task will be routed to the best-matching agent based on capabilities.",
        inputSchema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Task description for the agent",
            },
            target: {
              type: "string",
              description: "Target agent ID or capability query",
            },
            provider: {
              type: "string",
              description:
                "LLM provider override (claude, openai, gemini, ollama)",
            },
            model: {
              type: "string",
              description:
                "Model name override (e.g. gemini-2.0-flash, gpt-4o, llama3.2)",
            },
            context: {
              type: "object",
              description: "Additional context data",
            },
          },
          required: ["description"],
        },
      },
      {
        name: "query_agents",
        description:
          "Search for agents by capability, section, or tier in AETHER's registry.",
        inputSchema: {
          type: "object",
          properties: {
            capability: {
              type: "string",
              description: "Capability to search for",
            },
            section: { type: "string", description: "Registry section filter" },
            tier: {
              type: "string",
              description: "Agent tier filter (master/manager/worker)",
            },
          },
        },
      },
      {
        name: "search_memory",
        description:
          "Search AETHER's RAG-indexed memory for relevant context, past conversations, code, and agent information.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            topK: {
              type: "number",
              description: "Number of results (default: 5)",
            },
            namespace: {
              type: "string",
              description:
                "Namespace to search (agents/code/messages/docs/tasks)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_status",
        description:
          "Get AETHER system status including agent counts, connection info, and metrics.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "switch_context",
        description:
          "Switch the active agent namespace/context. Contexts filter which agents receive tasks.",
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description:
                "Context name to switch to (e.g. 'frontend', 'security', 'default')",
            },
          },
          required: ["context"],
        },
      },
      {
        name: "get_config",
        description:
          "Read AETHER's current settings. Optionally filter by dot-path (e.g. 'execution.maxDepth').",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Dot-path to a specific setting (e.g. 'execution.maxDepth', 'routing.cache')",
            },
          },
        },
      },
    ];

    return { jsonrpc: "2.0", id: req.id, result: { tools } };
  }

  private async handleToolsCall(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = req.params as {
      name: string;
      arguments: Record<string, unknown>;
    };

    switch (params.name) {
      case "submit_task":
        return this.toolSubmitTask(req.id!, params.arguments);
      case "query_agents":
        return this.toolQueryAgents(req.id!, params.arguments);
      case "search_memory":
        return await this.toolSearchMemory(req.id!, params.arguments);
      case "get_status":
        return this.toolGetStatus(req.id!);
      case "switch_context":
        return this.toolSwitchContext(req.id!, params.arguments);
      case "get_config":
        return this.toolGetConfig(req.id!, params.arguments);
      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: `Unknown tool: ${params.name}` },
        };
    }
  }

  private handleResourcesList(req: JsonRpcRequest): JsonRpcResponse {
    const resources = [
      {
        uri: "aether://agents",
        name: "Agent Registry",
        description: "All registered agents and their capabilities",
        mimeType: "application/json",
      },
      {
        uri: "aether://metrics",
        name: "System Metrics",
        description: "AETHER system performance metrics",
        mimeType: "application/json",
      },
      {
        uri: "aether://settings",
        name: "Settings",
        description: "Current AETHER settings (all 13 subsystem groups)",
        mimeType: "application/json",
      },
    ];

    return { jsonrpc: "2.0", id: req.id, result: { resources } };
  }

  private async handleResourcesRead(
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const params = req.params as { uri: string };

    switch (params.uri) {
      case "aether://agents":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType: "application/json",
                text: JSON.stringify(this.registry?.getAll() ?? [], null, 2),
              },
            ],
          },
        };

      case "aether://metrics":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType: "application/json",
                text: JSON.stringify({
                  agents: this.registry?.getAll().length ?? 0,
                  sessions: this.sessions.size,
                }),
              },
            ],
          },
        };

      case "aether://settings":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType: "application/json",
                text: JSON.stringify(this.settings ?? {}, null, 2),
              },
            ],
          },
        };

      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: `Unknown resource: ${params.uri}` },
        };
    }
  }

  // ── Tool Implementations ───────────────────────────────────

  private async toolSubmitTask(
    id: number,
    args: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    if (!this.taskHandler) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: "Task submission not available — no executor configured",
            },
          ],
        },
      };
    }

    try {
      const overrides: { provider?: string; model?: string } = {};
      if (args.provider) overrides.provider = args.provider as string;
      if (args.model) overrides.model = args.model as string;

      const result = await this.taskHandler(
        args.description as string,
        (args.target as string) ?? "auto",
        (args.context as Record<string, unknown>) ?? {},
        Object.keys(overrides).length > 0 ? overrides : undefined,
      );

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Task failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        },
      };
    }
  }

  private toolQueryAgents(
    id: number,
    args: Record<string, unknown>,
  ): JsonRpcResponse {
    if (!this.registry) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: "Registry not available" }],
        },
      };
    }

    const agents = this.registry.query({
      capability: args.capability as string | undefined,
      section: args.section as any,
      tier: args.tier as any,
    });

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              agents.map((a) => ({
                id: a.id,
                tier: a.tier,
                sections: a.sections,
                capabilities: a.capabilities,
                status: a.status,
              })),
              null,
              2,
            ),
          },
        ],
      },
    };
  }

  private async toolSearchMemory(
    id: number,
    args: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    // Try RAG index first
    if (this.ragIndex) {
      const results = await this.ragIndex.query(args.query as string, {
        topK: (args.topK as number) ?? 5,
        namespace: args.namespace as any,
      });

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                results.map((r) => ({
                  text: r.text,
                  score: r.score.toFixed(3),
                  namespace: r.namespace,
                  source: r.metadata.sourceId,
                })),
                null,
                2,
              ),
            },
          ],
        },
      };
    }

    // Fallback to highway search
    if (this.highway) {
      const results = await this.highway.recall(
        args.query as string,
        (args.topK as number) ?? 5,
      );
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: "No memory index available" }],
      },
    };
  }

  private toolGetStatus(id: number): JsonRpcResponse {
    const allAgents = this.registry?.getAll() ?? [];
    const cacheStats = this.router?.getCacheStats() ?? null;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                server: this.config.serverName,
                version: this.config.serverVersion,
                agents: {
                  total: allAgents.length,
                  idle: allAgents.filter((a) => a.status === "idle").length,
                  busy: allAgents.filter((a) => a.status === "busy").length,
                  byTier: {
                    master: allAgents.filter((a) => a.tier === "master").length,
                    manager: allAgents.filter((a) => a.tier === "manager")
                      .length,
                    worker: allAgents.filter((a) => a.tier === "worker").length,
                  },
                },
                activeContext: this.router?.getActiveContext() ?? "default",
                contexts: this.router?.getContextNames() ?? ["default"],
                sessions: this.sessions.size,
                ragAvailable: this.ragIndex !== null,
                highwayAvailable: this.highway !== null,
                cacheStats,
              },
              null,
              2,
            ),
          },
        ],
      },
    };
  }

  private toolSwitchContext(
    id: number,
    args: Record<string, unknown>,
  ): JsonRpcResponse {
    const contextName = args.context as string;

    if (!this.router) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: "Router not available — cannot switch context",
            },
          ],
          isError: true,
        },
      };
    }

    const available = this.router.getContextNames();
    if (!available.includes(contextName)) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Context "${contextName}" not found. Available: ${available.join(", ")}`,
            },
          ],
          isError: true,
        },
      };
    }

    this.router.setActiveContext(contextName);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          { type: "text", text: `Switched to context: ${contextName}` },
        ],
      },
    };
  }

  private toolGetConfig(
    id: number,
    args: Record<string, unknown>,
  ): JsonRpcResponse {
    const path = args.path as string | undefined;

    if (path && this.settingsManager) {
      const value = this.settingsManager.get(path);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: JSON.stringify({ path, value }, null, 2) },
          ],
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          { type: "text", text: JSON.stringify(this.settings ?? {}, null, 2) },
        ],
      },
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private makeError(code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", error: { code, message } };
  }

  /** Get server port */
  get port(): number {
    return this.config.port;
  }

  /** Check if server is running */
  isRunning(): boolean {
    return this.server !== null;
  }
}
