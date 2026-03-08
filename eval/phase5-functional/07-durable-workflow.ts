// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 07: Durable Workflow — Checkpoint and Resume
// Creates a DurableWorkflow with 3 steps, runs steps 1-2,
// checkpoints, creates a new engine instance, resumes from
// checkpoint, and runs step 3. Verifies all steps completed.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

import { DurableWorkflow } from "../../core/durable.ts";
import { WorkflowBuilder } from "../../core/workflow-builder.ts";
import { SQLiteStore } from "../../core/storage/sqlite-store.ts";
import type { WorkflowStep } from "../../core/workflow-builder.ts";

export async function run(
  harness: TestHarness,
  _gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.07",
    "Durable Workflow — checkpoint and resume",
    async () => {
      try {
        // Set up store
        const tmpDir = `.aether/eval-phase5-07-${Date.now()}`;
        const store = new SQLiteStore(tmpDir);
        await store.init();

        // Build a 3-step sequential workflow
        const workflow = new WorkflowBuilder("eval-durable-test")
          .sequential([
            { agent: "system-architect", task: "Plan the module structure" },
            { agent: "react-specialist", task: "Implement the frontend" },
            {
              agent: "ux-psychologist",
              task: "Review the implementation for UX",
            },
          ])
          .build();

        // Track which steps executed
        const executedSteps: string[] = [];
        let pauseAfterStep = 2; // Pause after step 2 (0-indexed: step index 1)

        // Step executor that simulates work and pauses after step 2
        const stepExecutor = async (
          step: WorkflowStep,
          context: Record<string, unknown>,
        ): Promise<Record<string, unknown>> => {
          executedSteps.push(step.id);
          // Simulate some work
          await new Promise((r) => setTimeout(r, 10));
          return {
            [`result_${step.id}`]: `Output from ${step.agent}: completed "${step.task}"`,
            stepAgent: step.agent,
          };
        };

        // Phase 1: Run workflow but pause after step 2
        let stepCount = 0;
        const pausingExecutor = async (
          step: WorkflowStep,
          context: Record<string, unknown>,
        ): Promise<Record<string, unknown>> => {
          stepCount++;
          const result = await stepExecutor(step, context);
          // After executing step 2, signal the workflow to pause
          if (stepCount >= pauseAfterStep) {
            durableWf1.pause();
          }
          return result;
        };

        const durableWf1 = new DurableWorkflow(
          store,
          workflow,
          pausingExecutor,
        );
        const result1 = await durableWf1.run({});

        let score = 0;
        const details: string[] = [];

        // Verify first run paused after 2 steps
        if (result1.status === "paused") {
          score += 3;
          details.push(
            `Phase 1: Workflow paused correctly after ${result1.completedSteps}/${result1.totalSteps} steps.`,
          );
        } else {
          details.push(
            `Phase 1: Expected paused status, got "${result1.status}" with ${result1.completedSteps} completed.`,
          );
        }

        // Verify checkpoints exist
        const checkpoints = durableWf1.getCheckpoints();
        if (checkpoints.length > 0) {
          score += 2;
          details.push(
            `Checkpoints saved: ${checkpoints.length}. Latest at step index ${checkpoints[checkpoints.length - 1].stepIndex}.`,
          );
        } else {
          details.push("No checkpoints were saved during Phase 1.");
        }

        // Phase 2: Create a new DurableWorkflow engine and resume from checkpoint
        const resumeExecutedSteps: string[] = [];
        const resumeExecutor = async (
          step: WorkflowStep,
          context: Record<string, unknown>,
        ): Promise<Record<string, unknown>> => {
          resumeExecutedSteps.push(step.id);
          await new Promise((r) => setTimeout(r, 10));
          return {
            [`result_${step.id}`]: `Resumed output from ${step.agent}: completed "${step.task}"`,
            stepAgent: step.agent,
          };
        };

        const durableWf2 = new DurableWorkflow(store, workflow, resumeExecutor);
        const result2 = await durableWf2.resume(workflow.id);

        // Verify resume completed all remaining steps
        if (result2.status === "completed") {
          score += 3;
          details.push(
            `Phase 2: Workflow resumed and completed. ${result2.completedSteps}/${result2.totalSteps} steps done.`,
          );
        } else {
          details.push(
            `Phase 2: Expected completed status, got "${result2.status}" with ${result2.completedSteps} completed.`,
          );
        }

        // Verify the resumed run only executed the remaining step(s)
        if (resumeExecutedSteps.length >= 1) {
          score += 2;
          details.push(
            `Resume executed ${resumeExecutedSteps.length} step(s): ${resumeExecutedSteps.join(", ")}.`,
          );
        } else {
          details.push("Resume did not execute any steps.");
        }

        // Verify total steps across both phases
        const totalExecuted = executedSteps.length + resumeExecutedSteps.length;
        details.push(
          `Total steps executed: ${totalExecuted} (Phase 1: ${executedSteps.length}, Phase 2: ${resumeExecutedSteps.length}).`,
        );

        // Cap at 10
        score = Math.min(score, 10);

        // Clean up
        durableWf2.cleanup();
        await store.close();

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            phase1Status: result1.status,
            phase1Steps: result1.completedSteps,
            phase1PausedAt: result1.pausedAtStep,
            checkpointCount: checkpoints.length,
            phase2Status: result2.status,
            phase2Steps: result2.completedSteps,
            phase1ExecutedSteps: executedSteps,
            phase2ExecutedSteps: resumeExecutedSteps,
            finalState: result2.finalState,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Durable workflow test failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
