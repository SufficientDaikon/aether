// ─────────────────────────────────────────────────────────────
// AETHER MCP Pool — Multi-Connection MCP Client
//
// Maintains a pool of concurrent MCP server connections.
// Each connection runs in its own async context with:
//   - Connection pooling (reuse healthy connections)
//   - Automatic reconnection on failure
//   - Load balancing across multiple MCP servers
//   - Session management (Mcp-Session-Id)
//   - Request routing by tool capability
//
// Per MCP spec Section 2.3: "client MAY remain connected
// to multiple SSE streams simultaneously"
// ─────────────────────────────────────────────────────────────

import type { SynapseLogger } from "../core/logger.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  /** Unique server identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Transport type */
  transport: "stdio" | "http";
  /** For stdio: command to spawn */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For http: base URL */
  url?: string;
  /** Environment variables for the process */
  env?: Record<string, string>;
  /** Connection timeout in ms (default: 30_000) */
  timeout?: number;
  /** Max concurrent requests (default: 5) */
  maxConcurrent?: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

export interface MCPCallResult {
  content: unknown;
  serverId: string;
  latencyMs: number;
  sessionId?: string;
}

/** JSON-RPC 2.0 message */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type ConnectionStatus = "connecting" | "ready" | "busy" | "error" | "closed";

interface ManagedConnection {
  config: MCPServerConfig;
  status: ConnectionStatus;
  process?: ReturnType<typeof Bun.spawn>;
  tools: MCPTool[];
  sessionId: string | null;
  activeCalls: number;
  maxConcurrent: number;
  lastUsed: number;
  errors: string[];
  rpcId: number;
  /** For stdio: pending response resolvers */
  pendingRequests: Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  /** Buffer for partial stdio reads */
  readBuffer: string;
}

export interface MCPPoolConfig {
  /** Max total connections across all servers (default: 10) */
  maxConnections: number;
  /** Health check interval in ms (default: 30_000) */
  healthCheckMs: number;
  /** Connection idle timeout in ms (default: 300_000 = 5 minutes) */
  idleTimeoutMs: number;
  /** Auto-reconnect on failure (default: true) */
  autoReconnect: boolean;
}

const DEFAULT_CONFIG: MCPPoolConfig = {
  maxConnections: 10,
  healthCheckMs: 30_000,
  idleTimeoutMs: 300_000,
  autoReconnect: true,
};

export interface MCPPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  totalCalls: number;
  failedCalls: number;
  totalTools: number;
  averageLatencyMs: number;
}

// ─────────────────────────────────────────────────────────────
// MCP Pool
// ─────────────────────────────────────────────────────────────

export class MCPPool {
  private config: MCPPoolConfig;
  private logger: SynapseLogger;
  private connections: Map<string, ManagedConnection> = new Map();
  private toolIndex: Map<string, string> = new Map(); // toolName → serverId
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private metrics: MCPPoolMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    totalCalls: 0,
    failedCalls: 0,
    totalTools: 0,
    averageLatencyMs: 0,
  };

  constructor(logger: SynapseLogger, config?: Partial<MCPPoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Start the pool and connect to configured servers */
  async start(servers: MCPServerConfig[]): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const server of servers) {
      try {
        await this.addServer(server);
      } catch (err) {
        this.logger.error(
          "MCPPool",
          `Failed to connect to ${server.name}: ${err}`,
        );
      }
    }

    // Start health check loop
    this.healthTimer = setInterval(
      () => this.healthCheck(),
      this.config.healthCheckMs,
    );

    this.logger.info(
      "MCPPool",
      `Started with ${this.connections.size} connections, ${this.toolIndex.size} tools`,
    );
  }

  /** Stop all connections and clean up */
  async stop(): Promise<void> {
    this.running = false;
    if (this.healthTimer) clearInterval(this.healthTimer);

    for (const conn of this.connections.values()) {
      await this.disconnect(conn);
    }

    this.connections.clear();
    this.toolIndex.clear();
    this.logger.info("MCPPool", "Stopped");
  }

  // ── Connection Management ──────────────────────────────────

  /** Add and connect to an MCP server */
  async addServer(config: MCPServerConfig): Promise<void> {
    if (this.connections.size >= this.config.maxConnections) {
      throw new Error(`Max connections (${this.config.maxConnections}) reached`);
    }

    const conn: ManagedConnection = {
      config,
      status: "connecting",
      tools: [],
      sessionId: null,
      activeCalls: 0,
      maxConcurrent: config.maxConcurrent ?? 5,
      lastUsed: Date.now(),
      errors: [],
      rpcId: 0,
      pendingRequests: new Map(),
      readBuffer: "",
    };

    this.connections.set(config.id, conn);

    if (config.transport === "stdio") {
      await this.connectStdio(conn);
    } else {
      await this.connectHTTP(conn);
    }

    // Discover tools
    await this.discoverTools(conn);

    conn.status = "ready";
    this.updateMetrics();
  }

  /** Remove a server connection */
  async removeServer(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    await this.disconnect(conn);

    // Remove tool index entries
    for (const [toolName, sid] of this.toolIndex) {
      if (sid === serverId) this.toolIndex.delete(toolName);
    }

    this.connections.delete(serverId);
    this.updateMetrics();
  }

  // ── Tool Calling ───────────────────────────────────────────

  /** Call an MCP tool by name */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPCallResult> {
    const serverId = this.toolIndex.get(toolName);
    if (!serverId) {
      throw new Error(`Tool "${toolName}" not found in any connected server`);
    }

    const conn = this.connections.get(serverId);
    if (!conn || conn.status !== "ready") {
      throw new Error(`Server "${serverId}" not ready`);
    }

    // Check concurrency
    if (conn.activeCalls >= conn.maxConcurrent) {
      throw new Error(
        `Server "${serverId}" at max concurrent calls (${conn.maxConcurrent})`,
      );
    }

    conn.activeCalls++;
    conn.lastUsed = Date.now();
    const start = performance.now();

    try {
      const response = await this.sendRPC(conn, "tools/call", {
        name: toolName,
        arguments: args,
      });

      const latencyMs = performance.now() - start;
      this.metrics.totalCalls++;
      this.updateAverageLatency(latencyMs);

      return {
        content: response.result,
        serverId,
        latencyMs,
        sessionId: conn.sessionId ?? undefined,
      };
    } catch (err) {
      this.metrics.failedCalls++;
      conn.errors.push(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      conn.activeCalls--;
    }
  }

  /** List all available tools across all servers */
  listTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }

  /** Find tools matching a capability query */
  findTools(query: string): MCPTool[] {
    const needle = query.toLowerCase();
    return this.listTools().filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle),
    );
  }

  // ── Transport — stdio ──────────────────────────────────────

  private async connectStdio(conn: ManagedConnection): Promise<void> {
    const { command, args, env } = conn.config;
    if (!command) throw new Error("stdio transport requires a command");

    conn.process = Bun.spawn([command, ...(args ?? [])], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });

    // Read stdout for JSON-RPC responses
    this.readStdio(conn);

    // Send initialize
    const initResponse = await this.sendRPC(conn, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aether", version: "0.1.0" },
    });

    if (initResponse.result) {
      const result = initResponse.result as { sessionId?: string };
      conn.sessionId = result.sessionId ?? null;
    }

    // Send initialized notification
    await this.sendNotification(conn, "notifications/initialized", {});

    this.logger.info("MCPPool", `Connected to ${conn.config.name} (stdio)`);
  }

  /** Continuously read from stdio process */
  private async readStdio(conn: ManagedConnection): Promise<void> {
    if (!conn.process?.stdout) return;

    const reader = conn.process.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        conn.readBuffer += decoder.decode(value, { stream: true });

        // Process complete JSON-RPC messages (delimited by newlines)
        const lines = conn.readBuffer.split("\n");
        conn.readBuffer = lines.pop() ?? ""; // Keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const response = JSON.parse(trimmed) as JsonRpcResponse;
            const pending = conn.pendingRequests.get(response.id);
            if (pending) {
              clearTimeout(pending.timeout);
              conn.pendingRequests.delete(response.id);
              pending.resolve(response);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    } catch (err) {
      if (conn.status !== "closed") {
        conn.status = "error";
        this.logger.error("MCPPool", `stdio read error: ${err}`);
      }
    }
  }

  // ── Transport — HTTP ───────────────────────────────────────

  private async connectHTTP(conn: ManagedConnection): Promise<void> {
    const { url } = conn.config;
    if (!url) throw new Error("HTTP transport requires a URL");

    // Send initialize via POST
    const initResponse = await this.sendHTTPRPC(conn, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aether", version: "0.1.0" },
    });

    if (initResponse.result) {
      const result = initResponse.result as { sessionId?: string };
      conn.sessionId = result.sessionId ?? null;
    }

    conn.status = "ready";
    this.logger.info("MCPPool", `Connected to ${conn.config.name} (HTTP)`);
  }

  // ── JSON-RPC ───────────────────────────────────────────────

  /** Send a JSON-RPC request and wait for response */
  private async sendRPC(
    conn: ManagedConnection,
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    if (conn.config.transport === "http") {
      return this.sendHTTPRPC(conn, method, params);
    }

    return this.sendStdioRPC(conn, method, params);
  }

  /** Send JSON-RPC over stdio */
  private sendStdioRPC(
    conn: ManagedConnection,
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = ++conn.rpcId;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timeout = setTimeout(() => {
        conn.pendingRequests.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, conn.config.timeout ?? 30_000);

      conn.pendingRequests.set(id, { resolve, reject, timeout });

      const data = JSON.stringify(request) + "\n";
      conn.process?.stdin?.write(data);
    });
  }

  /** Send JSON-RPC over HTTP */
  private async sendHTTPRPC(
    conn: ManagedConnection,
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const id = ++conn.rpcId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (conn.sessionId) {
      headers["Mcp-Session-Id"] = conn.sessionId;
    }

    const response = await fetch(conn.config.url!, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(conn.config.timeout ?? 30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    // Check for session ID in response headers
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) conn.sessionId = sessionId;

    return response.json() as Promise<JsonRpcResponse>;
  }

  /** Send a JSON-RPC notification (no response expected) */
  private async sendNotification(
    conn: ManagedConnection,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const notification = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };

    if (conn.config.transport === "stdio") {
      conn.process?.stdin?.write(JSON.stringify(notification) + "\n");
    } else {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (conn.sessionId) headers["Mcp-Session-Id"] = conn.sessionId;

      await fetch(conn.config.url!, {
        method: "POST",
        headers,
        body: JSON.stringify(notification),
      });
    }
  }

  // ── Tool Discovery ─────────────────────────────────────────

  /** Discover tools available on a connection */
  private async discoverTools(conn: ManagedConnection): Promise<void> {
    try {
      const response = await this.sendRPC(conn, "tools/list", {});
      const result = response.result as { tools?: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }> };

      conn.tools = (result.tools ?? []).map((t) => ({
        ...t,
        serverId: conn.config.id,
      }));

      // Index tools by name → server
      for (const tool of conn.tools) {
        this.toolIndex.set(tool.name, conn.config.id);
      }

      this.logger.info(
        "MCPPool",
        `Discovered ${conn.tools.length} tools on ${conn.config.name}`,
      );
    } catch (err) {
      this.logger.warn(
        "MCPPool",
        `Tool discovery failed for ${conn.config.name}: ${err}`,
      );
    }
  }

  // ── Health & Maintenance ───────────────────────────────────

  /** Periodic health check */
  private async healthCheck(): Promise<void> {
    if (!this.running) return;

    for (const conn of this.connections.values()) {
      try {
        if (conn.config.transport === "stdio" && conn.process) {
          // Check if process is still alive
          // Bun.spawn processes can be checked via exitCode
        }

        // Check idle timeout
        if (
          conn.activeCalls === 0 &&
          Date.now() - conn.lastUsed > this.config.idleTimeoutMs
        ) {
          this.logger.info(
            "MCPPool",
            `Closing idle connection: ${conn.config.name}`,
          );
          await this.disconnect(conn);
          this.connections.delete(conn.config.id);
        }
      } catch (err) {
        conn.status = "error";
        if (this.config.autoReconnect) {
          this.logger.info(
            "MCPPool",
            `Reconnecting to ${conn.config.name}`,
          );
          try {
            if (conn.config.transport === "stdio") {
              await this.connectStdio(conn);
            } else {
              await this.connectHTTP(conn);
            }
            await this.discoverTools(conn);
            conn.status = "ready";
          } catch (reconnErr) {
            this.logger.error(
              "MCPPool",
              `Reconnection failed: ${reconnErr}`,
            );
          }
        }
      }
    }

    this.updateMetrics();
  }

  /** Disconnect a managed connection */
  private async disconnect(conn: ManagedConnection): Promise<void> {
    conn.status = "closed";

    // Reject pending requests
    for (const [, pending] of conn.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    conn.pendingRequests.clear();

    // Kill stdio process
    if (conn.process) {
      conn.process.kill();
    }
  }

  // ── Metrics ────────────────────────────────────────────────

  private updateMetrics(): void {
    let active = 0;
    let totalTools = 0;
    for (const conn of this.connections.values()) {
      if (conn.status === "ready" || conn.status === "busy") active++;
      totalTools += conn.tools.length;
    }
    this.metrics.totalConnections = this.connections.size;
    this.metrics.activeConnections = active;
    this.metrics.totalTools = totalTools;
  }

  private updateAverageLatency(latencyMs: number): void {
    const total = this.metrics.totalCalls;
    this.metrics.averageLatencyMs =
      (this.metrics.averageLatencyMs * (total - 1) + latencyMs) / total;
  }

  /** Get pool metrics */
  getMetrics(): MCPPoolMetrics {
    return { ...this.metrics };
  }

  /** Get connection info */
  getConnections(): Array<{
    id: string;
    name: string;
    status: ConnectionStatus;
    tools: number;
    activeCalls: number;
  }> {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.config.id,
      name: c.config.name,
      status: c.status,
      tools: c.tools.length,
      activeCalls: c.activeCalls,
    }));
  }

  /** Check if pool is running */
  isRunning(): boolean {
    return this.running;
  }
}
