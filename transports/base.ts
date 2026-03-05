// ─────────────────────────────────────────────────────────────
// AETHER Transport — Base Interface
// All transport adapters implement this contract so the executor
// can route tasks uniformly regardless of where agents live.
// ─────────────────────────────────────────────────────────────

import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  TransportConfig,
} from "../core/types.ts";

/**
 * Result of a transport health check.
 */
export interface TransportHealthCheck {
  healthy: boolean;
  latencyMs: number;
  details?: string;
}

/**
 * Abstract base class for all transport adapters.
 *
 * A transport is responsible for converting a TaskRequest into
 * whatever format the external agent expects, sending it, waiting
 * for the response, and converting it back to a TaskResult.
 */
export abstract class BaseTransport {
  /** Human-readable transport name (e.g. "api", "cli", "mcp") */
  readonly transportType: string;

  /** Whether this transport is currently connected / available */
  protected connected = false;

  constructor(transportType: string) {
    this.transportType = transportType;
  }

  /**
   * Initialize the transport connection if needed.
   * For stateless transports (HTTP API), this is a no-op.
   * For stateful transports (WebSocket federation, MCP), this
   * establishes the connection.
   */
  abstract connect(config: TransportConfig): Promise<void>;

  /**
   * Execute a task through this transport.
   * Transforms the TaskRequest into the external format,
   * sends it, waits for the response, and returns a TaskResult.
   */
  abstract execute(
    task: TaskRequest,
    agent: AgentDefinition,
    config: TransportConfig,
  ): Promise<TaskResult>;

  /**
   * Gracefully disconnect / clean up resources.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Health check — is the external agent reachable?
   */
  abstract healthCheck(config: TransportConfig): Promise<TransportHealthCheck>;

  /**
   * Whether this transport is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Build a success TaskResult with timing.
   */
  protected successResult(
    requestId: string,
    executor: string,
    output: unknown,
    startTime: number,
  ): TaskResult {
    return {
      requestId,
      executor,
      status: "success",
      output,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Build a failure TaskResult with timing.
   */
  protected failResult(
    requestId: string,
    executor: string,
    error: string,
    startTime: number,
  ): TaskResult {
    return {
      requestId,
      executor,
      status: "failure",
      output: { error },
      duration: Date.now() - startTime,
    };
  }
}
