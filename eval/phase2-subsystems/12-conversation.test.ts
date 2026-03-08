// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: ConversationManager Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.12.1: Create conversation, add messages, get history ──
  await harness.runTest(
    "2.12.1",
    "ConversationManager — Create, add messages, get history",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ConversationManager } =
          await import("../../core/conversation.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const convMgr = new ConversationManager(store, 100);
          details.push("ConversationManager created");
          score += 1;

          // Create conversation
          const convId = convMgr.create(["agent-a", "agent-b"], {
            topic: "testing",
          });
          if (convId && typeof convId === "string") {
            details.push(`Created conversation: ${convId}`);
            score += 2;
          } else {
            details.push("create() did not return a valid ID");
          }

          // Add messages
          const msg1 = convMgr.addMessage(
            convId,
            "agent-a",
            "user",
            "Hello, can you help me?",
          );
          const msg2 = convMgr.addMessage(
            convId,
            "agent-b",
            "assistant",
            "Of course! What do you need?",
          );
          const msg3 = convMgr.addMessage(
            convId,
            "agent-a",
            "user",
            "I need help with React.",
          );

          if (msg1 && msg2 && msg3 && msg1.id && msg2.id && msg3.id) {
            details.push("Added 3 messages successfully");
            score += 2;
          }

          // Get history
          const history = convMgr.getHistory(convId);
          if (Array.isArray(history) && history.length === 3) {
            details.push(`getHistory returned ${history.length} messages`);
            score += 2;
          } else {
            details.push(
              `getHistory returned ${Array.isArray(history) ? history.length : "non-array"} messages`,
            );
            score += 1;
          }

          // Get conversation state
          const conv = convMgr.get(convId);
          if (conv && conv.id === convId && Array.isArray(conv.participants)) {
            details.push(
              `get() returned conversation with ${conv.participants.length} participants`,
            );
            score += 2;
          }

          // Get history with limit
          const limited = convMgr.getHistory(convId, 2);
          if (Array.isArray(limited) && limited.length <= 2) {
            details.push(
              `getHistory with limit=2 returned ${limited.length} message(s)`,
            );
            score += 1;
          }

          await store.close();
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

  // ── Test 2.12.2: Auto-trim when exceeding max ────────────
  await harness.runTest(
    "2.12.2",
    "ConversationManager — Auto-trim when exceeding max messages",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ConversationManager } =
          await import("../../core/conversation.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          // Create manager with very low max to test trimming
          const maxMessages = 5;
          const convMgr = new ConversationManager(store, maxMessages);

          const convId = convMgr.create(["agent-a", "agent-b"]);
          details.push(`Created conversation with maxMessages=${maxMessages}`);
          score += 2;

          // Add more messages than the max
          for (let i = 0; i < 8; i++) {
            convMgr.addMessage(
              convId,
              i % 2 === 0 ? "agent-a" : "agent-b",
              i % 2 === 0 ? "user" : "assistant",
              `Message ${i + 1}`,
            );
          }
          details.push("Added 8 messages (exceeds max of 5)");
          score += 2;

          // Check that messages were trimmed
          const history = convMgr.getHistory(convId);
          if (Array.isArray(history)) {
            details.push(`After trim, history has ${history.length} messages`);

            if (history.length <= maxMessages) {
              details.push("History correctly trimmed to max limit");
              score += 4;
            } else {
              details.push(
                `History NOT trimmed: ${history.length} > ${maxMessages}`,
              );
              score += 1;
            }

            // Verify most recent messages are preserved (trim removes oldest)
            if (history.length > 0) {
              const lastMsg = history[history.length - 1];
              if (lastMsg.content === "Message 8") {
                details.push("Most recent message preserved after trim");
                score += 2;
              } else {
                details.push(`Last message content: "${lastMsg.content}"`);
                score += 1;
              }
            }
          }

          await store.close();
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
}
