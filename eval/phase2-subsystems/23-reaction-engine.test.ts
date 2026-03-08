// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: ReactionEngine Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.23.1: Add rule, trigger via publish, verify action ──
  await harness.runTest(
    "2.23.1",
    "ReactionEngine — Rule trigger and action execution",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ReactionEngine } =
          await import("../../core/reaction-engine.ts");
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        try {
          const engine = new ReactionEngine(highway);
          details.push("ReactionEngine created");
          score += 1;

          const actionsFired: Array<{ ruleId: string; channel: string }> = [];

          // Set action handler
          engine.setActionHandler(async (rule, message) => {
            actionsFired.push({ ruleId: rule.id, channel: message.channel });
          });

          // Add a rule that fires when "tasks" channel receives events
          engine.addRule({
            id: "rule-on-task",
            trigger: {
              channel: "tasks",
              messageType: "event",
            },
            action: {
              type: "execute_task",
              target: "agent-handler",
              taskTemplate: "Handle the incoming task",
            },
            cooldownMs: 0,
            maxFires: 0,
            enabled: true,
          });

          const rules = engine.getRules();
          if (rules.length === 1) {
            details.push("1 rule registered");
            score += 1;
          }

          // Start engine
          engine.start();
          if (engine.isRunning()) {
            details.push("Engine started");
            score += 1;
          }

          // Publish a message to the "tasks" channel
          await highway.publish("tasks", "event", {
            taskId: "t-1",
            description: "Test task",
          });

          // Allow async processing
          await new Promise((r) => setTimeout(r, 50));

          if (actionsFired.length >= 1) {
            details.push(
              `Action fired: ruleId=${actionsFired[0].ruleId}, channel=${actionsFired[0].channel}`,
            );
            score += 4;
          } else {
            details.push("No actions fired (check message processing)");
          }

          // Check reaction log
          const log = engine.getLog();
          const firedEntries = log.filter((l) => l.fired);
          if (firedEntries.length >= 1) {
            details.push(`Reaction log: ${firedEntries.length} fired`);
            score += 2;
          }

          // Publish a non-matching message — should NOT trigger
          await highway.publish("other-channel", "event", {
            data: "unrelated",
          });
          await new Promise((r) => setTimeout(r, 50));

          const totalFired = actionsFired.length;
          // Should still be the same count as before (only 1)
          if (totalFired === 1) {
            details.push("Non-matching channel correctly ignored");
            score += 1;
          }

          engine.stop();
          if (!engine.isRunning()) {
            details.push("Engine stopped");
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

  // ── Test 2.23.2: Cooldown and maxFires ───────────────────────
  await harness.runTest(
    "2.23.2",
    "ReactionEngine — Cooldown and maxFires limits",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { ReactionEngine } =
          await import("../../core/reaction-engine.ts");
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        try {
          const engine = new ReactionEngine(highway);

          let fireCount = 0;
          engine.setActionHandler(async () => {
            fireCount++;
          });

          // Rule with maxFires=2
          engine.addRule({
            id: "limited-rule",
            trigger: { channel: "alerts" },
            action: { type: "notify" },
            cooldownMs: 0,
            maxFires: 2,
            enabled: true,
          });

          engine.start();
          details.push("Engine started with maxFires=2 rule");
          score += 1;

          // Fire 3 times
          await highway.publish("alerts", "event", { alert: 1 });
          await new Promise((r) => setTimeout(r, 30));
          await highway.publish("alerts", "event", { alert: 2 });
          await new Promise((r) => setTimeout(r, 30));
          await highway.publish("alerts", "event", { alert: 3 });
          await new Promise((r) => setTimeout(r, 30));

          if (fireCount === 2) {
            details.push("maxFires=2 correctly limited to 2 fires");
            score += 4;
          } else {
            details.push(`Fire count: ${fireCount} (expected 2)`);
            if (fireCount <= 2) score += 2;
          }

          // Check log for skipped entries
          const log = engine.getLog();
          const skipped = log.filter((l) => !l.fired && l.skippedReason);
          if (skipped.length >= 1) {
            details.push(`Skipped entries in log: ${skipped.length}`);
            score += 2;
          }

          // Test disable/enable
          engine.setRuleEnabled("limited-rule", false);
          const rules = engine.getRules();
          if (rules[0] && rules[0].enabled === false) {
            details.push("Rule disabled");
            score += 1;
          }

          // Reset counters
          engine.resetCounters();
          engine.setRuleEnabled("limited-rule", true);

          fireCount = 0;
          await highway.publish("alerts", "event", { alert: 4 });
          await new Promise((r) => setTimeout(r, 30));

          if (fireCount === 1) {
            details.push("After reset, rule fires again");
            score += 2;
          }

          engine.stop();
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
}
