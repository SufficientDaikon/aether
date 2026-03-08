// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: HandoffManager Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { registerFullHierarchy, makeAgent } from "../helpers/agent-fixtures.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.14.1: Successful handoff A -> B ────────────────
  await harness.runTest(
    "2.14.1",
    "HandoffManager — Successful handoff A -> B",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { HandoffManager } = await import("../../core/handoff.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const registry = new AgentRegistry();
          registerFullHierarchy(registry);

          const handoffMgr = new HandoffManager(store, 5);
          details.push("HandoffManager created");
          score += 1;

          // Handoff from react-specialist to db-architect
          const result = handoffMgr.handoff(
            {
              fromAgent: "react-specialist",
              toAgent: "db-architect",
              reason: "Need database schema help for user management",
              preserveHistory: true,
              taskContext: {
                currentTask: "user-management",
                phase: "schema-design",
              },
            },
            (id: string) => registry.get(id) ?? null,
          );

          if (result.success) {
            details.push("Handoff succeeded");
            score += 3;
          } else {
            details.push(`Handoff failed: ${result.reason}`);
          }

          if (result.fromAgent === "react-specialist") {
            details.push("fromAgent correct");
            score += 1;
          }

          if (result.toAgent === "db-architect") {
            details.push("toAgent correct");
            score += 1;
          }

          if (result.conversationId && result.conversationId.length > 0) {
            details.push(`Conversation created: ${result.conversationId}`);
            score += 2;

            // Verify handoff context
            const ctx = handoffMgr.getHandoffContext(result.conversationId);
            if (ctx && ctx.handoffChain && ctx.handoffChain.length >= 1) {
              details.push(`Handoff chain: [${ctx.handoffChain.join(", ")}]`);
              score += 1;
            }

            if (ctx.messages && ctx.messages.length >= 1) {
              details.push(
                `Conversation has ${ctx.messages.length} message(s) after handoff`,
              );
              score += 1;
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

  // ── Test 2.14.2: Cycle Detection ──────────────────────────
  await harness.runTest(
    "2.14.2",
    "HandoffManager — Cycle detection",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { HandoffManager } = await import("../../core/handoff.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const registry = new AgentRegistry();
          registerFullHierarchy(registry);

          const handoffMgr = new HandoffManager(store, 5);

          const resolver = (id: string) => registry.get(id) ?? null;

          // First handoff: A -> B
          const r1 = handoffMgr.handoff(
            {
              fromAgent: "react-specialist",
              toAgent: "db-architect",
              reason: "Need database help",
              preserveHistory: true,
              taskContext: {},
            },
            resolver,
          );

          if (r1.success) {
            details.push(`First handoff succeeded: conv=${r1.conversationId}`);
            score += 2;
          }

          // Second handoff: B -> C using same conversation
          const r2 = handoffMgr.handoff(
            {
              fromAgent: "db-architect",
              toAgent: "system-architect",
              reason: "Need architecture review",
              conversationId: r1.conversationId,
              preserveHistory: true,
              taskContext: {},
            },
            resolver,
          );

          if (r2.success) {
            details.push("Second handoff succeeded: B -> C");
            score += 2;
          }

          // Third handoff: C -> A (this creates a cycle: A -> B -> C -> A)
          const r3 = handoffMgr.handoff(
            {
              fromAgent: "system-architect",
              toAgent: "react-specialist",
              reason: "Sending back to frontend",
              conversationId: r1.conversationId,
              preserveHistory: true,
              taskContext: {},
            },
            resolver,
          );

          if (!r3.success) {
            details.push("Cycle correctly detected and blocked: C -> A");
            score += 4;

            if (r3.reason && r3.reason.toLowerCase().includes("cycle")) {
              details.push(`Reason mentions cycle: "${r3.reason}"`);
              score += 2;
            }
          } else {
            details.push(
              "Cycle NOT detected (handoff succeeded when it should have failed)",
            );
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
