// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: MemoryHighway Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.6.1: Subscribe and Publish ─────────────────────
  await harness.runTest(
    "2.6.1",
    "MemoryHighway — Subscribe to channel, publish message, verify delivery",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const highway = new MemoryHighway(logger, null, null, {
            enableRAG: false,
            enableDedup: false,
          });

          let received: any = null;

          // Subscribe to a channel
          const unsub = highway.subscribe("test-channel", (msg) => {
            received = msg;
          });
          details.push("Subscribed to test-channel");
          score += 1;

          // Publish a message
          const sent = await highway.publish(
            "test-channel",
            "event",
            { data: "hello" },
            {
              summary: "Test message",
              sender: "eval-agent",
            },
          );
          details.push(`Published message: ${sent.id}`);
          score += 1;

          // Verify delivery
          if (received && received.id === sent.id) {
            details.push("Message delivered to subscriber");
            score += 2;
          } else {
            details.push("Message NOT delivered to subscriber");
          }

          // Verify message content
          if (received && received.summary === "Test message") {
            details.push("Message content correct");
            score += 1;
          }

          // Unsubscribe
          unsub();
          received = null;
          await highway.publish(
            "test-channel",
            "event",
            { data: "after unsub" },
            {
              summary: "Should not be received",
            },
          );

          if (received === null) {
            details.push("After unsubscribe, no delivery");
            score += 1;
          }

          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.6.2: Channel Isolation ─────────────────────────
  await harness.runTest(
    "2.6.2",
    "MemoryHighway — Channel isolation",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const highway = new MemoryHighway(logger, null, null, {
            enableRAG: false,
            enableDedup: false,
          });

          let channelAReceived = 0;
          let channelBReceived = 0;

          highway.subscribe("channel-a", () => {
            channelAReceived++;
          });
          highway.subscribe("channel-b", () => {
            channelBReceived++;
          });

          // Publish to channel-a only
          await highway.publish("channel-a", "event", "data-a", {
            summary: "For A",
          });
          await highway.publish("channel-a", "event", "data-a2", {
            summary: "For A again",
          });

          // Publish to channel-b
          await highway.publish("channel-b", "event", "data-b", {
            summary: "For B",
          });

          if (channelAReceived === 2) {
            details.push("Channel A received exactly 2 messages");
            score += 3;
          } else {
            details.push(
              `Channel A received ${channelAReceived} messages (expected 2)`,
            );
          }

          if (channelBReceived === 1) {
            details.push("Channel B received exactly 1 message");
            score += 3;
          } else {
            details.push(
              `Channel B received ${channelBReceived} messages (expected 1)`,
            );
          }

          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.6.3: Wildcard Subscriber ───────────────────────
  await harness.runTest(
    "2.6.3",
    "MemoryHighway — Wildcard subscriber receives all",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const highway = new MemoryHighway(logger, null, null, {
            enableRAG: false,
            enableDedup: false,
          });

          let wildcardCount = 0;
          highway.subscribe("*", () => {
            wildcardCount++;
          });

          await highway.publish("tasks", "task", "task data", {
            summary: "task msg",
          });
          await highway.publish("results", "result", "result data", {
            summary: "result msg",
          });
          await highway.publish("events", "event", "event data", {
            summary: "event msg",
          });

          if (wildcardCount === 3) {
            details.push(
              "Wildcard subscriber received all 3 messages across channels",
            );
            score += 6;
          } else {
            details.push(
              `Wildcard subscriber received ${wildcardCount}/3 messages`,
            );
            score += Math.min(wildcardCount * 2, 4);
          }

          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.6.4: Broadcast ────────────────────────────────
  await harness.runTest(
    "2.6.4",
    "MemoryHighway — Broadcast message",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");

        try {
          const highway = new MemoryHighway(logger, null, null, {
            enableRAG: false,
            enableDedup: false,
          });

          let received: any = null;
          highway.subscribe("*", (msg) => {
            received = msg;
          });

          const msg = await highway.broadcast("broadcast", "System alert!", {
            summary: "Broadcast test",
            sender: "system",
          });

          if (msg && msg.channel === "*") {
            details.push("Broadcast sent to wildcard channel");
            score += 2;
          }

          if (received && received.channel === "*") {
            details.push("Broadcast received by wildcard subscriber");
            score += 2;
          }

          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.6.5: KV set/get ───────────────────────────────
  await harness.runTest("2.6.5", "MemoryHighway — KV set/get", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 4;
    const details: string[] = [];

    try {
      const { MemoryHighway } = await import("../../core/memory-highway.ts");
      const { SynapseLogger } = await import("../../core/logger.ts");

      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const logger = new SynapseLogger(tempDir, "debug");

      try {
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        await highway.set("test-key", { value: 42 });
        const value = await highway.get("test-key");
        if (value && (value as any).value === 42) {
          details.push("KV set/get works correctly");
          score += 2;
        } else {
          details.push(`KV get returned: ${JSON.stringify(value)}`);
        }

        // Check has
        const exists = await highway.has("test-key");
        if (exists) {
          details.push("has() returns true for existing key");
          score += 1;
        }

        // Delete
        await highway.del("test-key");
        const afterDel = await highway.get("test-key");
        if (!afterDel) {
          details.push("del() removes the key");
          score += 1;
        }

        await logger.close();
      } catch (err) {
        details.push(
          `Inner error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      details.push(
        `Import error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (tempDir)
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    return { score, maxScore, details: details.join("; ") };
  });

  // ── Test 2.6.6: Deduplication ────────────────────────────
  await harness.runTest("2.6.6", "MemoryHighway — Deduplication", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 4;
    const details: string[] = [];

    try {
      const { MemoryHighway } = await import("../../core/memory-highway.ts");
      const { SynapseLogger } = await import("../../core/logger.ts");

      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const logger = new SynapseLogger(tempDir, "debug");

      try {
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: true,
          dedupWindowMs: 5_000,
        });

        let deliveryCount = 0;
        highway.subscribe("dedup-channel", () => {
          deliveryCount++;
        });

        // Send the same message twice
        await highway.publish("dedup-channel", "event", "duplicate data", {
          summary: "exact same message",
          sender: "agent-a",
        });
        await highway.publish("dedup-channel", "event", "duplicate data", {
          summary: "exact same message",
          sender: "agent-a",
        });

        // With dedup enabled, second message should be dropped
        if (deliveryCount === 1) {
          details.push("Deduplication blocked duplicate message");
          score += 4;
        } else {
          details.push(
            `deliveryCount = ${deliveryCount} (expected 1 with dedup)`,
          );
          // Might be 2 if dedup is hash-based and doesn't match
          score += 1;
        }

        const metrics = highway.getMetrics();
        if (metrics.duplicatesBlocked >= 1) {
          details.push(`duplicatesBlocked = ${metrics.duplicatesBlocked}`);
        }

        await logger.close();
      } catch (err) {
        details.push(
          `Inner error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      details.push(
        `Import error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (tempDir)
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    return { score, maxScore, details: details.join("; ") };
  });
}
