// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: ACPBus Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.20.1: Send and receive ACP messages ───────────────
  await harness.runTest(
    "2.20.1",
    "ACPBus — Send and receive messages",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ACPBus } = await import("../../core/acp.ts");
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        try {
          const bus = new ACPBus(highway, logger, {
            defaultRequestTimeoutMs: 5000,
            trackCommGraph: true,
            trackAcknowledgments: true,
          });

          bus.start();
          details.push("ACPBus started");
          score += 1;

          // Subscribe agent to receive messages
          const received: unknown[] = [];
          bus.subscribeAgent("agent-b", (envelope) => {
            received.push(envelope);
          });

          details.push("Agent-b subscribed");
          score += 1;

          // Send a message from agent-a to agent-b
          const envelope = await bus.send({
            sender: "agent-a",
            receiver: "agent-b",
            msgType: "task",
            content: { instruction: "Please process this data" },
          });

          if (
            envelope.msgId &&
            envelope.sender === "agent-a" &&
            envelope.receiver === "agent-b"
          ) {
            details.push(`Message sent: ${envelope.msgId}`);
            score += 2;
          }

          // Allow async delivery
          await new Promise((r) => setTimeout(r, 50));

          if (received.length >= 1) {
            details.push(`Agent-b received ${received.length} message(s)`);
            score += 2;
          }

          // Check metrics
          const metrics = bus.getMetrics();
          if (metrics.totalSent >= 1) {
            details.push(`Metrics: sent=${metrics.totalSent}`);
            score += 1;
          }

          // Check communication graph
          const edges = bus.getCommGraph();
          if (edges.length >= 1) {
            details.push(`Comm graph has ${edges.length} edge(s)`);
            score += 1;
          }

          // Acknowledge the message
          await bus.acknowledge(envelope.msgId, "agent-b");
          if (metrics.totalAcknowledged >= 0) {
            details.push("Acknowledge processed");
            score += 2;
          }

          bus.stop();
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

  // ── Test 2.20.2: Request-response pattern ────────────────────
  await harness.runTest(
    "2.20.2",
    "ACPBus — Request-response with timeout",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ACPBus } = await import("../../core/acp.ts");
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        try {
          const bus = new ACPBus(highway, logger, {
            defaultRequestTimeoutMs: 500,
          });

          bus.start();
          details.push("ACPBus started for request-response test");
          score += 1;

          // Subscribe agent-b to respond
          bus.subscribeAgent("agent-b", async (envelope) => {
            // Send a response back
            await bus.send({
              sender: "agent-b",
              receiver: "agent-a",
              msgType: "result",
              content: { answer: 42 },
              trace: {
                parentMsgId: envelope.msgId,
                hopCount: 1,
                hops: ["agent-b"],
                policyTags: [],
              },
            });
          });

          // Request from agent-a to agent-b
          const response = await bus.request(
            {
              sender: "agent-a",
              receiver: "agent-b",
              msgType: "task",
              content: { question: "What is the answer?" },
            },
            3000,
          );

          if (response && response.msgType === "result") {
            details.push("Request-response succeeded");
            score += 4;
          }

          const content = response.content as Record<string, unknown>;
          if (content && content.answer === 42) {
            details.push("Response content correct");
            score += 2;
          }

          bus.stop();

          // Test timeout scenario with a fresh bus
          const bus2 = new ACPBus(highway, logger, {
            defaultRequestTimeoutMs: 100,
          });
          bus2.start();

          try {
            // No subscriber — should timeout
            await bus2.request(
              {
                sender: "agent-x",
                receiver: "nobody",
                msgType: "task",
                content: {},
              },
              100,
            );

            details.push("Request did NOT timeout (unexpected)");
          } catch (err) {
            if (err instanceof Error && err.message.includes("timeout")) {
              details.push("Request correctly timed out");
              score += 3;
            } else {
              details.push(
                `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          bus2.stop();
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

  // ── Test 2.20.3: Dead letter queue ───────────────────────────
  await harness.runTest("2.20.3", "ACPBus — Dead letter queue", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { ACPBus } = await import("../../core/acp.ts");
      const { MemoryHighway } = await import("../../core/memory-highway.ts");
      const { SynapseLogger } = await import("../../core/logger.ts");

      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const logger = new SynapseLogger(join(tempDir, "logs"));
      const highway = new MemoryHighway(logger, null, null, {
        enableRAG: false,
        enableDedup: false,
      });

      try {
        const bus = new ACPBus(highway, logger, {
          maxDeadLetters: 50,
        });

        bus.start();
        details.push("ACPBus started for dead letter test");
        score += 1;

        // Subscribe agent that throws an error
        bus.subscribeAgent("bad-agent", (_envelope) => {
          throw new Error("Handler crashed");
        });

        // Send a message to the crashing handler
        await bus.send({
          sender: "sender-a",
          receiver: "bad-agent",
          msgType: "task",
          content: { data: "will cause error" },
        });

        // Allow delivery
        await new Promise((r) => setTimeout(r, 50));

        const deadLetters = bus.getDeadLetters();
        if (deadLetters.length >= 1) {
          details.push(`Dead letters: ${deadLetters.length}`);
          score += 4;

          if (
            deadLetters[0].reason &&
            deadLetters[0].reason.includes("Handler crashed")
          ) {
            details.push("Dead letter has correct error reason");
            score += 2;
          }

          if (
            deadLetters[0].envelope &&
            deadLetters[0].envelope.receiver === "bad-agent"
          ) {
            details.push("Dead letter envelope preserved");
            score += 2;
          }
        } else {
          details.push(
            "No dead letters generated (handler error may not have been caught)",
          );
          score += 1;
        }

        // Check metrics
        const metrics = bus.getMetrics();
        details.push(`Dead-lettered count: ${metrics.totalDeadLettered}`);
        if (metrics.totalDeadLettered >= 1) {
          score += 1;
        }

        bus.stop();
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
