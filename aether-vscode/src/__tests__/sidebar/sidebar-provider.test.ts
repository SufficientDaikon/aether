// Tests for AetherSidebarProvider — RPC dispatch, HTML generation, CSP

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AetherSidebarProvider } from "../../sidebar/sidebar-provider";

// VS Code and crypto are mocked via vitest alias + __mocks__/vscode.ts
import * as vscode from "vscode";
import {
  mockWebviewView,
  mockExtensionContext,
} from "../__mocks__/vscode";

// Mock AetherBridge
function makeBridge(overrides: Partial<MockBridge> = {}): MockBridge {
  return {
    callTool: vi.fn().mockResolvedValue(null),
    readResource: vi.fn().mockResolvedValue(null),
    listTools: vi.fn().mockResolvedValue([]),
    isConnected: vi.fn().mockReturnValue(false),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    ...overrides,
  };
}

interface MockBridge {
  callTool: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

describe("AetherSidebarProvider", () => {
  let bridge: MockBridge;
  let provider: AetherSidebarProvider;
  let messageHandler: (msg: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = makeBridge();
    provider = new AetherSidebarProvider(
      mockExtensionContext as any,
      bridge as any,
    );

    // Resolve the webview and capture the message handler
    (mockWebviewView.webview.onDidReceiveMessage as any).mockImplementation(
      (handler: any) => {
        messageHandler = handler;
        return { dispose: vi.fn() };
      },
    );
    provider.resolveWebviewView(
      mockWebviewView as any,
      {} as any,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() } as any,
    );
  });

  // ── resolveWebviewView ───────────────────────────────────────

  describe("resolveWebviewView", () => {
    it("sets enableScripts: true on webview options", () => {
      expect(mockWebviewView.webview.options).toMatchObject({ enableScripts: true });
    });

    it("sets HTML content with root div", () => {
      expect(mockWebviewView.webview.html).toContain('<div id="root">');
    });

    it("HTML includes script tag for webview.js", () => {
      expect(mockWebviewView.webview.html).toContain("webview.js");
    });

    it("HTML includes link tag for webview.css", () => {
      expect(mockWebviewView.webview.html).toContain("webview.css");
    });

    it("HTML has a nonce on the script tag", () => {
      expect(mockWebviewView.webview.html).toMatch(/nonce-[0-9a-f]{32}/);
    });

    it("CSP includes script-src nonce", () => {
      expect(mockWebviewView.webview.html).toMatch(/script-src 'nonce-[0-9a-f]{32}'/);
    });

    it("CSP includes style-src with cspSource", () => {
      expect(mockWebviewView.webview.html).toContain("vscode-resource:");
    });

    it("registers a message handler", () => {
      expect(mockWebviewView.webview.onDidReceiveMessage).toHaveBeenCalledOnce();
    });
  });

  // ── Public API ───────────────────────────────────────────────

  describe("navigateTo", () => {
    it("posts a navigate message with panel", () => {
      provider.navigateTo("tasks");
      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith({
        type: "navigate",
        panel: "tasks",
      });
    });
  });

  describe("postEvent", () => {
    it("posts an event message with data", () => {
      provider.postEvent("agent_status_changed", { agentId: "cortex-0", status: "busy" });
      expect(mockWebviewView.webview.postMessage).toHaveBeenCalledWith({
        type: "event",
        event: "agent_status_changed",
        data: { agentId: "cortex-0", status: "busy" },
      });
    });
  });

  describe("reveal", () => {
    it("calls show(true) on the view", () => {
      provider.reveal();
      expect(mockWebviewView.show).toHaveBeenCalledWith(true);
    });
  });

  // ── RPC Dispatch ─────────────────────────────────────────────

  async function sendRPC(method: string, params?: any) {
    const id = `msg_test_${Date.now()}`;
    await messageHandler({ type: "request", id, method, params, timestamp: Date.now() });
    const calls = (mockWebviewView.webview.postMessage as any).mock.calls;
    return calls[calls.length - 1][0];
  }

  describe("getSystemStatus", () => {
    it("returns default status when bridge returns null", async () => {
      bridge.callTool.mockResolvedValue(null);
      const resp = await sendRPC("getSystemStatus");
      expect(resp.type).toBe("response");
      expect(resp.result.agents.total).toBe(0);
      expect(resp.result.version).toBe("0.2.0");
    });

    it("parses bridge response correctly", async () => {
      bridge.callTool.mockResolvedValue(
        JSON.stringify({
          agents: { total: 34, online: 30, busy: 4, offline: 0 },
          tasks: { active: 2, queued: 1, completed: 100, failed: 0 },
          memory: { used: 1024, available: 2048 },
          cacheStats: { hits: 5, misses: 1 },
          cost: { today: 1.23, thisMonth: 15.0, lastMonth: 42.0 },
          uptime: 3600,
          version: "0.3.0",
        }),
      );
      const resp = await sendRPC("getSystemStatus");
      expect(resp.result.agents.total).toBe(34);
      expect(resp.result.memory.cacheHits).toBe(5);
      expect(resp.result.version).toBe("0.3.0");
    });

    it("falls back to defaults on malformed JSON", async () => {
      bridge.callTool.mockResolvedValue("not valid json {{{");
      const resp = await sendRPC("getSystemStatus");
      expect(resp.result.agents.total).toBe(0);
    });
  });

  describe("getAgents", () => {
    it("returns empty array when bridge returns null", async () => {
      bridge.readResource.mockResolvedValue(null);
      const resp = await sendRPC("getAgents");
      expect(resp.result).toEqual([]);
    });

    it("maps agent fields correctly", async () => {
      bridge.readResource.mockResolvedValue(
        JSON.stringify([
          {
            id: "cortex-0",
            name: "Cortex",
            tier: "master",
            status: "online",
            capabilities: ["orchestration"],
            children: ["forge-0"],
          },
        ]),
      );
      const resp = await sendRPC("getAgents");
      expect(resp.result).toHaveLength(1);
      expect(resp.result[0].id).toBe("cortex-0");
      expect(resp.result[0].tier).toBe("master");
      expect(resp.result[0].children).toEqual(["forge-0"]);
    });

    it("returns empty array if resource is not an array", async () => {
      bridge.readResource.mockResolvedValue(JSON.stringify({ not: "an array" }));
      const resp = await sendRPC("getAgents");
      expect(resp.result).toEqual([]);
    });
  });

  describe("sendChatMessage", () => {
    it("prepends slash command to message", async () => {
      bridge.callTool.mockResolvedValue("Done!");
      await sendRPC("sendChatMessage", { message: "build a feature", command: "run" });
      expect(bridge.callTool).toHaveBeenCalledWith("submit_task", {
        description: "/run build a feature",
      });
    });

    it("sends plain message without command prefix", async () => {
      bridge.callTool.mockResolvedValue("Done!");
      await sendRPC("sendChatMessage", { message: "hello world" });
      expect(bridge.callTool).toHaveBeenCalledWith("submit_task", {
        description: "hello world",
      });
    });

    it("returns assistant message with content from bridge", async () => {
      bridge.callTool.mockResolvedValue("Analysis complete: 3 agents active");
      const resp = await sendRPC("sendChatMessage", { message: "status?" });
      expect(resp.result.role).toBe("assistant");
      expect(resp.result.content).toBe("Analysis complete: 3 agents active");
      expect(resp.result.agent).toBe("cortex-0");
    });

    it("uses fallback content when bridge returns null", async () => {
      bridge.callTool.mockResolvedValue(null);
      const resp = await sendRPC("sendChatMessage", { message: "test" });
      expect(resp.result.content).toBe("Task submitted successfully.");
    });
  });

  describe("submitTask", () => {
    it("calls submit_task tool with description and target", async () => {
      bridge.callTool.mockResolvedValue("Assigned to agent");
      await sendRPC("submitTask", { description: "Build login page", targetAgent: "react-specialist" });
      expect(bridge.callTool).toHaveBeenCalledWith("submit_task", {
        description: "Build login page",
        target: "react-specialist",
      });
    });

    it("returns success: true", async () => {
      bridge.callTool.mockResolvedValue("ok");
      const resp = await sendRPC("submitTask", { description: "test task" });
      expect(resp.result.success).toBe(true);
    });
  });

  describe("getPendingApprovals", () => {
    it("returns empty array when status has no approvals", async () => {
      bridge.callTool.mockResolvedValue(JSON.stringify({ uptime: 100 }));
      const resp = await sendRPC("getPendingApprovals");
      expect(resp.result).toEqual([]);
    });

    it("returns approvals array from status", async () => {
      bridge.callTool.mockResolvedValue(
        JSON.stringify({ pendingApprovals: [{ id: "appr_1", type: "code_change" }] }),
      );
      const resp = await sendRPC("getPendingApprovals");
      expect(resp.result).toHaveLength(1);
      expect(resp.result[0].id).toBe("appr_1");
    });
  });

  describe("approveChange / rejectChange / batchApprove", () => {
    it("approveChange submits approval task", async () => {
      bridge.callTool.mockResolvedValue("ok");
      const resp = await sendRPC("approveChange", { approvalId: "appr_1" });
      expect(bridge.callTool).toHaveBeenCalledWith("submit_task", expect.objectContaining({
        description: expect.stringContaining("appr_1"),
      }));
      expect(resp.result.success).toBe(true);
    });

    it("rejectChange includes reason in task description", async () => {
      bridge.callTool.mockResolvedValue("ok");
      await sendRPC("rejectChange", { approvalId: "appr_1", reason: "Too risky" });
      const desc = bridge.callTool.mock.calls[0][1].description;
      expect(desc).toContain("Too risky");
    });

    it("batchApprove calls submit_task for each id", async () => {
      bridge.callTool.mockResolvedValue("ok");
      const resp = await sendRPC("batchApprove", { approvalIds: ["a1", "a2", "a3"] });
      expect(bridge.callTool).toHaveBeenCalledTimes(3);
      expect(resp.result.approved).toBe(3);
    });

    it("batchApprove handles empty array", async () => {
      const resp = await sendRPC("batchApprove", { approvalIds: [] });
      expect(resp.result.approved).toBe(0);
      expect(bridge.callTool).not.toHaveBeenCalled();
    });
  });

  describe("searchMemory", () => {
    it("returns empty array when bridge returns null", async () => {
      bridge.callTool.mockResolvedValue(null);
      const resp = await sendRPC("searchMemory", { query: "auth" });
      expect(resp.result).toEqual([]);
    });

    it("maps memory results correctly", async () => {
      bridge.callTool.mockResolvedValue(
        JSON.stringify([
          { text: "JWT authentication flow", score: 0.95, source: "codebase", type: "code" },
        ]),
      );
      const resp = await sendRPC("searchMemory", { query: "auth" });
      expect(resp.result[0].content).toBe("JWT authentication flow");
      expect(resp.result[0].score).toBe(0.95);
      expect(resp.result[0].id).toBe("mem_0");
    });
  });

  describe("getConfig", () => {
    it("returns empty object when resource is null", async () => {
      bridge.readResource.mockResolvedValue(null);
      const resp = await sendRPC("getConfig");
      expect(resp.result).toEqual({});
    });

    it("parses and returns config", async () => {
      bridge.readResource.mockResolvedValue(JSON.stringify({ model: "gpt-4", temperature: 0.7 }));
      const resp = await sendRPC("getConfig");
      expect(resp.result.model).toBe("gpt-4");
    });
  });

  describe("applyCodeBlock", () => {
    it("returns success: true always", async () => {
      const resp = await sendRPC("applyCodeBlock", { blockId: "blk_1", filename: "auth.ts" });
      expect(resp.result.success).toBe(true);
    });
  });

  describe("unknown method", () => {
    it("returns error response for unknown RPC method", async () => {
      const resp = await sendRPC("doesNotExist");
      expect(resp.type).toBe("response");
      expect(resp.error).toBeDefined();
      expect(resp.error.message).toContain("Unknown RPC method");
    });
  });

  describe("ready message", () => {
    it("ignores ready messages (no response sent)", async () => {
      await messageHandler({ type: "ready" });
      expect(mockWebviewView.webview.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("non-request messages", () => {
    it("ignores messages that are not type: request", async () => {
      await messageHandler({ type: "event", event: "something" });
      expect(mockWebviewView.webview.postMessage).not.toHaveBeenCalled();
    });
  });
});
