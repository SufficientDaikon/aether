// Phase 13.02: Bridge Protocol Tests (MCP JSON-RPC)
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
      } catch {}
      clearTimeout(timer);
      resolve(output);
    })();
  });
}

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("13.02.1", "Bridge — initialize returns server info", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    try {
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } }) + "\n");
      proc.stdin.flush();
      const output = await collectOutput(proc, 5000);
      const hasServerInfo = output.includes("aether") && output.includes("2024-11-05");
      return {
        score: hasServerInfo ? 10 : output.length > 0 ? 5 : 0,
        maxScore: 10,
        details: `server info present: ${hasServerInfo}`,
      };
    } finally {
      proc.kill();
    }
  });

  await harness.runTest("13.02.2", "Bridge — tools/list returns 6 tools", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    try {
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }
      const output = await collectOutput(proc, 5000);
      const toolNames = ["submit_task", "query_agents", "search_memory", "get_status", "switch_context", "get_config"];
      const foundCount = toolNames.filter(t => output.includes(t)).length;
      return {
        score: foundCount === 6 ? 10 : foundCount >= 4 ? 7 : 0,
        maxScore: 10,
        details: `tools found: ${foundCount}/6`,
      };
    } finally {
      proc.kill();
    }
  });

  await harness.runTest("13.02.3", "Bridge — resources/list returns 3 resources", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    try {
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }
      const output = await collectOutput(proc, 5000);
      const uris = ["aether://agents", "aether://settings", "aether://metrics"];
      const foundCount = uris.filter(u => output.includes(u)).length;
      return {
        score: foundCount === 3 ? 10 : foundCount >= 2 ? 7 : 0,
        maxScore: 10,
        details: `resources found: ${foundCount}/3`,
      };
    } finally {
      proc.kill();
    }
  });

  await harness.runTest("13.02.4", "Bridge — error on invalid method", async () => {
    const proc = Bun.spawn(["bun", "run", MCP_SCRIPT, "--workspace", ROOT], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    try {
      const msgs = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "bogus/method", params: {} },
      ];
      for (const msg of msgs) {
        proc.stdin.write(JSON.stringify(msg) + "\n");
        proc.stdin.flush();
      }
      const output = await collectOutput(proc, 5000);
      const hasError = output.includes("-32601") || output.includes("Method not found");
      return {
        score: hasError ? 10 : output.includes("error") ? 7 : 0,
        maxScore: 10,
        details: `method-not-found error: ${hasError}`,
      };
    } finally {
      proc.kill();
    }
  });
}
