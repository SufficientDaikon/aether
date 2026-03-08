// ─────────────────────────────────────────────────────────────
// Phase 8.07: Group Chat Tests (without live LLM)
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "8.07.1",
    "RoundRobinSelector — cycles through agents",
    async () => {
      const { RoundRobinSelector } = await import(
        join(ROOT, "core/group-chat.ts")
      );
      const selector = new RoundRobinSelector();
      const agents = [
        { id: "a", name: "A", capabilities: [] },
        { id: "b", name: "B", capabilities: [] },
        { id: "c", name: "C", capabilities: [] },
      ] as any[];
      const s0 = selector.selectNext([], agents, 0);
      const s1 = selector.selectNext([], agents, 1);
      const s2 = selector.selectNext([], agents, 2);
      const s3 = selector.selectNext([], agents, 3);
      const cycled =
        s0.id === "a" && s1.id === "b" && s2.id === "c" && s3.id === "a";
      return {
        score: cycled ? 10 : 0,
        maxScore: 10,
        details: `sequence=${s0.id},${s1.id},${s2.id},${s3.id}`,
      };
    },
  );

  await harness.runTest(
    "8.07.2",
    "CapabilitySelector — picks by topic",
    async () => {
      const { CapabilitySelector } = await import(
        join(ROOT, "core/group-chat.ts")
      );
      const selector = new CapabilitySelector();
      const agents = [
        {
          id: "frontend",
          name: "Frontend",
          capabilities: ["react", "css", "ui"],
        },
        {
          id: "backend",
          name: "Backend",
          capabilities: ["database", "api", "sql"],
        },
        {
          id: "security",
          name: "Security",
          capabilities: ["auth", "encryption", "vulnerability"],
        },
      ] as any[];
      const history = [
        {
          role: "user",
          content:
            "We need to fix the database query performance issue with SQL indexes",
        },
      ] as any[];
      const selected = selector.selectNext(history, agents, 0);
      const isBackend = selected.id === "backend";
      return {
        score: isBackend ? 10 : 5,
        maxScore: 10,
        details: `selected=${selected.id} (expected backend)`,
      };
    },
  );

  await harness.runTest(
    "8.07.3",
    "MaxRoundsTermination — stops at limit",
    async () => {
      const { MaxRoundsTerminator } = await import(
        join(ROOT, "core/group-chat.ts")
      );
      const term = new MaxRoundsTerminator(3);
      const msgs: any[] = [];
      const r1 = term.shouldTerminate(msgs, 1);
      const r3 = term.shouldTerminate(msgs, 3);
      const r4 = term.shouldTerminate(msgs, 4);
      const ok = !r1 && r3;
      return {
        score: ok ? 10 : 0,
        maxScore: 10,
        details: `round1=${r1} round3=${r3} round4=${r4}`,
      };
    },
  );
}
