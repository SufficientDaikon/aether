// ─────────────────────────────────────────────────────────────
// AETHER Transport — HTTP API
// Connects to cloud agents via REST APIs (Banana, Replicate,
// Stability AI, custom endpoints, etc.)
// ─────────────────────────────────────────────────────────────

import { BaseTransport, type TransportHealthCheck } from "./base.ts";
import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  TransportConfig,
  APITransportConfig,
} from "../core/types.ts";

export class APITransport extends BaseTransport {
  constructor() {
    super("api");
  }

  async connect(_config: TransportConfig): Promise<void> {
    // HTTP is stateless — no persistent connection needed
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async execute(
    task: TaskRequest,
    agent: AgentDefinition,
    config: TransportConfig,
  ): Promise<TaskResult> {
    const apiConfig = config as APITransportConfig;
    const startTime = Date.now();

    try {
      // Build the request body
      const body = this.buildRequestBody(task, apiConfig);

      // Build headers with auth
      const headers = this.buildHeaders(apiConfig);

      // Make the HTTP request
      const response = await fetch(apiConfig.endpoint, {
        method: apiConfig.method,
        headers,
        body: apiConfig.method !== "GET" ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(apiConfig.timeout ?? 60_000),
      });

      if (!response.ok) {
        const errText = await response.text();
        return this.failResult(
          task.id,
          agent.id,
          `API ${response.status}: ${errText}`,
          startTime,
        );
      }

      const data = await response.json();

      // If this is an async API with polling, poll for completion
      if (apiConfig.polling) {
        return await this.pollForResult(
          task,
          agent,
          apiConfig,
          data,
          startTime,
        );
      }

      // Map the response to output
      const output = this.mapResponse(data, apiConfig);

      return this.successResult(task.id, agent.id, output, startTime);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failResult(
        task.id,
        agent.id,
        `API transport error: ${msg}`,
        startTime,
      );
    }
  }

  async healthCheck(config: TransportConfig): Promise<TransportHealthCheck> {
    const apiConfig = config as APITransportConfig;
    const start = Date.now();

    try {
      // HEAD request or GET with short timeout to check reachability
      const response = await fetch(apiConfig.endpoint, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
        headers: this.buildHeaders(apiConfig),
      });

      return {
        healthy: response.ok || response.status === 405, // 405 = Method Not Allowed is fine for HEAD
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

  private buildRequestBody(
    task: TaskRequest,
    config: APITransportConfig,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    if (config.requestMapping) {
      // Use explicit field mapping
      for (const [taskField, apiField] of Object.entries(
        config.requestMapping,
      )) {
        const value = this.getNestedValue(task, taskField);
        if (value !== undefined) {
          this.setNestedValue(body, apiField, value);
        }
      }
    } else {
      // Default mapping: send the whole task as-is
      body.task_id = task.id;
      body.prompt = task.description;
      body.context = task.context;
      body.priority = task.priority;
    }

    return body;
  }

  private buildHeaders(config: APITransportConfig): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    // Add authentication
    if (config.authType !== "none" && config.authEnvVar) {
      const secret = process.env[config.authEnvVar];
      if (!secret) {
        throw new Error(
          `Missing env var "${config.authEnvVar}" for API transport auth`,
        );
      }

      switch (config.authType) {
        case "bearer":
          headers["Authorization"] = `Bearer ${secret}`;
          break;
        case "api-key":
          headers[config.authHeader ?? "X-API-Key"] = secret;
          break;
        case "header":
          headers[config.authHeader ?? "Authorization"] = secret;
          break;
      }
    }

    return headers;
  }

  private async pollForResult(
    task: TaskRequest,
    agent: AgentDefinition,
    config: APITransportConfig,
    initialResponse: Record<string, unknown>,
    startTime: number,
  ): Promise<TaskResult> {
    const polling = config.polling!;

    // Extract job ID from initial response
    const jobId = this.getNestedValue(initialResponse, polling.jobIdField);
    if (!jobId) {
      return this.failResult(
        task.id,
        agent.id,
        `Polling error: no job ID found in field "${polling.jobIdField}"`,
        startTime,
      );
    }

    const statusUrl = polling.statusEndpoint.replace(
      "{{jobId}}",
      String(jobId),
    );
    const headers = this.buildHeaders(config);

    for (let poll = 0; poll < polling.maxPolls; poll++) {
      await this.sleep(polling.intervalMs);

      try {
        const response = await fetch(statusUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(config.timeout ?? 60_000),
        });

        if (!response.ok) continue;

        const data = await response.json();
        const status = this.getNestedValue(data, polling.completionField);

        if (String(status) === polling.completionValue) {
          const result = this.getNestedValue(data, polling.resultField);
          return this.successResult(
            task.id,
            agent.id,
            result ?? data,
            startTime,
          );
        }
      } catch {
        // Polling failure — try again
      }
    }

    return this.failResult(
      task.id,
      agent.id,
      `Polling timed out after ${polling.maxPolls} attempts`,
      startTime,
    );
  }

  private mapResponse(
    data: Record<string, unknown>,
    config: APITransportConfig,
  ): unknown {
    if (!config.responseMapping) return data;

    const mapped: Record<string, unknown> = {};
    for (const [apiField, outputField] of Object.entries(
      config.responseMapping,
    )) {
      const value = this.getNestedValue(data, apiField);
      if (value !== undefined) {
        mapped[outputField] = value;
      }
    }
    return mapped;
  }

  /** Get a nested value by dot-path e.g. "data.output.image_url" */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /** Set a nested value by dot-path */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split(".");
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
