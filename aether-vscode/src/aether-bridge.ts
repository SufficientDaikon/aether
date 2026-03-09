// ─────────────────────────────────────────────────────────────
// AETHER Bridge — Extension ↔ Runtime Communication
//
// Spawns bin/aether-mcp.ts as a child process and communicates
// via JSON-RPC over stdio. This keeps AETHER's Bun runtime
// separate from VS Code's Node.js process.
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { EventEmitter } from "node:events";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AetherBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private runtimePath: string;
  private output: vscode.OutputChannel;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private connected = false;
  private requestTimeout = 30_000; // 30 seconds default

  constructor(runtimePath: string, output: vscode.OutputChannel) {
    super();
    this.runtimePath = runtimePath;
    this.output = output;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;

    // Find bun executable
    const bunPath = await this.findBun();
    if (!bunPath) {
      throw new Error(
        "Could not find 'bun' executable. Install Bun (https://bun.sh) and ensure it's in PATH.",
      );
    }

    // Resolve the MCP entrypoint
    const mcpScript = this.resolveMcpScript();

    this.output.appendLine(`Spawning: ${bunPath} run ${mcpScript}`);

    const args = ["run", mcpScript];
    if (this.runtimePath) {
      args.push("--workspace", this.runtimePath);
    }

    this.process = spawn(bunPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.runtimePath || undefined,
      env: { ...process.env },
    });

    // Handle stdout (JSON-RPC responses)
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.onData(chunk.toString());
    });

    // Handle stderr (runtime logs)
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.output.appendLine(`[runtime] ${chunk.toString().trim()}`);
    });

    this.process.on("exit", (code) => {
      this.output.appendLine(`AETHER process exited with code ${code}`);
      this.connected = false;
      this.rejectAllPending(new Error(`Process exited with code ${code}`));
      this.emit("disconnected");
    });

    this.process.on("error", (err) => {
      this.output.appendLine(`AETHER process error: ${err.message}`);
      this.connected = false;
      this.emit("error", err);
    });

    // Send initialize handshake
    const initResult = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aether-vscode", version: "0.1.0" },
    });

    this.connected = true;
    this.output.appendLine(`MCP initialized: ${JSON.stringify(initResult)}`);

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});

    this.emit("connected");
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.buffer = "";
    this.rejectAllPending(new Error("Bridge disconnected"));
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Call an MCP tool by name. Returns the text content of the result.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<string | null> {
    const result = (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    if (!result?.content?.length) return null;

    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (result.isError) {
      this.output.appendLine(`Tool error [${name}]: ${text}`);
    }

    return text;
  }

  /**
   * Read an MCP resource by URI.
   */
  async readResource(uri: string): Promise<string | null> {
    const result = (await this.sendRequest("resources/read", { uri })) as {
      contents?: Array<{ text: string }>;
    };

    if (!result?.contents?.length) return null;
    return result.contents[0].text;
  }

  /**
   * List available tools.
   */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const result = (await this.sendRequest("tools/list", {})) as {
      tools?: Array<{ name: string; description: string }>;
    };
    return result?.tools ?? [];
  }

  // ── JSON-RPC Transport ─────────────────────────────────────

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Only the initialize handshake is allowed before connected=true
      if (method !== "initialize" && !this.connected) {
        reject(new Error("Bridge not connected"));
        return;
      }
      if (!this.process?.stdin?.writable) {
        reject(new Error("Bridge not connected"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Request timed out: ${method} (${this.requestTimeout}ms)`),
        );
      }, this.requestTimeout);

      this.pending.set(id, { resolve, reject, timer });

      const json = JSON.stringify(request) + "\n";
      this.process.stdin.write(json);
    });
  }

  private sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (!this.process?.stdin?.writable) return;

    const notification = { jsonrpc: "2.0", method, params };
    this.process.stdin.write(JSON.stringify(notification) + "\n");
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        this.handleResponse(response);
      } catch {
        this.output.appendLine(
          `Invalid JSON from runtime: ${line.slice(0, 200)}`,
        );
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === undefined) {
      // Server-initiated notification
      this.emit("notification", response);
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      this.output.appendLine(`Unexpected response id: ${response.id}`);
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(
        new Error(`${response.error.code}: ${response.error.message}`),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  // ── Helpers ────────────────────────────────────────────────

  private resolveMcpScript(): string {
    // Try workspace-relative first, then global install
    if (this.runtimePath) {
      const local = join(this.runtimePath, "bin", "aether-mcp.ts");
      return local;
    }
    // Fall back to globally installed aether-mcp
    return "aether-mcp";
  }

  private async findBun(): Promise<string | null> {
    const isWin = process.platform === "win32";
    const { execSync } = await import("node:child_process");

    // Try platform-appropriate lookup
    try {
      const cmd = isWin ? "where.exe bun" : "which bun";
      const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
      const lines = result
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (isWin) {
        // On Windows spawn() requires an executable binary (.exe), not a .cmd shim
        const exe = lines.find((l) => l.toLowerCase().endsWith(".exe"));
        if (exe) return exe;
        // .cmd works only with shell:true; skip and fall through to known paths
      } else if (lines.length > 0) {
        return lines[0];
      }
    } catch {
      // Command not found — fall through to known paths
    }

    // Try common install locations
    const { statSync } = await import("node:fs");
    const candidates = isWin
      ? [
          join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"),
          join(process.env.LOCALAPPDATA ?? "", "bun", "bun.exe"),
        ]
      : [
          join(process.env.HOME ?? "", ".bun", "bin", "bun"),
          "/usr/local/bin/bun",
          "/opt/homebrew/bin/bun",
        ];

    for (const p of candidates) {
      try {
        statSync(p);
        return p;
      } catch {
        continue;
      }
    }
    return null;
  }
}
