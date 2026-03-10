#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// AETHER MCP Server — Stdio Entrypoint
//
// Standalone stdio transport for MCP protocol integration.
// Used by Claude Desktop, Cursor, Windsurf, and the AETHER
// VS Code extension. Reads JSON-RPC from stdin, writes to stdout.
//
// Usage:
//   bun run bin/aether-mcp.ts [--workspace /path/to/project]
//
// Claude Desktop config (claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "aether": {
//         "command": "bun",
//         "args": ["run", "/path/to/aether/bin/aether-mcp.ts"],
//         "env": { "ANTHROPIC_API_KEY": "..." }
//       }
//     }
//   }
// ─────────────────────────────────────────────────────────────

import { AetherRuntime } from "../core/runtime.ts";
import type { LLMProvider } from "../core/types.ts";

const VERSION = "0.2.0";

// ── Parse arguments ──────────────────────────────────────────

const args = process.argv.slice(2);
let workspacePath = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--workspace" && args[i + 1]) {
    workspacePath = args[i + 1];
    i++;
  }
}

// ── JSON-RPC Types ───────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── Runtime State ────────────────────────────────────────────

let runtime: AetherRuntime | null = null;
let initialized = false;

async function ensureRuntime(): Promise<AetherRuntime> {
  if (!runtime) {
    console.error(`[aether-mcp] Initializing runtime at: ${workspacePath}`);
    runtime = new AetherRuntime(workspacePath);
    await runtime.init();
    const providers = runtime.providers;
    console.error(`[aether-mcp] Available providers: ${providers?.getAvailableProviders().join(", ") || "none"}`);
    const config = providers?.getConfig();
    console.error(`[aether-mcp] Worker tier: ${config?.tiers?.worker?.provider}/${config?.tiers?.worker?.model}`);
    console.error(`[aether-mcp] Has apiKeys: ${!!config?.apiKeys}, copilot key: ${config?.apiKeys?.copilot ? "YES" : "NO"}`);
  }
  return runtime;
}

// ── MCP Tool Definitions ─────────────────────────────────────

function getToolsList() {
  return [
    {
      name: "submit_task",
      description:
        "Submit a task to AETHER's agent hierarchy for execution. The task will be routed to the best-matching agent based on capabilities, file ownership, and historical success.",
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Task description for the agent to execute",
          },
          target: {
            type: "string",
            description:
              "Target agent ID (e.g. 'api-architect') or 'auto' for best-fit routing",
          },
          provider: {
            type: "string",
            description:
              "LLM provider override (claude, openai, gemini, ollama)",
          },
          model: {
            type: "string",
            description:
              "Model name override (e.g. claude-sonnet-4-20250514, gpt-4o)",
          },
          context: {
            type: "object",
            description: "Additional context data passed to the agent",
          },
        },
        required: ["description"],
      },
    },
    {
      name: "query_agents",
      description:
        "Search for agents by capability, section, or tier. Returns agent IDs, status, capabilities.",
      inputSchema: {
        type: "object",
        properties: {
          capability: {
            type: "string",
            description: "Capability keyword to search",
          },
          section: {
            type: "string",
            description:
              "Registry section (FRONTEND, BACKEND, TOOLS, SECURITY, RESEARCH)",
          },
          tier: {
            type: "string",
            description: "Agent tier (master, manager, worker)",
          },
        },
      },
    },
    {
      name: "search_memory",
      description:
        "Search AETHER's RAG-indexed memory for context, past tasks, code, and agent knowledge.",
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
              "Namespace to search (agents, code, messages, docs, tasks)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_status",
      description:
        "Get AETHER system status including agent counts, active context, running state, and cache stats.",
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
        "Read AETHER's current settings. Optionally filter by section or dot-path.",
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
}

// ── MCP Resource Definitions ─────────────────────────────────

function getResourcesList() {
  return [
    {
      uri: "aether://agents",
      name: "Agent Registry",
      description: "All registered agents and their capabilities",
      mimeType: "application/json",
    },
    {
      uri: "aether://settings",
      name: "Settings",
      description: "Current AETHER settings (all 13 subsystem groups)",
      mimeType: "application/json",
    },
    {
      uri: "aether://metrics",
      name: "System Metrics",
      description: "Agent counts, cache stats, uptime",
      mimeType: "application/json",
    },
  ];
}

// ── Method Handlers ──────────────────────────────────────────

async function handleMethod(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: "aether",
            version: VERSION,
          },
        },
      };

    case "notifications/initialized":
      initialized = true;
      // Notification — no response needed, but we return empty for safety
      return { jsonrpc: "2.0", id: req.id, result: {} };

    case "tools/list":
      return { jsonrpc: "2.0", id: req.id, result: { tools: getToolsList() } };

    case "tools/call":
      return await handleToolCall(req);

    case "resources/list":
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { resources: getResourcesList() },
      };

    case "resources/read":
      return await handleResourceRead(req);

    case "ping":
      return { jsonrpc: "2.0", id: req.id, result: {} };

    default:
      // Notifications (no id) are silently accepted
      if (req.id === undefined) {
        return { jsonrpc: "2.0", result: {} };
      }
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

// ── Tool Call Handler ────────────────────────────────────────

async function handleToolCall(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const params = req.params as {
    name: string;
    arguments?: Record<string, unknown>;
  };
  const toolArgs = params.arguments ?? {};

  try {
    const rt = await ensureRuntime();

    switch (params.name) {
      case "submit_task": {
        const result = await rt.run(toolArgs.description as string, {
          agent: toolArgs.target as string | undefined,
          provider: toolArgs.provider as LLMProvider | undefined,
          model: toolArgs.model as string | undefined,
        });
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        };
      }

      case "query_agents": {
        const agents = rt.registry.query({
          capability: toolArgs.capability as string | undefined,
          section: toolArgs.section as any,
          tier: toolArgs.tier as any,
        });
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  agents.map((a) => ({
                    id: a.id,
                    name: a.name,
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

      case "search_memory": {
        if (rt.ragIndex) {
          const results = await rt.ragIndex.query(toolArgs.query as string, {
            topK: (toolArgs.topK as number) ?? 5,
            namespace: toolArgs.namespace as any,
          });
          return {
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    results.map((r) => ({
                      text: r.text?.slice(0, 500),
                      score: r.score?.toFixed(3),
                      namespace: r.namespace,
                      source: r.metadata?.sourceId,
                    })),
                    null,
                    2,
                  ),
                },
              ],
            },
          };
        }
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [
              {
                type: "text",
                text: "No RAG index available. Run 'aether init' first.",
              },
            ],
          },
        };
      }

      case "get_status": {
        const allAgents = rt.registry.getAll();
        const cacheStats = rt.agentRouter?.getCacheStats() ?? null;
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    version: VERSION,
                    workspace: workspacePath,
                    agents: {
                      total: allAgents.length,
                      idle: allAgents.filter((a) => a.status === "idle").length,
                      busy: allAgents.filter((a) => a.status === "busy").length,
                      byTier: {
                        master: allAgents.filter((a) => a.tier === "master")
                          .length,
                        manager: allAgents.filter((a) => a.tier === "manager")
                          .length,
                        worker: allAgents.filter((a) => a.tier === "worker")
                          .length,
                      },
                    },
                    activeContext:
                      rt.agentRouter?.getActiveContext() ?? "default",
                    contexts: rt.agentRouter?.getContextNames() ?? ["default"],
                    ragAvailable: rt.ragIndex !== null,
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

      case "switch_context": {
        const contextName = toolArgs.context as string;
        if (!contextName) {
          return {
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [
                { type: "text", text: "Error: context name is required" },
              ],
              isError: true,
            },
          };
        }

        const available = rt.agentRouter?.getContextNames() ?? [];
        if (!available.includes(contextName)) {
          return {
            jsonrpc: "2.0",
            id: req.id,
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

        rt.agentRouter?.setActiveContext(contextName);
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [
              { type: "text", text: `Switched to context: ${contextName}` },
            ],
          },
        };
      }

      case "get_config": {
        const path = toolArgs.path as string | undefined;
        if (path) {
          const value = rt.settingsManager.get(path);
          return {
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ path, value }, null, 2),
                },
              ],
            },
          };
        }
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [
              { type: "text", text: JSON.stringify(rt.settings, null, 2) },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: `Unknown tool: ${params.name}` },
        };
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      },
    };
  }
}

// ── Resource Read Handler ────────────────────────────────────

async function handleResourceRead(
  req: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const params = req.params as { uri: string };

  try {
    const rt = await ensureRuntime();

    // Handle parameterized URIs: aether://agents/{id}
    if (params.uri.startsWith("aether://agents/")) {
      const agentId = params.uri.slice("aether://agents/".length);
      const agent = rt.registry.getAll().find((a) => a.id === agentId);
      if (!agent) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: `Agent not found: ${agentId}` },
        };
      }
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          contents: [
            {
              uri: params.uri,
              mimeType: "application/json",
              text: JSON.stringify(agent, null, 2),
            },
          ],
        },
      };
    }

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
                text: JSON.stringify(
                  rt.registry.getAll().map((a) => ({
                    id: a.id,
                    name: a.name,
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

      case "aether://settings":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType: "application/json",
                text: JSON.stringify(rt.settings, null, 2),
              },
            ],
          },
        };

      case "aether://metrics": {
        const all = rt.registry.getAll();
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    agents: all.length,
                    byTier: {
                      master: all.filter((a) => a.tier === "master").length,
                      manager: all.filter((a) => a.tier === "manager").length,
                      worker: all.filter((a) => a.tier === "worker").length,
                    },
                    ragAvailable: rt.ragIndex !== null,
                    cacheStats: rt.agentRouter?.getCacheStats() ?? null,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: `Unknown resource: ${params.uri}` },
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

// ── Stdio Transport ──────────────────────────────────────────

function writeResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + "\n");
}

async function processLine(line: string): Promise<void> {
  if (!line.trim()) return;

  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeResponse({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error" },
    });
    return;
  }

  const response = await handleMethod(request);

  // Only send response for requests (not notifications without id)
  if (request.id !== undefined) {
    writeResponse(response);
  }
}

// ── Main Loop ────────────────────────────────────────────────

async function main(): Promise<void> {
  // Suppress runtime logs from going to stdout (they'd corrupt JSON-RPC)
  // The runtime writes logs to .aether/logs/ via SynapseLogger

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      await processLine(line);
    }
  }

  // Process any remaining data
  if (buffer.trim()) {
    await processLine(buffer);
  }

  // Cleanup
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`AETHER MCP fatal: ${err}\n`);
  process.exit(1);
});
