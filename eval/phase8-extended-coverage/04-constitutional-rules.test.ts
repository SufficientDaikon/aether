// ─────────────────────────────────────────────────────────────
// Phase 8.04: Constitutional Rules Engine Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "8.04.1",
    "ConstitutionalRules — default rules load",
    async () => {
      const { ConstitutionalRulesEngine } = await import(
        join(ROOT, "core/constitutional-rules.ts")
      );
      const engine = new ConstitutionalRulesEngine();
      const count = engine.getRules().length;
      return {
        score: count > 0 ? 10 : 0,
        maxScore: 10,
        details: `${count} default rules loaded`,
      };
    },
  );

  await harness.runTest(
    "8.04.2",
    "ConstitutionalRules — block DROP TABLE for worker",
    async () => {
      const { ConstitutionalRulesEngine } = await import(
        join(ROOT, "core/constitutional-rules.ts")
      );
      const engine = new ConstitutionalRulesEngine();
      const result = engine.evaluate({
        agentId: "test-worker",
        agentTier: "worker",
        type: "shell_exec",
        details: { command: "DROP TABLE users" },
      });
      return {
        score: !result.allowed ? 10 : 0,
        maxScore: 10,
        details: `allowed=${result.allowed} enforcement=${result.enforcement}`,
      };
    },
  );

  await harness.runTest(
    "8.04.3",
    "ConstitutionalRules — allow SELECT for worker",
    async () => {
      const { ConstitutionalRulesEngine } = await import(
        join(ROOT, "core/constitutional-rules.ts")
      );
      const engine = new ConstitutionalRulesEngine();
      const result = engine.evaluate({
        agentId: "test-worker",
        agentTier: "worker",
        type: "shell_exec",
        details: { command: "SELECT * FROM users" },
      });
      return {
        score: result.allowed ? 10 : 0,
        maxScore: 10,
        details: `allowed=${result.allowed}`,
      };
    },
  );

  await harness.runTest(
    "8.04.4",
    "ConstitutionalRules — block rm -rf /",
    async () => {
      const { ConstitutionalRulesEngine } = await import(
        join(ROOT, "core/constitutional-rules.ts")
      );
      const engine = new ConstitutionalRulesEngine();
      const result = engine.evaluate({
        agentId: "any-agent",
        agentTier: "master",
        type: "shell_exec",
        details: { command: "rm -rf /" },
      });
      return {
        score: !result.allowed ? 10 : 0,
        maxScore: 10,
        details: `allowed=${result.allowed} rule=${result.ruleId}`,
      };
    },
  );

  await harness.runTest(
    "8.04.5",
    "ConstitutionalRules — block secret exposure",
    async () => {
      const { ConstitutionalRulesEngine } = await import(
        join(ROOT, "core/constitutional-rules.ts")
      );
      const engine = new ConstitutionalRulesEngine();
      const result = engine.evaluate({
        agentId: "test",
        agentTier: "worker",
        type: "file_write",
        details: { content: "password = 'secret123'" },
      });
      return {
        score: !result.allowed ? 10 : 0,
        maxScore: 10,
        details: `allowed=${result.allowed} rule=${result.ruleId}`,
      };
    },
  );
}
