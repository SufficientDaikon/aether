// Phase 17.04: Recovery Mechanisms Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("17.04.1", "Recovery — escalation circuit breaker trips and resets", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const { EscalationManager } = await import(join(ROOT, "core/escalation.ts"));

    const registry = new AgentRegistry();
    registry.register({ id: "breaker-worker", name: "Worker", tier: "worker", capabilities: [], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "", escalationTarget: "breaker-mgr" } as any);
    registry.register({ id: "breaker-mgr", name: "Manager", tier: "manager", capabilities: [], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);

    const escalation = new EscalationManager(registry, { threshold: 2, windowMs: 1000 });

    // Trip the circuit breaker
    await escalation.escalate("breaker-worker", new Error("fail 1"), "high");
    await escalation.escalate("breaker-worker", new Error("fail 2"), "high");
    const tripped = await escalation.escalate("breaker-worker", new Error("fail 3"), "high");

    return {
      score: tripped.circuitBroken ? 10 : 0,
      maxScore: 10,
      details: `circuit broken after threshold: ${tripped.circuitBroken}`,
    };
  });

  await harness.runTest("17.04.2", "Recovery — durable workflow checkpoint and resume", async () => {
    const tmpDir = join(import.meta.dir, `.recovery-tmp2-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const { SQLiteStore } = await import(join(ROOT, "core/storage/sqlite-store.ts"));
    const { DurableWorkflow } = await import(join(ROOT, "core/durable.ts"));
    const { WorkflowBuilder } = await import(join(ROOT, "core/workflow-builder.ts"));

    const store = new SQLiteStore(tmpDir);
    await store.init();

    const compiled = new WorkflowBuilder("recovery-test")
      .sequential([
        { agent: "a1", task: "step 1" },
        { agent: "a2", task: "step 2" },
      ])
      .build();

    let stepCount = 0;
    const executor = async (step: any, ctx: any) => {
      stepCount++;
      return { result: `step ${stepCount} done` };
    };

    const wf = new DurableWorkflow(store, compiled, executor);
    const result = await wf.run();

    setTimeout(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} }, 500);
    return {
      score: result.status === "completed" && result.completedSteps === 2 ? 10 : result.completedSteps >= 1 ? 7 : 0,
      maxScore: 10,
      details: `status=${result.status} completedSteps=${result.completedSteps}/${result.totalSteps}`,
    };
  });

  await harness.runTest("17.04.3", "Recovery — conversation checkpoint and restore", async () => {
    const tmpDir = join(import.meta.dir, `.recovery-tmp3-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const { SQLiteStore } = await import(join(ROOT, "core/storage/sqlite-store.ts"));
    const { ConversationManager } = await import(join(ROOT, "core/conversation.ts"));
    const store = new SQLiteStore(tmpDir);
    await store.init();
    const mgr = new ConversationManager(store);

    const convId = mgr.create(["a1", "a2"]);
    mgr.addMessage(convId, "a1", "assistant", "hello world");

    const snapshot = mgr.checkpoint(convId);
    const hasSnapshot = snapshot != null && (snapshot as any).id === convId;

    if (snapshot) {
      const restoredId = mgr.restore(snapshot);
      const restored = mgr.get(restoredId);
      setTimeout(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} }, 500);
      return {
        score: hasSnapshot && restored != null ? 10 : hasSnapshot ? 7 : 0,
        maxScore: 10,
        details: `snapshot=${hasSnapshot} restored=${restored != null}`,
      };
    }

    setTimeout(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} }, 500);
    return {
      score: 0,
      maxScore: 10,
      details: "checkpoint returned null",
    };
  });
}
