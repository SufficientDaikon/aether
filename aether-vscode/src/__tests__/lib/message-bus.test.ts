// Tests for the typed message bus (webview ↔ extension host RPC)
// Runs in jsdom environment (needs window.addEventListener)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock acquireVsCodeApi ────────────────────────────────────
const mockPostMessage = vi.fn();
const mockGetState = vi.fn().mockReturnValue(undefined);
const mockSetState = vi.fn();

// Must be set before importing message-bus
(globalThis as any).acquireVsCodeApi = vi.fn(() => ({
  postMessage: mockPostMessage,
  getState: mockGetState,
  setState: mockSetState,
}));

import {
  initMessageBus,
  rpcCall,
  onEvent,
  signalReady,
  saveState,
  loadState,
} from "../../webview-ui/lib/message-bus";

function dispatchMessage(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

describe("message-bus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMessageBus();
  });

  afterEach(() => {
    window.removeEventListener("message", () => {});
  });

  describe("signalReady", () => {
    it("posts a ready message", () => {
      signalReady();
      expect(mockPostMessage).toHaveBeenCalledWith({ type: "ready" });
    });
  });

  describe("rpcCall", () => {
    it("sends a typed request with unique id", () => {
      rpcCall("getSystemStatus");
      expect(mockPostMessage).toHaveBeenCalledOnce();
      const sent = mockPostMessage.mock.calls[0][0];
      expect(sent.type).toBe("request");
      expect(sent.method).toBe("getSystemStatus");
      expect(sent.id).toMatch(/^msg_\d+_\d+$/);
      expect(sent.timestamp).toBeGreaterThan(0);
    });

    it("sends params when provided", () => {
      rpcCall("getAgents", { includeOffline: true });
      const sent = mockPostMessage.mock.calls[0][0];
      expect(sent.params).toEqual({ includeOffline: true });
    });

    it("resolves when a matching response arrives", async () => {
      const promise = rpcCall<{ version: string }>("getSystemStatus");
      const sentId = mockPostMessage.mock.calls[0][0].id;

      dispatchMessage({
        type: "response",
        id: "resp_1",
        correlationId: sentId,
        result: { version: "0.2.0" },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result).toEqual({ version: "0.2.0" });
    });

    it("rejects when response contains an error", async () => {
      const promise = rpcCall("doSomething");
      const sentId = mockPostMessage.mock.calls[0][0].id;

      dispatchMessage({
        type: "response",
        id: "resp_2",
        correlationId: sentId,
        error: { code: -1, message: "Something went wrong" },
        timestamp: Date.now(),
      });

      await expect(promise).rejects.toThrow("Something went wrong");
    });

    it("ignores responses with non-matching correlationIds", async () => {
      const promise = rpcCall("getConfig");
      const sentId = mockPostMessage.mock.calls[0][0].id;

      // Send response for a different request
      dispatchMessage({
        type: "response",
        id: "resp_3",
        correlationId: "msg_999_999",
        result: {},
        timestamp: Date.now(),
      });

      // Our promise is still pending — resolve it properly
      dispatchMessage({
        type: "response",
        id: "resp_4",
        correlationId: sentId,
        result: { model: "gpt-4" },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result).toEqual({ model: "gpt-4" });
    });

    it("generates unique ids for concurrent calls", () => {
      rpcCall("methodA");
      rpcCall("methodB");
      const id1 = mockPostMessage.mock.calls[0][0].id;
      const id2 = mockPostMessage.mock.calls[1][0].id;
      expect(id1).not.toBe(id2);
    });
  });

  describe("onEvent", () => {
    it("calls handler when matching event fires", () => {
      const handler = vi.fn();
      onEvent("agent_status_changed", handler);

      dispatchMessage({
        type: "event",
        event: "agent_status_changed",
        data: { agentId: "cortex-0", status: "busy" },
        id: "evt_1",
        timestamp: Date.now(),
      });

      expect(handler).toHaveBeenCalledWith({ agentId: "cortex-0", status: "busy" });
    });

    it("does not call handler for different events", () => {
      const handler = vi.fn();
      onEvent("task_updated", handler);

      dispatchMessage({
        type: "event",
        event: "agent_status_changed",
        data: {},
        id: "evt_2",
        timestamp: Date.now(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("returns an unsubscribe function", () => {
      const handler = vi.fn();
      const unsub = onEvent("chat_message", handler);
      unsub();

      dispatchMessage({
        type: "event",
        event: "chat_message",
        data: { content: "hello" },
        id: "evt_3",
        timestamp: Date.now(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("handles multiple listeners for same event", () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      onEvent("task_created", h1);
      onEvent("task_created", h2);

      dispatchMessage({
        type: "event",
        event: "task_created",
        data: { id: "task_1" },
        id: "evt_4",
        timestamp: Date.now(),
      });

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("handles navigate events from extension host", () => {
      const handler = vi.fn();
      onEvent("navigate", handler);

      dispatchMessage({ type: "navigate", tab: "tasks" });

      expect(handler).toHaveBeenCalledWith("tasks");
    });
  });

  describe("state persistence", () => {
    it("saves state via VS Code API", () => {
      saveState({ activeTab: "chat" });
      expect(mockSetState).toHaveBeenCalledWith({ activeTab: "chat" });
    });

    it("loads state via VS Code API", () => {
      mockGetState.mockReturnValueOnce({ activeTab: "agents" });
      const state = loadState<{ activeTab: string }>();
      expect(state).toEqual({ activeTab: "agents" });
    });

    it("returns undefined when no saved state", () => {
      mockGetState.mockReturnValueOnce(undefined);
      expect(loadState()).toBeUndefined();
    });
  });
});
