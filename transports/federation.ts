// ─────────────────────────────────────────────────────────────
// AETHER Transport — Federation
// Connects to another AETHER instance over WebSocket to execute
// tasks on remote agents. Enables distributed multi-instance
// agent networks — e.g. an image-generation AETHER instance
// acting as a peer master agent.
// ─────────────────────────────────────────────────────────────

import { BaseTransport, type TransportHealthCheck } from "./base.ts";
import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  TransportConfig,
  FederationTransportConfig,
} from "../core/types.ts";

/** Pending federated request tracker */
interface PendingFederatedRequest {
  resolve: (result: TaskResult) => void;
  reject: (err: Error) => void;
  timer: Timer;
}

export class FederationTransport extends BaseTransport {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, PendingFederatedRequest> = new Map();
  private localAgentId = "federation-bridge";

  constructor() {
    super("federation");
  }

  async connect(config: TransportConfig): Promise<void> {
    const fedConfig = config as FederationTransportConfig;

    return new Promise<void>((resolve, reject) => {
      const url = new URL(fedConfig.instanceUrl);
      url.searchParams.set("agentId", this.localAgentId);
      url.searchParams.set("channel", fedConfig.channel ?? "/federation");

      if (fedConfig.authToken) {
        url.searchParams.set("token", fedConfig.authToken);
      }

      this.ws = new WebSocket(url.toString());

      const connectTimeout = setTimeout(() => {
        this.ws?.close();
        reject(
          new Error(
            `Federation connection timed out to ${fedConfig.instanceUrl}`,
          ),
        );
      }, fedConfig.timeout ?? 10_000);

      this.ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(connectTimeout);
        reject(
          new Error(`Federation connection failed to ${fedConfig.instanceUrl}`),
        );
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.rejectAllPending(new Error("Federation connection closed"));
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending(new Error("Disconnecting from federation"));

    if (this.ws) {
      this.ws.close(1000, "Federation disconnect");
      this.ws = null;
    }
    this.connected = false;
  }

  async execute(
    task: TaskRequest,
    agent: AgentDefinition,
    config: TransportConfig,
  ): Promise<TaskResult> {
    const fedConfig = config as FederationTransportConfig;
    const startTime = Date.now();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Try to reconnect
      try {
        await this.connect(config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.failResult(
          task.id,
          agent.id,
          `Federation connection failed: ${msg}`,
          startTime,
        );
      }
    }

    const correlationId = crypto.randomUUID();
    const timeout = fedConfig.timeout ?? 60_000;

    // Build a BAP message for the remote instance
    const message = {
      id: crypto.randomUUID(),
      from: this.localAgentId,
      to: fedConfig.remoteAgentId,
      type: "task",
      payload: {
        id: task.id,
        description: task.description,
        context: task.context,
        priority: task.priority,
        requester: task.requester,
      },
      priority: task.priority,
      timestamp: Date.now(),
      correlationId,
    };

    return new Promise<TaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        resolve(
          this.failResult(
            task.id,
            agent.id,
            `Federation request timed out after ${timeout}ms`,
            startTime,
          ),
        );
      }, timeout);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      try {
        this.ws!.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(correlationId);
        const msg = err instanceof Error ? err.message : String(err);
        resolve(
          this.failResult(
            task.id,
            agent.id,
            `Federation send error: ${msg}`,
            startTime,
          ),
        );
      }
    });
  }

  async healthCheck(config: TransportConfig): Promise<TransportHealthCheck> {
    const fedConfig = config as FederationTransportConfig;
    const start = Date.now();

    try {
      // Try to hit the /status HTTP endpoint of the remote instance
      const httpUrl = fedConfig.instanceUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://");

      const statusUrl = new URL("/status", httpUrl);

      const response = await fetch(statusUrl.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          healthy: true,
          latencyMs: Date.now() - start,
          details: `Remote AETHER: ${data.connectedAgents ?? "?"} agents connected`,
        };
      }

      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Internals ──────────────────────────────────────────────

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    try {
      const data =
        typeof raw === "string"
          ? raw
          : new TextDecoder().decode(raw as ArrayBuffer);
      const message = JSON.parse(data);

      // Look for correlated response
      if (message.type === "result" && message.correlationId) {
        const pending = this.pendingRequests.get(message.correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(message.correlationId);

          const result: TaskResult = {
            requestId: message.payload?.requestId ?? message.correlationId,
            executor: message.from ?? "remote-agent",
            status: message.payload?.status ?? "success",
            output: message.payload?.output ?? message.payload,
            duration: message.payload?.duration ?? 0,
            tokensUsed: message.payload?.tokensUsed,
          };

          pending.resolve(result);
        }
      }
    } catch {
      // Malformed messages silently dropped
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
