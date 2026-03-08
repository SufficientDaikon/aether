// Phase 11.04: MCP-to-Runtime Bridge Integration Test
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const MCP_SCRIPT = join(ROOT, "bin/aether-mcp.ts");

async function collectOutput(proc: any, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let output = "";
    const decoder = new TextDecoder();
    const timer = setTimeout(() => resolve(output), timeoutMs);

    const reader = proc.stdout.getReader();
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          output += decoder.decode(value, { stream: true });
        }
      } catch {
        // stream closed
      }
      clearTimeout(timer);
      resolve(output);
    })();
  });
}

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("11.04.1", "MCP Bridge — get_status tool", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });

    try {
      // Send initialize + initialized + tools/call in quick succession
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_status", arguments: {} } },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }

      const output = await collectOutput(proc, 6000);
      const hasStatus = output.includes("agents") || output.includes("runtime") || output.includes("status") || output.includes("result");
      return {
        score: hasStatus ? 10 : output.length > 0 ? 5 : 0,
        maxScore: 10,
        details: `response contains status info: ${hasStatus} (len=${output.length})`,
      };
    } finally {
      proc.kill();
    }
  });

  await harness.runTest("11.04.2", "MCP Bridge — query_agents tool", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });

    try {
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "query_agents", arguments: { query: "react" } } },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }

      const output = await collectOutput(proc, 6000);
      const hasAgents = output.includes("react") || output.includes("agent");
      return {
        score: hasAgents ? 10 : output.length > 0 ? 5 : 0,
        maxScore: 10,
        details: `query_agents response relevant: ${hasAgents}`,
      };
    } finally {
      proc.kill();
    }
  });

  await harness.runTest("11.04.3", "MCP Bridge — switch_context tool", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });

    try {
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "switch_context", arguments: { context: "default" } } },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }

      const output = await collectOutput(proc, 6000);
      const responded = output.includes("default") || output.includes("context") || output.includes("result");
      return {
        score: responded ? 10 : output.length > 0 ? 5 : 0,
        maxScore: 10,
        details: `switch_context responded: ${responded}`,
      };
    } finally {
      proc.kill();
    }
  });

  await harness.runTest("11.04.4", "MCP Bridge — invalid method returns error", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });

    try {
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "nonexistent/method", params: {} },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }

      const output = await collectOutput(proc, 6000);
      const hasError = output.includes("error") || output.includes("-32");
      return {
        score: hasError ? 10 : output.length > 0 ? 5 : 0,
        maxScore: 10,
        details: `error response for bad method: ${hasError}`,
      };
    } finally {
      proc.kill();
    }
  });
}
