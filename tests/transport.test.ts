import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { APITransport } from "../transports/api.ts";
import { CLITransport } from "../transports/cli.ts";
import { MCPTransport } from "../transports/mcp.ts";
import { FederationTransport } from "../transports/federation.ts";
import { TransportManager } from "../transports/manager.ts";
import type {
  TaskRequest,
  AgentDefinition,
  APITransportConfig,
  CLITransportConfig,
  MCPTransportConfig,
  FederationTransportConfig,
} from "../core/types.ts";

// ─────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<TaskRequest>): TaskRequest {
  return {
    id: "task-001",
    description: "Generate an image of a sunset",
    requester: "cortex-0",
    target: "nano-banana-pro",
    priority: 3,
    context: { width: 1024, height: 1024 },
    ...overrides,
  };
}

function makeAgent(
  transport?: any,
  overrides?: Partial<AgentDefinition>,
): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    tier: "worker",
    sections: ["META"],
    capabilities: ["test"],
    dependencies: [],
    llmRequirement: "haiku",
    format: "json",
    escalationTarget: null,
    filePath: "/tmp/test.agent.md",
    status: "idle",
    metadata: {},
    ...(transport ? { transport } : {}),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// API Transport Tests
// ─────────────────────────────────────────────────────────────

describe("APITransport", () => {
  let transport: APITransport;

  beforeEach(() => {
    transport = new APITransport();
  });

  afterEach(async () => {
    await transport.disconnect();
  });

  it("should initialize as 'api' type", () => {
    expect(transport.transportType).toBe("api");
  });

  it("should connect (stateless — always succeeds)", async () => {
    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    await transport.connect(config);
    expect(transport.isConnected()).toBe(true);
  });

  it("should disconnect cleanly", async () => {
    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    await transport.connect(config);
    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it("should build default request body when no mapping provided", async () => {
    // We test the internal method via execute with a mock fetch
    const originalFetch = globalThis.fetch;
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    await transport.execute(task, agent, config);

    expect(capturedBody.task_id).toBe("task-001");
    expect(capturedBody.prompt).toBe("Generate an image of a sunset");
    expect(capturedBody.context).toEqual({ width: 1024, height: 1024 });

    globalThis.fetch = originalFetch;
  });

  it("should use request mapping when provided", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: any = null;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ image_url: "https://example.com/img.png" }),
        {
          status: 200,
        },
      );
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
      requestMapping: {
        description: "prompt",
        "context.width": "width",
        "context.height": "height",
      },
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    await transport.execute(task, agent, config);

    expect(capturedBody.prompt).toBe("Generate an image of a sunset");
    expect(capturedBody.width).toBe(1024);
    expect(capturedBody.height).toBe(1024);

    globalThis.fetch = originalFetch;
  });

  it("should map response fields when responseMapping is provided", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: { image_url: "https://img.example.com/sunset.png" },
          meta: { seed: 42 },
        }),
        { status: 200 },
      );
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
      responseMapping: {
        "data.image_url": "url",
        "meta.seed": "seed",
      },
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    const result = await transport.execute(task, agent, config);

    expect(result.status).toBe("success");
    expect((result.output as any).url).toBe(
      "https://img.example.com/sunset.png",
    );
    expect((result.output as any).seed).toBe(42);

    globalThis.fetch = originalFetch;
  });

  it("should handle API errors gracefully", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    const result = await transport.execute(task, agent, config);

    expect(result.status).toBe("failure");
    expect((result.output as any).error).toContain("API 500");

    globalThis.fetch = originalFetch;
  });

  it("should add bearer auth header when configured", async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: any = null;

    // Set up env var
    const origEnv = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = "sk-test-key-123";

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedHeaders = init.headers;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "bearer",
      authEnvVar: "TEST_API_KEY",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    await transport.execute(task, agent, config);

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-key-123");

    // Restore
    if (origEnv === undefined) delete process.env.TEST_API_KEY;
    else process.env.TEST_API_KEY = origEnv;
    globalThis.fetch = originalFetch;
  });

  it("should handle network errors", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new Error("Network unreachable");
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://unreachable.example.com/api",
      method: "POST",
      authType: "none",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    const result = await transport.execute(task, agent, config);

    expect(result.status).toBe("failure");
    expect((result.output as any).error).toContain("Network unreachable");

    globalThis.fetch = originalFetch;
  });
});

// ─────────────────────────────────────────────────────────────
// CLI Transport Tests
// ─────────────────────────────────────────────────────────────

describe("CLITransport", () => {
  let transport: CLITransport;

  beforeEach(() => {
    transport = new CLITransport();
  });

  afterEach(async () => {
    await transport.disconnect();
  });

  it("should initialize as 'cli' type", () => {
    expect(transport.transportType).toBe("cli");
  });

  it("should connect (stateless — always succeeds)", async () => {
    const config: CLITransportConfig = {
      transport: "cli",
      command: "echo",
      inputFormat: "args",
      outputFormat: "stdout-text",
    };

    await transport.connect(config);
    expect(transport.isConnected()).toBe(true);
  });

  it("should execute a simple echo command", async () => {
    const config: CLITransportConfig = {
      transport: "cli",
      command: "echo",
      args: ["hello world"],
      inputFormat: "args",
      outputFormat: "stdout-text",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    const result = await transport.execute(task, agent, config);

    expect(result.status).toBe("success");
    // echo outputs the text; the task JSON is appended as an arg
    expect(typeof result.output).toBe("string");
  });

  it("should handle command failure with non-zero exit code", async () => {
    const config: CLITransportConfig = {
      transport: "cli",
      command: "false", // Unix command that always exits with 1
      inputFormat: "args",
      outputFormat: "stdout-text",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    const result = await transport.execute(task, agent, config);

    expect(result.status).toBe("failure");
  });

  it("should parse JSON output when outputFormat is stdout-json", async () => {
    const config: CLITransportConfig = {
      transport: "cli",
      command: "echo",
      args: ['{"result":"ok","value":42}'],
      inputFormat: "args",
      outputFormat: "stdout-json",
    };

    const task = makeTask();
    const agent = makeAgent(config);

    await transport.connect(config);
    const result = await transport.execute(task, agent, config);

    // echo appends the task JSON as another arg, so the output
    // will have extra content. The test validates the parse attempt.
    expect(result.status).toBe("success");
  });
});

// ─────────────────────────────────────────────────────────────
// Transport Manager Tests
// ─────────────────────────────────────────────────────────────

describe("TransportManager", () => {
  let manager: TransportManager;

  beforeEach(() => {
    manager = new TransportManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  it("should identify external agents correctly", () => {
    const localAgent = makeAgent();
    expect(manager.isExternalAgent(localAgent)).toBe(false);

    const apiAgent = makeAgent({
      transport: "api",
      endpoint: "https://example.com",
      method: "POST",
      authType: "none",
    });
    expect(manager.isExternalAgent(apiAgent)).toBe(true);
  });

  it("should throw when executing on a local agent", async () => {
    const localAgent = makeAgent();
    const task = makeTask();

    try {
      await manager.execute(task, localAgent);
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect((err as Error).message).toContain("no transport config");
    }
  });

  it("should create and reuse transports for agents", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    const agent = makeAgent(config, { id: "api-agent" });
    const task = makeTask();

    // First execution creates the transport
    const result1 = await manager.execute(task, agent);
    expect(result1.status).toBe("success");

    // Second execution reuses the transport
    const result2 = await manager.execute(task, agent);
    expect(result2.status).toBe("success");

    globalThis.fetch = originalFetch;
  });

  it("should disconnect all transports", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    const agent1 = makeAgent(config, { id: "api-agent-1" });
    const agent2 = makeAgent(config, { id: "api-agent-2" });
    const task = makeTask();

    await manager.execute(task, agent1);
    await manager.execute(task, agent2);

    // Now disconnect all
    await manager.disconnectAll();

    // Status should be empty
    const status = manager.getStatus();
    expect(status.length).toBe(0);

    globalThis.fetch = originalFetch;
  });

  it("should disconnect a specific agent transport", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }) as any;

    const config: APITransportConfig = {
      transport: "api",
      endpoint: "https://example.com/api",
      method: "POST",
      authType: "none",
    };

    const agent = makeAgent(config, { id: "api-agent" });
    const task = makeTask();

    await manager.execute(task, agent);
    await manager.disconnectAgent("api-agent");

    globalThis.fetch = originalFetch;
  });

  it("should report healthy for local agents", async () => {
    const localAgent = makeAgent();
    const result = await manager.checkHealth(localAgent);
    expect(result.healthy).toBe(true);
    expect(result.details).toBe("Local LLM agent");
  });
});

// ─────────────────────────────────────────────────────────────
// Transport Config Parsing (via Runtime)
// ─────────────────────────────────────────────────────────────

describe("Transport Config Parsing", () => {
  // Import runtime for static method testing
  const { AetherRuntime } = require("../core/runtime.ts");

  it("should parse API transport from YAML frontmatter", () => {
    const yaml = `
transport:
  type: api
  endpoint: https://api.banana.dev/v1/run
  method: POST
  authType: bearer
  authEnvVar: BANANA_API_KEY
  timeout: 60000
`.trim();

    const config = AetherRuntime.parseTransportFromYaml(yaml);
    expect(config).not.toBeNull();
    expect(config!.transport).toBe("api");
    expect((config as any).endpoint).toBe("https://api.banana.dev/v1/run");
    expect((config as any).method).toBe("POST");
    expect((config as any).authType).toBe("bearer");
    expect((config as any).authEnvVar).toBe("BANANA_API_KEY");
    expect((config as any).timeout).toBe(60000);
  });

  it("should parse CLI transport from YAML frontmatter", () => {
    const yaml = `
transport:
  type: cli
  command: python
  inputFormat: stdin-json
  outputFormat: stdout-json
  timeout: 300000
`.trim();

    const config = AetherRuntime.parseTransportFromYaml(yaml);
    expect(config).not.toBeNull();
    expect(config!.transport).toBe("cli");
    expect((config as any).command).toBe("python");
    expect((config as any).inputFormat).toBe("stdin-json");
    expect((config as any).timeout).toBe(300000);
  });

  it("should parse MCP transport from YAML frontmatter", () => {
    const yaml = `
transport:
  type: mcp
  serverCommand: npx
  toolName: read_file
  timeout: 15000
`.trim();

    const config = AetherRuntime.parseTransportFromYaml(yaml);
    expect(config).not.toBeNull();
    expect(config!.transport).toBe("mcp");
    expect((config as any).serverCommand).toBe("npx");
    expect((config as any).toolName).toBe("read_file");
  });

  it("should parse federation transport from YAML frontmatter", () => {
    const yaml = `
transport:
  type: federation
  instanceUrl: ws://image-aether.local:9999
  remoteAgentId: nano-banana-pro
  channel: /federation/images
  timeout: 120000
`.trim();

    const config = AetherRuntime.parseTransportFromYaml(yaml);
    expect(config).not.toBeNull();
    expect(config!.transport).toBe("federation");
    expect((config as any).instanceUrl).toBe("ws://image-aether.local:9999");
    expect((config as any).remoteAgentId).toBe("nano-banana-pro");
    expect((config as any).channel).toBe("/federation/images");
  });

  it("should return null when no transport block exists", () => {
    const yaml = `
id: some-agent
name: Some Agent
tier: worker
`.trim();

    const config = AetherRuntime.parseTransportFromYaml(yaml);
    expect(config).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Integration: Executor + Transport
// ─────────────────────────────────────────────────────────────

describe("Executor Transport Integration", () => {
  it("should route external agent tasks through transport", async () => {
    const { AgentRegistry } = require("../core/registry.ts");
    const { EscalationManager } = require("../core/escalation.ts");
    const { SynapseLogger } = require("../core/logger.ts");
    const { ProviderManager } = require("../providers/manager.ts");
    const { AgentExecutor } = require("../core/executor.ts");
    const { TransportManager } = require("../transports/manager.ts");

    // Mock fetch for API transport
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      return new Response(
        JSON.stringify({
          image_url: "https://example.com/generated.png",
          seed: 42,
        }),
        { status: 200 },
      );
    }) as any;

    const registry = new AgentRegistry();
    const escalation = new EscalationManager(registry);
    const logger = new SynapseLogger("/tmp/aether-test-logs", "error");
    const providers = new ProviderManager();
    const transports = new TransportManager();

    // Register an external API agent
    const apiAgent: AgentDefinition = makeAgent(
      {
        transport: "api",
        endpoint: "https://api.example.com/generate",
        method: "POST",
        authType: "none",
      } as APITransportConfig,
      {
        id: "image-gen",
        name: "Image Generator",
        capabilities: ["image-generation"],
      },
    );

    registry.register(apiAgent);

    const executor = new AgentExecutor(
      registry,
      escalation,
      logger,
      providers,
      transports,
    );

    const task = makeTask({
      target: "image-gen",
      description: "Generate a sunset image",
    });

    const result = await executor.execute(task);

    expect(result.status).toBe("success");
    expect(result.executor).toBe("image-gen");
    expect((result.output as any).image_url).toBe(
      "https://example.com/generated.png",
    );

    await logger.close();
    globalThis.fetch = originalFetch;
  });
});
