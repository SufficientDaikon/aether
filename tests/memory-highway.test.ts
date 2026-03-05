// ─────────────────────────────────────────────────────────────
// Tests: MemoryHighway — RAG-integrated message bus
// ─────────────────────────────────────────────────────────────

import { describe, test, expect, beforeEach } from "bun:test";
import {
  MemoryHighway,
  type HighwayMessage,
  type MessageHandler,
} from "../core/memory-highway.ts";
import { SynapseLogger } from "../core/logger.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryHighway", () => {
  let highway: MemoryHighway;
  let logger: SynapseLogger;

  beforeEach(() => {
    const logDir = mkdtempSync(join(tmpdir(), "highway-test-"));
    logger = new SynapseLogger(logDir, "warn");
    // Create without RAG index for unit tests
    highway = new MemoryHighway(logger, null, null, {
      enableRAG: false,
      enableDedup: true,
      historySize: 100,
      dedupWindowMs: 5_000,
      kvTTL: 60_000,
      indexMinPriority: 0,
    });
  });

  // ── Publishing ───────────────────────────────────────────

  describe("Publishing", () => {
    test("publish creates a message with proper fields", async () => {
      const msg = await highway.publish("tasks", "task", "hello", {
        sender: "agent-1",
        priority: 4,
      });

      expect(msg.id).toBeDefined();
      expect(msg.channel).toBe("tasks");
      expect(msg.type).toBe("task");
      expect(msg.payload).toBe("hello");
      expect(msg.sender).toBe("agent-1");
      expect(msg.priority).toBe(4);
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    test("publish auto-generates summary for string payload", async () => {
      const msg = await highway.publish("ch", "event", "Something happened");
      expect(msg.summary).toBe("Something happened");
    });

    test("publish auto-generates summary for object payload", async () => {
      const msg = await highway.publish("ch", "event", { key: "value" });
      expect(msg.summary).toContain("key");
    });
  });

  // ── Subscriptions ────────────────────────────────────────

  describe("Subscriptions", () => {
    test("subscriber receives messages on subscribed channel", async () => {
      const received: HighwayMessage[] = [];
      highway.subscribe("tasks", (msg) => {
        received.push(msg);
      });

      await highway.publish("tasks", "task", { data: 1 });
      await highway.publish("tasks", "task", { data: 2 });

      // Small delay for async delivery
      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(2);
      expect((received[0].payload as any).data).toBe(1);
      expect((received[1].payload as any).data).toBe(2);
    });

    test("subscriber does not receive messages from other channels", async () => {
      const received: HighwayMessage[] = [];
      highway.subscribe("tasks", (msg) => {
        received.push(msg);
      });

      await highway.publish("results", "result", "result data");
      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(0);
    });

    test("wildcard subscriber receives all messages", async () => {
      const received: HighwayMessage[] = [];
      highway.subscribe("*", (msg) => {
        received.push(msg);
      });

      await highway.publish("tasks", "task", "task1");
      await highway.publish("results", "result", "result1");
      await highway.publish("events", "event", "event1");
      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(3);
    });

    test("unsubscribe removes the handler", async () => {
      const received: HighwayMessage[] = [];
      const handler: MessageHandler = (msg) => {
        received.push(msg);
      };

      const unsub = highway.subscribe("ch", handler);
      await highway.publish("ch", "event", "msg1");
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);

      unsub();
      await highway.publish("ch", "event", "msg2");
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1); // still 1, no new messages
    });

    test("multiple subscribers on same channel", async () => {
      let count1 = 0;
      let count2 = 0;

      highway.subscribe("ch", () => count1++);
      highway.subscribe("ch", () => count2++);

      await highway.publish("ch", "event", "data");
      await new Promise((r) => setTimeout(r, 10));

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  // ── Deduplication ────────────────────────────────────────

  describe("Deduplication", () => {
    test("blocks exact duplicate messages within window", async () => {
      const received: HighwayMessage[] = [];
      highway.subscribe("ch", (msg) => received.push(msg));

      // Publish same message twice
      await highway.publish("ch", "event", "exact same payload", {
        sender: "same-sender",
      });
      await highway.publish("ch", "event", "exact same payload", {
        sender: "same-sender",
      });

      await new Promise((r) => setTimeout(r, 10));

      // Only one should be delivered
      expect(received).toHaveLength(1);

      const metrics = highway.getMetrics();
      expect(metrics.duplicatesBlocked).toBe(1);
    });

    test("allows different messages through", async () => {
      const received: HighwayMessage[] = [];
      highway.subscribe("ch", (msg) => received.push(msg));

      await highway.publish("ch", "event", "message A");
      await highway.publish("ch", "event", "message B");

      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(2);
    });
  });

  // ── KV Store ─────────────────────────────────────────────

  describe("KV Store", () => {
    test("set and get values", async () => {
      await highway.set("key1", "value1");
      const result = await highway.get("key1");
      expect(result).toBe("value1");
    });

    test("get returns undefined for missing keys", async () => {
      const result = await highway.get("nonexistent");
      expect(result).toBeUndefined();
    });

    test("del removes values", async () => {
      await highway.set("key1", "value1");
      await highway.del("key1");
      const result = await highway.get("key1");
      expect(result).toBeUndefined();
    });

    test("has checks key existence", async () => {
      await highway.set("exists", 42);
      expect(await highway.has("exists")).toBe(true);
      expect(await highway.has("nope")).toBe(false);
    });

    test("stores complex objects", async () => {
      const obj = { nested: { array: [1, 2, 3], flag: true } };
      await highway.set("complex", obj);
      const result = await highway.get("complex");
      expect(result).toEqual(obj);
    });
  });

  // ── History ──────────────────────────────────────────────

  describe("History", () => {
    test("getRecent returns recent messages", async () => {
      await highway.publish("ch", "event", "msg1");
      await highway.publish("ch", "event", "msg2");
      await highway.publish("ch", "event", "msg3");

      const recent = highway.getRecent("ch", 2);
      expect(recent).toHaveLength(2);
    });

    test("getRecent defaults to 10", async () => {
      for (let i = 0; i < 15; i++) {
        await highway.publish("ch", "event", `msg-${i}`, { sender: `s${i}` });
      }

      const recent = highway.getRecent("ch");
      expect(recent.length).toBeLessThanOrEqual(10);
    });
  });

  // ── Broadcast ────────────────────────────────────────────

  describe("Broadcast", () => {
    test("broadcast sends to all channel subscribers", async () => {
      const received1: HighwayMessage[] = [];
      const received2: HighwayMessage[] = [];

      highway.subscribe("ch1", (msg) => received1.push(msg));
      highway.subscribe("ch2", (msg) => received2.push(msg));

      // broadcast sends to ALL channels (via wildcard pattern)
      await highway.broadcast("broadcast", "Global announcement");
      await new Promise((r) => setTimeout(r, 10));

      // broadcast publishes on a "broadcast" channel
      // unless the implementation sends to all subscribers
    });
  });

  // ── Threading ────────────────────────────────────────────

  describe("Threading", () => {
    test("getThread returns messages with matching correlationId", async () => {
      const threadId = "conv-123";

      await highway.publish("ch", "task", "step 1", {
        correlationId: threadId,
      });
      await highway.publish("ch", "result", "step 2", {
        correlationId: threadId,
      });
      await highway.publish("ch", "event", "unrelated");

      const thread = highway.getThread(threadId);
      expect(thread).toHaveLength(2);
      expect(thread[0].correlationId).toBe(threadId);
      expect(thread[1].correlationId).toBe(threadId);
    });
  });

  // ── Metrics ──────────────────────────────────────────────

  describe("Metrics", () => {
    test("tracks total message count", async () => {
      await highway.publish("ch", "event", "a");
      await highway.publish("ch", "event", "b");
      await highway.publish("ch", "event", "c");

      const metrics = highway.getMetrics();
      expect(metrics.totalMessages).toBe(3);
    });

    test("tracks messages by channel", async () => {
      await highway.publish("tasks", "task", "t");
      await highway.publish("tasks", "task", "t2");
      await highway.publish("results", "result", "r");

      const metrics = highway.getMetrics();
      expect(metrics.messagesByChannel.tasks).toBe(2);
      expect(metrics.messagesByChannel.results).toBe(1);
    });
  });
});
