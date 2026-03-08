// ─────────────────────────────────────────────────────────────
// Phase 8.01: MCP Stdio Server Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const MCP_BIN = join(ROOT, "bin/aether-mcp.ts");

async function sendJsonRpc(
  method: string,
  params?: Record<string, unknown>,
  id = 1,
): Promise<{ result?: unknown; error?: unknown }> {
  return new Promise((resolve) => {
    const proc = Bun.spawn(["bun", "run", MCP_BIN, "--workspace", ROOT], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GOOGLE_AI_KEY: process.env.GOOGLE_AI_KEY || "test-key",
      },
    });

    let stdout = "";
    const reader = proc.stdout.getReader();
    const readChunks = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stdout += new TextDecoder().decode(value);
        }
      } catch {}
    };
    readChunks();

    const request =
      JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) +
      "\n";
    proc.stdin.write(request);
    proc.stdin.flush();

    setTimeout(() => {
      proc.stdin.end();
      setTimeout(() => {
        proc.kill();
        try {
          const lines = stdout
            .trim()
            .split("\n")
            .filter((l) => l.startsWith("{"));
          if (lines.length > 0) {
            resolve(JSON.parse(lines[lines.length - 1]));
          } else {
            resolve({
              error: `No JSON response. Raw: ${stdout.slice(0, 200)}`,
            });
          }
        } catch {
          resolve({ error: `Parse error: ${stdout.slice(0, 200)}` });
        }
      }, 2000);
    }, 3000);
  });
}

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("8.01.1", "MCP — Initialize handshake", async () => {
    const resp = await sendJsonRpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "eval-test", version: "1.0" },
    });
    const hasResult = resp.result !== undefined && !resp.error;
    return {
      score: hasResult ? 10 : 0,
      maxScore: 10,
      details: hasResult
        ? `Initialize succeeded: ${JSON.stringify(resp.result).slice(0, 100)}`
        : `Initialize failed: ${JSON.stringify(resp).slice(0, 200)}`,
    };
  });

  await harness.runTest(
    "8.01.2",
    "MCP — tools/list returns tools",
    async () => {
      const resp = await sendJsonRpc("tools/list");
      let toolNames: string[] = [];
      if (resp.result && typeof resp.result === "object") {
        const r = resp.result as Record<string, unknown>;
        if (Array.isArray(r.tools)) {
          toolNames = r.tools.map((t: any) => t.name);
        }
      }
      const expected = [
        "submit_task",
        "query_agents",
        "search_memory",
        "get_status",
        "switch_context",
        "get_config",
      ];
      const found = expected.filter((e) => toolNames.includes(e));
      return {
        score: found.length,
        maxScore: expected.length,
        details: `Found ${found.length}/${expected.length}: [${found.join(", ")}]`,
      };
    },
  );

  await harness.runTest("8.01.3", "MCP — resources/list", async () => {
    const resp = await sendJsonRpc("resources/list");
    let count = 0;
    if (resp.result && typeof resp.result === "object") {
      const r = resp.result as Record<string, unknown>;
      if (Array.isArray(r.resources)) count = r.resources.length;
    }
    return {
      score: count >= 3 ? 10 : count * 3,
      maxScore: 10,
      details: `Found ${count} resources`,
    };
  });

  await harness.runTest("8.01.4", "MCP — invalid method error", async () => {
    const resp = await sendJsonRpc("nonexistent/method");
    const isError = resp.error !== undefined;
    return {
      score: isError ? 10 : 0,
      maxScore: 10,
      details: isError
        ? "Correctly returned error"
        : `Unexpected: ${JSON.stringify(resp).slice(0, 200)}`,
    };
  });
}
