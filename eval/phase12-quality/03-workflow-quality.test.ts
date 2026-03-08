// Phase 12.03: Workflow Quality Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("12.03.1", "Workflow — sequential chain builds correctly", async () => {
    const { WorkflowBuilder } = await import(join(ROOT, "core/workflow-builder.ts"));
    const wf = new WorkflowBuilder("test-seq")
      .sequential([
        { agent: "agent-a", task: "step 1" },
        { agent: "agent-b", task: "step 2" },
        { agent: "agent-c", task: "step 3" },
      ])
      .build();

    const hasThreeSteps = wf.steps.length === 3;
    const isSequential = wf.steps.every((s: any) => s.type === "sequential");
    // Second step depends on first, third on second
    const hasDeps = (wf.steps[1]?.dependsOn?.length ?? 0) > 0 && (wf.steps[2]?.dependsOn?.length ?? 0) > 0;
    return {
      score: hasThreeSteps && isSequential && hasDeps ? 10 : hasThreeSteps ? 5 : 0,
      maxScore: 10,
      details: `steps=${wf.steps.length} sequential=${isSequential} deps=${hasDeps}`,
    };
  });

  await harness.runTest("12.03.2", "Workflow — parallel fan-out groups steps", async () => {
    const { WorkflowBuilder } = await import(join(ROOT, "core/workflow-builder.ts"));
    const wf = new WorkflowBuilder("test-parallel")
      .parallel([
        { agent: "worker-1", task: "analyze A" },
        { agent: "worker-2", task: "analyze B" },
        { agent: "worker-3", task: "analyze C" },
      ])
      .build();

    const allParallel = wf.steps.every((s: any) => s.type === "parallel");
    const hasGroup = wf.steps.some((s: any) => s.group != null);
    return {
      score: allParallel && hasGroup ? 10 : allParallel ? 7 : 0,
      maxScore: 10,
      details: `steps=${wf.steps.length} allParallel=${allParallel} hasGroup=${hasGroup}`,
    };
  });

  await harness.runTest("12.03.3", "Workflow — build rejects empty workflow", async () => {
    const { WorkflowBuilder } = await import(join(ROOT, "core/workflow-builder.ts"));
    let threw = false;
    try {
      new WorkflowBuilder("empty").build();
    } catch {
      threw = true;
    }
    return {
      score: threw ? 10 : 0,
      maxScore: 10,
      details: `empty build threw: ${threw}`,
    };
  });
}
