// ─────────────────────────────────────────────────────────────
// Aether-Link WebSocket Client
// Agent-side connector with auto-reconnect and request-response
// ─────────────────────────────────────────────────────────────

import { BAPCodec } from "./codec.ts";
import type { AetherMessage, MessageType, Priority } from "../core/types.ts";

/** Pending request tracker for the request-response pattern */
interface PendingRequest {
  resolve: (msg: AetherMessage) => void;
  reject: (err: Error) => void;
  timer: Timer;
}

export class AetherLinkClient {
  private ws: WebSocket | null = null;
  private agentId: string;
  private channel: string;
  private serverUrl: string;
  private authToken: string | undefined;
  private handlers: Map<MessageType, Array<(msg: AetherMessage) => void>> =
    new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private heartbeatTimer: Timer | null = null;
  private intentionalDisconnect = false;

  constructor(
    agentId: string,
    channel: string,
    serverUrl: string = "ws://localhost:9999",
    authToken?: string,
  ) {
    this.agentId = agentId;
    this.channel = channel;
    this.serverUrl = serverUrl;
    this.authToken = authToken;
  }

  // ── Connection ───────────────────────────────────────────

  /** Connect to the Aether-Link server */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        agentId: this.agentId,
        channel: this.channel,
      });
      if (this.authToken) {
        params.set("token", this.authToken);
      }
      const url = `${this.serverUrl}?${params.toString()}`;

      this.ws = new WebSocket(url);
      this.intentionalDisconnect = false;

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        resolve();
      };

      this.ws.onerror = (event) => {
        // On first connect attempt, reject the promise
        if (
          this.reconnectAttempts === 0 &&
          this.ws?.readyState !== WebSocket.OPEN
        ) {
          reject(new Error(`WebSocket connection failed to ${this.serverUrl}`));
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (!this.intentionalDisconnect) {
          this.reconnect();
        }
      };

      this.ws.onmessage = (event) => {
        this.handleIncomingMessage(event.data);
      };
    });
  }

  // ── Sending ──────────────────────────────────────────────

  /** Send a message to a specific agent (encodes with BAP-01) */
  send(
    to: string,
    type: MessageType,
    payload: unknown,
    priority: Priority = 3,
  ): void {
    const message = BAPCodec.createMessage(
      this.agentId,
      to,
      type,
      payload,
      priority,
    );
    this.sendRaw(message);
  }

  /** Broadcast a message to the current channel */
  broadcast(type: MessageType, payload: unknown, priority: Priority = 3): void {
    const message = BAPCodec.createMessage(
      this.agentId,
      "*",
      type,
      payload,
      priority,
    );
    this.sendRaw(message);
  }

  // ── Event handlers ───────────────────────────────────────

  /** Register a handler for a specific message type */
  on(type: MessageType, handler: (msg: AetherMessage) => void): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  // ── Request-Response ─────────────────────────────────────

  /**
   * Send a task message and wait for a correlated result.
   * Returns a Promise that resolves when a "result" message with a matching
   * correlationId arrives, or rejects on timeout.
   */
  async request(
    to: string,
    payload: unknown,
    priority: Priority = 3,
    timeout: number = 30_000,
  ): Promise<AetherMessage> {
    const correlationId = crypto.randomUUID();

    const message = BAPCodec.createMessage(
      this.agentId,
      to,
      "task",
      payload,
      priority,
      correlationId,
    );

    return new Promise<AetherMessage>((resolve, reject) => {
      // Timeout guard
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(
          new Error(
            `Request to ${to} timed out after ${timeout}ms (correlationId=${correlationId})`,
          ),
        );
      }, timeout);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      // Send the task
      this.sendRaw(message);
    });
  }

  // ── Heartbeat ────────────────────────────────────────────

  /** Start sending heartbeats every 5 seconds */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const heartbeat = BAPCodec.createMessage(
          this.agentId,
          "*",
          "heartbeat",
          { ts: Date.now() },
          1,
        );
        this.sendRaw(heartbeat);
      }
    }, 5_000);
  }

  /** Stop the heartbeat timer */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Disconnect ───────────────────────────────────────────

  /** Gracefully disconnect from the server */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.stopHeartbeat();

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Client disconnected"));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
  }

  // ── Auto-reconnect ──────────────────────────────────────

  /** Reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s */
  private async reconnect(): Promise<void> {
    if (this.intentionalDisconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Exceeded max attempts — give up
      this.rejectAllPending(
        new Error(
          `Reconnection failed after ${this.maxReconnectAttempts} attempts`,
        ),
      );
      return;
    }

    const delay = Math.pow(2, this.reconnectAttempts) * 1_000; // 1s, 2s, 4s, 8s, 16s
    this.reconnectAttempts++;

    await this.sleep(delay);

    if (this.intentionalDisconnect) return;

    try {
      await this.connect();
    } catch (reconnectErr) {
      console.warn(
        `[AetherLink] Reconnect attempt ${this.reconnectAttempts} failed:`,
        reconnectErr instanceof Error ? reconnectErr.message : reconnectErr,
      );
    }
  }

  // ── Internal helpers ─────────────────────────────────────

  /** Handle an incoming raw message from the WebSocket */
  private handleIncomingMessage(raw: string | ArrayBuffer | Blob): void {
    // BAP-02: pass binary data directly to codec — no string conversion
    const data =
      typeof raw === "string"
        ? raw // legacy BAP-01 hex string (backward compat)
        : new Uint8Array(
            raw instanceof ArrayBuffer ? raw : (raw as unknown as ArrayBuffer),
          );

    try {
      const message = BAPCodec.decode(data);

      // Check for pending request-response correlation
      if (message.type === "result" && message.correlationId) {
        const pending = this.pendingRequests.get(message.correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(message.correlationId);
          pending.resolve(message);
          return;
        }
      }

      // Dispatch to registered handlers
      const typeHandlers = this.handlers.get(message.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          try {
            handler(message);
          } catch (handlerErr) {
            console.warn(
              `[AetherLink] Handler error for "${message.type}":`,
              handlerErr instanceof Error ? handlerErr.message : handlerErr,
            );
          }
        }
      }
    } catch (decodeErr) {
      console.warn(
        "[AetherLink] Failed to decode message:",
        decodeErr instanceof Error ? decodeErr.message : decodeErr,
      );
    }
  }

  /** Encode and send a message over the WebSocket as a binary frame */
  private sendRaw(message: AetherMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    // BAP-02: encode returns Uint8Array — WebSocket.send() accepts BufferSource
    const encoded = BAPCodec.encode(message);
    this.ws.send(encoded);
  }

  /** Reject all pending requests with the given error */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /** Async sleep helper */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
