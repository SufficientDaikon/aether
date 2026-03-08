// Tests for AetherBridge — JSON-RPC protocol, tool calls, resource reads

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// vi.mock() factories are hoisted before variables — use plain vi.fn() in factory,
// then configure via mockImplementation in beforeEach.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue("/usr/local/bin/bun\n"),
}));

vi.mock("node:fs", () => ({
  statSync: vi.fn(),
}));

import { spawn as spawnFn, execSync } from "node:child_process";
import { AetherBridge } from "../aether-bridge";

// A fresh mock process per test
class MockProcess extends EventEmitter {
  stdin = { writable: true, write: vi.fn().mockReturnValue(true) };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  pid = 12345;
}

let currentMock: MockProcess;

function makeOutputChannel() {
  return { appendLine: vi.fn(), append: vi.fn(), show: vi.fn() } as any;
}

function sendMcpResponse(response: object) {
  currentMock.stdout.emit("data", Buffer.from(JSON.stringify(response) + "\n"));
}

async function connectBridge(bridge: AetherBridge) {
  const connectPromise = bridge.connect();
  await new Promise((r) => setTimeout(r, 0));
  sendMcpResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: "aether-mcp", version: "0.2.0" },
    },
  });
  await connectPromise;
}

describe("AetherBridge", () => {
  let bridge: AetherBridge;
  let output: ReturnType<typeof makeOutputChannel>;

  beforeEach(() => {
    vi.clearAllMocks();
    output = makeOutputChannel();
    bridge = new AetherBridge("", output);
    // Each test gets a fresh process; configure after clearAllMocks
    vi.mocked(spawnFn).mockImplementation(() => {
      currentMock = new MockProcess();
      return currentMock as any;
    });
    vi.mocked(execSync as any).mockReturnValue("/usr/local/bin/bun\n");
  });

  afterEach(() => {
    bridge.disconnect();
  });

  // ── connect ─────────────────────────────────────────────────

  describe("connect", () => {
    it("spawns bun process with run + MCP script", async () => {
      await connectBridge(bridge);
      expect(vi.mocked(spawnFn)).toHaveBeenCalledOnce();
      const [cmd, args] = vi.mocked(spawnFn).mock.calls[0];
      expect(typeof cmd).toBe("string"); // bun path
      expect(args[0]).toBe("run");
    });

    it("sends initialize request on connect", async () => {
      await connectBridge(bridge);
      const firstWrite: string = currentMock.stdin.write.mock.calls[0][0];
      const request = JSON.parse(firstWrite.trim());
      expect(request.method).toBe("initialize");
      expect(request.params.clientInfo.name).toBe("aether-vscode");
    });

    it("marks bridge as connected after successful handshake", async () => {
      expect(bridge.isConnected()).toBe(false);
      await connectBridge(bridge);
      expect(bridge.isConnected()).toBe(true);
    });

    it("does not reconnect if already connected", async () => {
      await connectBridge(bridge);
      await bridge.connect(); // should be a no-op
      expect(vi.mocked(spawnFn)).toHaveBeenCalledOnce();
    });
  });

  // ── callTool ────────────────────────────────────────────────

  describe("callTool", () => {
    beforeEach(async () => {
      await connectBridge(bridge);
      currentMock.stdin.write.mockClear();
    });

    it("sends tools/call request with name and arguments", async () => {
      const toolPromise = bridge.callTool("get_status", { verbose: true });

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      expect(written.method).toBe("tools/call");
      expect(written.params.name).toBe("get_status");
      expect(written.params.arguments).toEqual({ verbose: true });

      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        result: {
          content: [{ type: "text", text: '{"uptime":3600}' }],
          isError: false,
        },
      });

      const result = await toolPromise;
      expect(result).toBe('{"uptime":3600}');
    });

    it("concatenates multiple text content items", async () => {
      const toolPromise = bridge.callTool("search_memory", { query: "auth" });

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        result: {
          content: [
            { type: "text", text: "Result 1" },
            { type: "text", text: "Result 2" },
          ],
          isError: false,
        },
      });

      const result = await toolPromise;
      expect(result).toBe("Result 1\nResult 2");
    });

    it("returns null when content array is empty", async () => {
      const toolPromise = bridge.callTool("get_status", {});

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        result: { content: [], isError: false },
      });

      const result = await toolPromise;
      expect(result).toBeNull();
    });

    it("logs error but still returns text on isError: true", async () => {
      const toolPromise = bridge.callTool("bad_tool", {});

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        result: {
          content: [{ type: "text", text: "Error: tool not found" }],
          isError: true,
        },
      });

      const result = await toolPromise;
      expect(result).toBe("Error: tool not found");
      expect(output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("Tool error"),
      );
    });

    it("rejects on JSON-RPC error response", async () => {
      const toolPromise = bridge.callTool("fail_tool", {});

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        error: { code: -32601, message: "Method not found" },
      });

      await expect(toolPromise).rejects.toThrow("Method not found");
    });
  });

  // ── readResource ─────────────────────────────────────────────

  describe("readResource", () => {
    beforeEach(async () => {
      await connectBridge(bridge);
      currentMock.stdin.write.mockClear();
    });

    it("sends resources/read request with URI", async () => {
      const resPromise = bridge.readResource("aether://agents");

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      expect(written.method).toBe("resources/read");
      expect(written.params.uri).toBe("aether://agents");

      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        result: { contents: [{ text: '[{"id":"cortex-0"}]' }] },
      });

      const result = await resPromise;
      expect(result).toBe('[{"id":"cortex-0"}]');
    });

    it("returns null when contents is empty", async () => {
      const resPromise = bridge.readResource("aether://empty");

      await new Promise((r) => setTimeout(r, 0));
      const written = JSON.parse(currentMock.stdin.write.mock.calls[0][0].trim());
      sendMcpResponse({
        jsonrpc: "2.0",
        id: written.id,
        result: { contents: [] },
      });

      const result = await resPromise;
      expect(result).toBeNull();
    });
  });

  // ── disconnect ──────────────────────────────────────────────

  describe("disconnect", () => {
    it("kills the child process", async () => {
      await connectBridge(bridge);
      bridge.disconnect();
      expect(currentMock.kill).toHaveBeenCalledOnce();
    });

    it("marks bridge as disconnected", async () => {
      await connectBridge(bridge);
      bridge.disconnect();
      expect(bridge.isConnected()).toBe(false);
    });

    it("is safe to call when not connected", () => {
      expect(() => bridge.disconnect()).not.toThrow();
    });
  });

  // ── JSON-RPC framing ─────────────────────────────────────────

  describe("JSON-RPC message framing", () => {
    beforeEach(async () => {
      await connectBridge(bridge);
      currentMock.stdin.write.mockClear();
    });

    it("handles multiple JSON objects in a single data chunk", async () => {
      const p1 = bridge.callTool("tool_a", {});
      const p2 = bridge.callTool("tool_b", {});

      await new Promise((r) => setTimeout(r, 0));
      const id1 = JSON.parse(currentMock.stdin.write.mock.calls[0][0]).id;
      const id2 = JSON.parse(currentMock.stdin.write.mock.calls[1][0]).id;

      // Send both responses in one chunk
      const chunk =
        JSON.stringify({ jsonrpc: "2.0", id: id1, result: { content: [{ type: "text", text: "A" }] } }) +
        "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: id2, result: { content: [{ type: "text", text: "B" }] } }) +
        "\n";

      currentMock.stdout.emit("data", Buffer.from(chunk));

      expect(await p1).toBe("A");
      expect(await p2).toBe("B");
    });

    it("handles split JSON chunks across multiple data events", async () => {
      const p1 = bridge.callTool("tool_x", {});

      await new Promise((r) => setTimeout(r, 0));
      const id = JSON.parse(currentMock.stdin.write.mock.calls[0][0]).id;
      const fullJson = JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }] } });

      // Split in the middle
      const half = Math.floor(fullJson.length / 2);
      currentMock.stdout.emit("data", Buffer.from(fullJson.slice(0, half)));
      currentMock.stdout.emit("data", Buffer.from(fullJson.slice(half) + "\n"));

      expect(await p1).toBe("ok");
    });

    it("ignores non-JSON lines", async () => {
      const p1 = bridge.callTool("tool_y", {});

      await new Promise((r) => setTimeout(r, 0));
      const id = JSON.parse(currentMock.stdin.write.mock.calls[0][0]).id;

      // Some noise before the real response
      currentMock.stdout.emit("data", Buffer.from("[runtime] Starting server...\n"));
      sendMcpResponse({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "done" }] } });

      expect(await p1).toBe("done");
      expect(output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("Invalid JSON from runtime"),
      );
    });
  });

  // ── process lifecycle ────────────────────────────────────────

  describe("process lifecycle", () => {
    beforeEach(async () => {
      await connectBridge(bridge);
      currentMock.stdin.write.mockClear();
    });

    it("emits disconnected event on process exit", () => {
      const handler = vi.fn();
      bridge.on("disconnected", handler);
      currentMock.emit("exit", 0);
      expect(handler).toHaveBeenCalledOnce();
    });

    it("rejects pending requests when process exits", async () => {
      const p = bridge.callTool("long_running", {});
      currentMock.emit("exit", 1);
      await expect(p).rejects.toThrow("Process exited");
    });
  });
});
