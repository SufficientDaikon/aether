// Phase 17.03: Resource Limits Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("17.03.1", "Limits — ConversationManager trims at maxMessages", async () => {
    const tmpDir = join(import.meta.dir, `.limits-tmp1-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const { SQLiteStore } = await import(join(ROOT, "core/storage/sqlite-store.ts"));
    const { ConversationManager } = await import(join(ROOT, "core/conversation.ts"));
    const store = new SQLiteStore(tmpDir);
    await store.init();
    const mgr = new ConversationManager(store, 10); // low limit
    const convId = mgr.create(["agent-a", "agent-b"]);

    // Add 15 messages
    for (let i = 0; i < 15; i++) {
      mgr.addMessage(convId, "agent-a", "assistant", `message ${i}`);
    }

    const history = mgr.getHistory(convId);
    const trimmed = history.length <= 10;
    // Clean up after SQLite releases lock
    setTimeout(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} }, 500);
    return {
      score: trimmed ? 10 : history.length <= 15 ? 7 : 0,
      maxScore: 10,
      details: `messages after trim: ${history.length} (limit: 10)`,
    };
  });

  await harness.runTest("17.03.2", "Limits — OutputLengthGuard truncates long output", async () => {
    const { OutputLengthGuard } = await import(join(ROOT, "core/guardrails.ts"));
    const guard = new OutputLengthGuard(1000); // 1KB limit
    const agent = { id: "test", name: "Test", tier: "worker" } as any;
    const longOutput = "x".repeat(2000);
    const result = guard.check(longOutput, agent);
    // OutputLengthGuard returns allowed=true with modified (truncated) content
    const truncated = result.modified != null && result.modified.length < longOutput.length;
    return {
      score: truncated ? 10 : 0,
      maxScore: 10,
      details: `truncated: ${truncated} modified length=${result.modified?.length ?? "none"} reason=${result.reason ?? "none"}`,
    };
  });

  await harness.runTest("17.03.3", "Limits — LengthGuard blocks oversized prompt", async () => {
    const { LengthGuard } = await import(join(ROOT, "core/guardrails.ts"));
    const guard = new LengthGuard(100);
    const agent = { id: "test", name: "Test", tier: "worker" } as any;
    const longPrompt = "a".repeat(200);
    const result = guard.check(longPrompt, agent);
    return {
      score: !result.allowed ? 10 : 0,
      maxScore: 10,
      details: `prompt blocked: ${!result.allowed}`,
    };
  });
}
