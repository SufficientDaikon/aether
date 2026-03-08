// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: DurableWorkflow Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.17.1: Define and run a 3-step workflow to completion ──
  await harness.runTest(
    "2.17.1",
    "DurableWorkflow — Run 3-step workflow to completion",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { DurableWorkflow } = await import("../../core/durable.ts");
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const wf = new WorkflowBuilder("durable-test")
            .sequential([
              { agent: "agent-a", task: "Step 1: Gather data" },
              { agent: "agent-b", task: "Step 2: Process data" },
              { agent: "agent-c", task: "Step 3: Generate report" },
            ])
            .build();

          details.push(`Workflow built: ${wf.steps.length} steps`);
          score += 1;

          const stepsExecuted: string[] = [];
          const durable = new DurableWorkflow(
            store,
            wf,
            async (step, context) => {
              stepsExecuted.push(step.id);
              return { [`result_${step.id}`]: `output from ${step.agent}` };
            },
          );

          const result = await durable.run({ initial: true });

          if (result.status === "completed") {
            details.push("Workflow completed");
            score += 3;
          } else {
            details.push(`Unexpected status: ${result.status}`);
          }

          if (result.completedSteps === 3 && result.totalSteps === 3) {
            details.push("All 3 steps completed");
            score += 2;
          }

          if (stepsExecuted.length === 3) {
            details.push(
              `Steps executed in order: [${stepsExecuted.join(", ")}]`,
            );
            score += 2;
          }

          if (result.finalState.initial === true) {
            details.push("Initial state preserved");
            score += 1;
          }

          // Verify checkpoints were saved
          const checkpoints = durable.getCheckpoints();
          if (checkpoints.length >= 1) {
            details.push(`${checkpoints.length} checkpoint(s) saved`);
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

  // ── Test 2.17.2: Checkpoint and resume ───────────────────────
  await harness.runTest(
    "2.17.2",
    "DurableWorkflow — Checkpoint and resume",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { DurableWorkflow } = await import("../../core/durable.ts");
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const wf = new WorkflowBuilder("resume-test")
            .sequential([
              { agent: "agent-a", task: "Step 1" },
              { agent: "agent-b", task: "Step 2" },
              { agent: "agent-c", task: "Step 3" },
            ])
            .build();

          let callCount = 0;
          const stepsExecuted: string[] = [];

          // First run: pause after step 1
          const durable1 = new DurableWorkflow(
            store,
            wf,
            async (step, context) => {
              callCount++;
              stepsExecuted.push(step.id);
              if (callCount === 1) {
                // After first step completes, trigger pause
                durable1.pause();
              }
              return { [`done_${step.id}`]: true };
            },
          );

          const r1 = await durable1.run({ started: true });

          if (r1.status === "paused") {
            details.push("Workflow paused after step 1");
            score += 3;
          } else {
            details.push(`Expected paused, got: ${r1.status}`);
          }

          if (r1.completedSteps >= 1) {
            details.push(`Completed ${r1.completedSteps} step(s) before pause`);
            score += 1;
          }

          // Resume from checkpoint
          const stepsOnResume: string[] = [];
          const durable2 = new DurableWorkflow(
            store,
            wf,
            async (step, context) => {
              stepsOnResume.push(step.id);
              return { [`resumed_${step.id}`]: true };
            },
          );

          const r2 = await durable2.resume(wf.id);

          if (r2.status === "completed") {
            details.push("Workflow resumed and completed");
            score += 3;
          } else {
            details.push(`Resume status: ${r2.status}`);
          }

          if (stepsOnResume.length >= 1) {
            details.push(`${stepsOnResume.length} step(s) executed on resume`);
            score += 2;
          }

          // Cleanup should work
          durable2.cleanup();
          const afterCleanup = durable2.getCheckpoints();
          if (afterCleanup.length === 0) {
            details.push("Checkpoints cleaned up");
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
}
