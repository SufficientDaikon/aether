// ─────────────────────────────────────────────────────────────
// Aether-Link WebSocket Server
// Communication backbone for agent orchestration via Bun.serve()
// ─────────────────────────────────────────────────────────────

import { BAPCodec, BAPError } from "./codec.ts";
import type { AetherMessage } from "../core/types.ts";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/** Per-agent connection metadata */
interface AgentConnection {
  /** The raw Bun ServerWebSocket */
  ws: unknown; // ServerWebSocket<AgentWSData>
  /** Agent identifier */
  agentId: string;
  /** Channel the agent subscribed to */
  channel: string;
  /** Unix ms of last heartbeat received */
  lastHeartbeat: number;
  /** True while the socket is open */
  connected: boolean;
}

/** Data attached to each WebSocket via Bun's upgrade mechanism */
interface AgentWSData {
  agentId: string;
  channel: string;
}

/** Metrics snapshot */
export interface ServerMetrics {
  connectedAgents: number;
  messageCount: number;
  messagesPerSecond: number;
  uptimeMs: number;
  channels: Record<string, number>;
}

/** Options for AetherLinkServer constructor */
export interface AetherLinkServerOptions {
  /** Max connection attempts per IP within the rate limit window (default: 100) */
  rateLimitMax?: number;
  /** Rate limit window in milliseconds (default: 60000) */
  rateLimitWindow?: number;
}

export class AetherLinkServer {
  private port: number;
  private logDir: string;
  private logFile: string;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private connections: Map<string, AgentConnection> = new Map();
  private channels: Map<string, Set<string>> = new Map();
  private messageCount = 0;
  private startTime = 0;
  private heartbeatInterval: Timer | null = null;
  private metricsWindow: number[] = []; // timestamps of recent messages for throughput
  private registry: Map<string, unknown> | null = null;
  private authToken: string | null = null;
  private rateLimiter: Map<string, number[]> = new Map();
  private readonly RATE_LIMIT_WINDOW: number;
  private readonly RATE_LIMIT_MAX: number;
  private healthCheckFn: (() => Record<string, unknown>) | null = null;

  constructor(
    port: number = 9999,
    logDir: string = ".aether/logs",
    options?: AetherLinkServerOptions,
  ) {
    this.port = port;
    this.logDir = logDir;
    this.RATE_LIMIT_WINDOW = options?.rateLimitWindow ?? 60_000;
    this.RATE_LIMIT_MAX = options?.rateLimitMax ?? 100;
    this.logFile = join(logDir, "synapse.log");
  }

  // ── Lifecycle ────────────────────────────────────────────

  async start(): Promise<void> {
    // Ensure log directory exists
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    this.startTime = Date.now();

    const self = this;

    this.server = Bun.serve<AgentWSData>({
      port: this.port,
      // ── HTTP routes ──────────────────────────────────────
      fetch(req, server) {
        const url = new URL(req.url);

        // GET /health — quick health check
        if (url.pathname === "/health" && req.method === "GET") {
          const health = self.healthCheckFn
            ? self.healthCheckFn()
            : { status: "ok" };
          const isHealthy = (health as any).status !== "error";
          return Response.json(health, { status: isHealthy ? 200 : 503 });
        }

        // GET /metrics — Prometheus-compatible text format
        if (url.pathname === "/metrics" && req.method === "GET") {
          return new Response(self.getPrometheusMetrics(), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        // GET /status — operational metrics (existing)
        if (url.pathname === "/status" && req.method === "GET") {
          return Response.json(self.getMetrics());
        }

        // GET /registry — agent registry dump (existing)
        if (url.pathname === "/registry" && req.method === "GET") {
          if (self.registry) {
            const entries = Object.fromEntries(self.registry);
            return Response.json(entries);
          }
          return Response.json({ agents: [] });
        }

        // ── WebSocket upgrade path ─────────────────────────────

        // Rate limiting per IP
        const clientIP = server.requestIP(req)?.address ?? "unknown";
        if (self.isRateLimited(clientIP)) {
          self.log("REJECT", `Rate limited: ${clientIP}`);
          return new Response("Too many connection attempts", { status: 429 });
        }
        self.recordConnectionAttempt(clientIP);

        // Origin validation — only allow localhost origins
        const origin = req.headers.get("origin");
        if (origin) {
          const allowedOrigins = ["localhost", "127.0.0.1", "[::1]", "::1"];
          try {
            const originHost = new URL(origin).hostname;
            if (!allowedOrigins.includes(originHost)) {
              self.log("REJECT", `Invalid origin: ${origin} from ${clientIP}`);
              return new Response("Forbidden origin", { status: 403 });
            }
          } catch {
            self.log("REJECT", `Malformed origin: ${origin} from ${clientIP}`);
            return new Response("Forbidden origin", { status: 403 });
          }
        }

        // Auth token validation
        if (self.authToken) {
          const token = url.searchParams.get("token");
          if (token !== self.authToken) {
            self.log("REJECT", `Invalid auth token from ${clientIP}`);
            return new Response("Unauthorized", { status: 401 });
          }
        }

        // Agent ID required
        const agentId = url.searchParams.get("agentId");
        const channel = url.searchParams.get("channel") ?? "/workers/default";

        if (!agentId) {
          return new Response("Missing agentId query parameter", {
            status: 400,
          });
        }

        // Validate agentId format (alphanumeric, hyphens, underscores, dots — max 128 chars)
        if (!/^[a-zA-Z0-9._-]{1,128}$/.test(agentId)) {
          self.log(
            "REJECT",
            `Invalid agentId format: ${agentId} from ${clientIP}`,
          );
          return new Response("Invalid agentId format", { status: 400 });
        }

        const upgraded = server.upgrade(req, {
          data: { agentId, channel },
        });

        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        // Bun returns undefined on successful upgrade
        return undefined as unknown as Response;
      },

      // ── WebSocket handlers ───────────────────────────────
      websocket: {
        open(ws) {
          const { agentId, channel } = ws.data;

          // Track connection
          self.connections.set(agentId, {
            ws,
            agentId,
            channel,
            lastHeartbeat: Date.now(),
            connected: true,
          });

          // Track channel membership
          if (!self.channels.has(channel)) {
            self.channels.set(channel, new Set());
          }
          self.channels.get(channel)!.add(agentId);

          // Subscribe to the channel topic for pub/sub
          ws.subscribe(channel);

          self.log("CONNECT", `${agentId} joined ${channel}`);
        },

        message(ws, raw) {
          const { agentId } = ws.data;
          // BAP-02: accept binary frames directly — no string conversion
          const data =
            typeof raw === "string"
              ? raw // legacy BAP-01 hex string (backward compat)
              : new Uint8Array(raw instanceof ArrayBuffer ? raw : raw.buffer);

          try {
            const message = BAPCodec.decode(data);

            // Update heartbeat timestamp on any message
            const conn = self.connections.get(agentId);
            if (conn) {
              conn.lastHeartbeat = Date.now();
            }

            self.messageCount++;
            self.metricsWindow.push(Date.now());

            // Log the message
            self.logMessage(message);

            // Handle heartbeats silently (no routing needed)
            if (message.type === "heartbeat") {
              return;
            }

            // Route the message
            if (message.to === "*") {
              // Broadcast to the sender's channel
              const senderConn = self.connections.get(message.from);
              if (senderConn) {
                self.broadcastToChannel(
                  senderConn.channel,
                  message,
                  message.from,
                );
              }
            } else {
              // Point-to-point delivery
              self.sendToAgent(message.to, message);
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            self.log("ERROR", `Bad message from ${agentId}: ${errorMsg}`);
            ws.send(JSON.stringify({ error: errorMsg }));
          }
        },

        close(ws, code, reason) {
          const { agentId, channel } = ws.data;

          // Remove from connection tracking
          self.connections.delete(agentId);

          // Remove from channel
          const channelSet = self.channels.get(channel);
          if (channelSet) {
            channelSet.delete(agentId);
            if (channelSet.size === 0) {
              self.channels.delete(channel);
            }
          }

          self.log(
            "DISCONNECT",
            `${agentId} left ${channel} (code=${code}, reason=${reason ?? "none"})`,
          );
        },

        drain(ws) {
          // Backpressure relief — no-op, Bun handles buffering
        },

        // Max payload 16 MB
        maxPayloadLength: 16 * 1024 * 1024,
        // Idle timeout 120s (server-side)
        idleTimeout: 120,
      },
    });

    // Start heartbeat checker — every 5 seconds, prune agents silent for 30s
    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, 5_000);

    this.log("SERVER", `Aether-Link started on port ${this.port}`);
  }

  async stop(): Promise<void> {
    // Stop heartbeat checker
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all WebSocket connections gracefully
    for (const [agentId, conn] of this.connections) {
      try {
        const ws = conn.ws as { close(code?: number, reason?: string): void };
        ws.close(1001, "Server shutting down");
      } catch {
        // Socket may already be closed
      }
    }
    this.connections.clear();
    this.channels.clear();
    this.rateLimiter.clear();

    // Stop the HTTP/WS server
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }

    this.log("SERVER", "Aether-Link stopped");
  }

  // ── Public API ───────────────────────────────────────────

  /** Broadcast a message to every agent in a channel */
  broadcast(channel: string, message: AetherMessage): void {
    this.broadcastToChannel(channel, message);
  }

  /** Send a message to a specific agent by ID */
  send(agentId: string, message: AetherMessage): void {
    this.sendToAgent(agentId, message);
  }

  /** List all currently connected agent IDs */
  getConnectedAgents(): string[] {
    return Array.from(this.connections.keys()).filter(
      (id) => this.connections.get(id)!.connected,
    );
  }

  /** Return current server metrics */
  getMetrics(): ServerMetrics {
    const now = Date.now();

    // Prune metrics window to last 60 seconds
    this.metricsWindow = this.metricsWindow.filter((t) => now - t < 60_000);

    // Compute per-channel counts
    const channelCounts: Record<string, number> = {};
    for (const [ch, agents] of this.channels) {
      channelCounts[ch] = agents.size;
    }

    return {
      connectedAgents: this.connections.size,
      messageCount: this.messageCount,
      messagesPerSecond:
        this.metricsWindow.length > 0
          ? Math.round((this.metricsWindow.length / 60) * 100) / 100
          : 0,
      uptimeMs: now - this.startTime,
      channels: channelCounts,
    };
  }

  /** Inject a registry for the /registry HTTP endpoint */
  setRegistry(registry: Map<string, unknown>): void {
    this.registry = registry;
  }

  /** Set the auth token for WebSocket connection validation */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /** Set a health check callback for /health endpoint */
  setHealthCheck(fn: () => Record<string, unknown>): void {
    this.healthCheckFn = fn;
  }

  // ── Internal routing ─────────────────────────────────────

  private broadcastToChannel(
    channel: string,
    message: AetherMessage,
    excludeAgentId?: string,
  ): void {
    const agentIds = this.channels.get(channel);
    if (!agentIds) return;

    // BAP-02: encode returns Uint8Array — send as binary frame
    const encoded = BAPCodec.encode(message);

    for (const id of agentIds) {
      if (id === excludeAgentId) continue;
      const conn = this.connections.get(id);
      if (conn?.connected) {
        try {
          (conn.ws as any).send(encoded);
        } catch {
          this.log("ERROR", `Failed to send to ${id}`);
        }
      }
    }
  }

  private sendToAgent(agentId: string, message: AetherMessage): void {
    const conn = this.connections.get(agentId);
    if (!conn || !conn.connected) {
      this.log("WARN", `Agent ${agentId} not connected — message dropped`);
      return;
    }

    try {
      // BAP-02: encode returns Uint8Array — send as binary frame
      const encoded = BAPCodec.encode(message);
      (conn.ws as any).send(encoded);
    } catch {
      this.log("ERROR", `Failed to send to ${agentId}`);
    }
  }

  // ── Heartbeat management ─────────────────────────────────

  private checkHeartbeats(): void {
    const now = Date.now();
    const timeout = 30_000; // 30 seconds

    for (const [agentId, conn] of this.connections) {
      if (conn.connected && now - conn.lastHeartbeat > timeout) {
        conn.connected = false;
        this.log(
          "HEARTBEAT",
          `${agentId} timed out (no heartbeat for ${timeout / 1000}s)`,
        );

        // Close the socket
        try {
          const ws = conn.ws as { close(code?: number, reason?: string): void };
          ws.close(4001, "Heartbeat timeout");
        } catch {
          // Already closed
        }

        // Cleanup will be handled by the close handler
      }
    }
  }

  // ── Rate limiting ──────────────────────────────────────

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const attempts = this.rateLimiter.get(ip);
    if (!attempts) return false;

    // Filter to only recent attempts within the window
    const recent = attempts.filter((t) => now - t < this.RATE_LIMIT_WINDOW);
    return recent.length >= this.RATE_LIMIT_MAX;
  }

  private recordConnectionAttempt(ip: string): void {
    const now = Date.now();
    let attempts = this.rateLimiter.get(ip);
    if (!attempts) {
      attempts = [];
      this.rateLimiter.set(ip, attempts);
    }
    attempts.push(now);

    // Prune old entries
    const cutoff = now - this.RATE_LIMIT_WINDOW;
    while (attempts.length > 0 && attempts[0] < cutoff) {
      attempts.shift();
    }
  }

  // ── Prometheus metrics ─────────────────────────────────

  private getPrometheusMetrics(): string {
    const metrics = this.getMetrics();
    const lines: string[] = [];

    lines.push(
      `# HELP aether_connected_agents Number of currently connected agents`,
    );
    lines.push(`# TYPE aether_connected_agents gauge`);
    lines.push(`aether_connected_agents ${metrics.connectedAgents}`);

    lines.push(`# HELP aether_messages_total Total messages processed`);
    lines.push(`# TYPE aether_messages_total counter`);
    lines.push(`aether_messages_total ${metrics.messageCount}`);

    lines.push(`# HELP aether_messages_per_second Current message throughput`);
    lines.push(`# TYPE aether_messages_per_second gauge`);
    lines.push(`aether_messages_per_second ${metrics.messagesPerSecond}`);

    lines.push(`# HELP aether_uptime_seconds Server uptime in seconds`);
    lines.push(`# TYPE aether_uptime_seconds gauge`);
    lines.push(`aether_uptime_seconds ${Math.round(metrics.uptimeMs / 1000)}`);

    for (const [channel, count] of Object.entries(metrics.channels)) {
      lines.push(`aether_channel_agents{channel="${channel}"} ${count}`);
    }

    return lines.join("\n") + "\n";
  }

  // ── Logging ──────────────────────────────────────────────

  private log(category: string, detail: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${category}] ${detail}\n`;
    try {
      appendFileSync(this.logFile, line);
    } catch {
      // If logging fails, write to stderr as fallback
      process.stderr.write(line);
    }
  }

  private logMessage(message: AetherMessage): void {
    const summary = `${message.from} -> ${message.to} | type=${message.type} priority=${message.priority} id=${message.id}`;
    this.log("MSG", summary);
  }
}
