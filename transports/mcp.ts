// ─────────────────────────────────────────────────────────────
// AETHER Transport — MCP (Model Context Protocol)
// Connects to MCP servers via stdio or HTTP to invoke tools.
// Supports both stdio-based (spawn process) and HTTP-based
// (SSE/WebSocket) MCP servers.
// ─────────────────────────────────────────────────────────────

import { BaseTransport, type TransportHealthCheck } from "./base.ts";
import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  TransportConfig,
  MCPTransportConfig,
} from "../core/types.ts";

/** MCP JSON-RPC message envelope */
interface MCPMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class MCPTransport extends BaseTransport {
  private activeProcess: ReturnType<typeof Bun.spawn> | null = null;
  private messageId = 0;
  private pendingResponses: Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  > = new Map();
  private stdoutBuffer = "";

  constructor() {
    super("mcp");
  }

  async connect(config: TransportConfig): Promise<void> {
    const mcpConfig = config as MCPTransportConfig;

    if (mcpConfig.serverCommand) {
      // stdio-based MCP server — spawn and keep alive
      await this.connectStdio(mcpConfig);
    } else if (mcpConfig.serverUrl) {
      // HTTP-based MCP server — just verify reachability
      await this.connectHTTP(mcpConfig);
    } else {
      throw new Error(
        "MCP transport requires either serverCommand or serverUrl",
      );
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch {
        // Process may already be dead
      }
      this.activeProcess = null;
    }
    this.pendingResponses.clear();
    this.connected = false;
  }

  async execute(
    task: TaskRequest,
    agent: AgentDefinition,
    config: TransportConfig,
  ): Promise<TaskResult> {
    const mcpConfig = config as MCPTransportConfig;
    const startTime = Date.now();

    try {
      // Build tool arguments
      const toolArgs = this.buildToolArgs(task, mcpConfig);

      // Invoke the MCP tool
      let result: unknown;

      if (mcpConfig.serverCommand && this.activeProcess) {
        result = await this.invokeStdio(
          mcpConfig.toolName,
          toolArgs,
          mcpConfig.timeout,
        );
      } else if (mcpConfig.serverUrl) {
        result = await this.invokeHTTP(mcpConfig, toolArgs);
      } else {
        return this.failResult(
          task.id,
          agent.id,
          "MCP transport not connected",
          startTime,
        );
      }

      return this.successResult(task.id, agent.id, result, startTime);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failResult(
        task.id,
        agent.id,
        `MCP transport error: ${msg}`,
        startTime,
      );
    }
  }

  async healthCheck(config: TransportConfig): Promise<TransportHealthCheck> {
    const mcpConfig = config as MCPTransportConfig;
    const start = Date.now();

    try {
      if (mcpConfig.serverUrl) {
        const response = await fetch(mcpConfig.serverUrl, {
          method: "GET",
          signal: AbortSignal.timeout(5_000),
        });
        return {
          healthy: response.ok,
          latencyMs: Date.now() - start,
          details: `MCP HTTP server: ${response.status}`,
        };
      }

      if (mcpConfig.serverCommand) {
        // For stdio servers, check if the command exists
        const isWindows = process.platform === "win32";
        const lookupCmd = isWindows ? "where" : "which";
        const proc = Bun.spawn([lookupCmd, mcpConfig.serverCommand], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        return {
          healthy: exitCode === 0,
          latencyMs: Date.now() - start,
          details: exitCode === 0 ? "Command found" : "Command not found",
        };
      }

      return { healthy: false, latencyMs: 0, details: "No server configured" };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── stdio MCP ──────────────────────────────────────────────

  private async connectStdio(config: MCPTransportConfig): Promise<void> {
    this.activeProcess = Bun.spawn(
      [config.serverCommand!, ...(config.serverArgs ?? [])],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...config.env },
      },
    );

    // Start reading stdout in the background for JSON-RPC responses
    this.readStdoutLoop();

    // Send the MCP initialize handshake
    const initResult = await this.sendRPC("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aether", version: "0.1.0" },
    });

    if (!initResult) {
      throw new Error("MCP initialization handshake failed");
    }

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});
  }

  private async readStdoutLoop(): Promise<void> {
    if (!this.activeProcess?.stdout) return;

    const stdout = this.activeProcess.stdout;

    // Bun's stdout is a ReadableStream<Uint8Array>
    if (typeof stdout === "number") return; // fd number, can't read

    try {
      const reader = (stdout as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.stdoutBuffer += new TextDecoder().decode(value);

        // MCP uses newline-delimited JSON
        let newlineIdx: number;
        while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
          const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);

          if (!line) continue;

          try {
            const msg: MCPMessage = JSON.parse(line);
            this.handleMCPResponse(msg);
          } catch {
            // Invalid JSON line — skip
          }
        }
      }
    } catch {
      // Stream closed
    }
  }

  private handleMCPResponse(msg: MCPMessage): void {
    if (msg.id === undefined) return; // Notification, no pending request

    const pending = this.pendingResponses.get(Number(msg.id));
    if (!pending) return;

    this.pendingResponses.delete(Number(msg.id));

    if (msg.error) {
      pending.reject(
        new Error(`MCP error ${msg.error.code}: ${msg.error.message}`),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  private async sendRPC(
    method: string,
    params: Record<string, unknown>,
    timeout: number = 30_000,
  ): Promise<unknown> {
    if (!this.activeProcess) throw new Error("MCP process not running");

    const id = ++this.messageId;
    const msg: MCPMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`MCP RPC timeout after ${timeout}ms`));
      }, timeout);

      this.pendingResponses.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });

    // Write JSON-RPC message to stdin (Bun uses FileSink)
    const stdin = this.activeProcess.stdin;
    if (stdin && typeof stdin !== "number") {
      const data = JSON.stringify(msg) + "\n";
      (stdin as any).write(data);
      (stdin as any).flush?.();
    }

    return promise;
  }

  private sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (!this.activeProcess) return;

    const msg: MCPMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const stdin = this.activeProcess.stdin;
    if (stdin && typeof stdin !== "number") {
      const data = JSON.stringify(msg) + "\n";
      (stdin as any).write(data);
      (stdin as any).flush?.();
    }
  }

  private async invokeStdio(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown> {
    return this.sendRPC(
      "tools/call",
      {
        name: toolName,
        arguments: args,
      },
      timeout ?? 30_000,
    );
  }

  // ── HTTP MCP ───────────────────────────────────────────────

  private async connectHTTP(config: MCPTransportConfig): Promise<void> {
    // Verify the HTTP endpoint is reachable
    const response = await fetch(config.serverUrl!, {
      method: "GET",
      signal: AbortSignal.timeout(config.timeout ?? 10_000),
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP server not reachable: ${response.status}`);
    }
  }

  private async invokeHTTP(
    config: MCPTransportConfig,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const msg: MCPMessage = {
      jsonrpc: "2.0",
      id: ++this.messageId,
      method: "tools/call",
      params: {
        name: config.toolName,
        arguments: args,
      },
    };

    const response = await fetch(config.serverUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(config.timeout ?? 30_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MCP HTTP error ${response.status}: ${errText}`);
    }

    const result: MCPMessage = await response.json();

    if (result.error) {
      throw new Error(
        `MCP tool error ${result.error.code}: ${result.error.message}`,
      );
    }

    return result.result;
  }

  // ── Shared Helpers ─────────────────────────────────────────

  private buildToolArgs(
    task: TaskRequest,
    config: MCPTransportConfig,
  ): Record<string, unknown> {
    const args: Record<string, unknown> = {
      ...config.staticArgs,
    };

    if (config.argMapping) {
      for (const [taskField, argName] of Object.entries(config.argMapping)) {
        const value = this.getNestedValue(task, taskField);
        if (value !== undefined) {
          args[argName] = value;
        }
      }
    } else {
      // Default: pass description as "prompt" and context as-is
      args.prompt = task.description;
      args.context = task.context;
    }

    return args;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
