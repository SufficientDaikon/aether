// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: WorkflowBuilder Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.16.1: Sequential chain workflow ───────────────────
  await harness.runTest(
    "2.16.1",
    "WorkflowBuilder — Sequential chain",
    async () => {
      let score = 0;
      const maxScore = 7;
      const details: string[] = [];

      try {
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");

        const builder = new WorkflowBuilder("test-sequential");
        builder.sequential([
          { agent: "agent-a", task: "Plan the architecture" },
          { agent: "agent-b", task: "Implement the code" },
          { agent: "agent-c", task: "Write the tests" },
        ]);

        const wf = builder.build();
        details.push(`Workflow built: ${wf.name}, ${wf.steps.length} steps`);
        score += 2;

        if (wf.steps.length === 3) {
          details.push("Correct step count");
          score += 1;
        }

        // First step should have no dependencies, later steps depend on previous
        if (!wf.steps[0].dependsOn || wf.steps[0].dependsOn.length === 0) {
          details.push("First step has no dependencies");
          score += 1;
        }

        if (
          wf.steps[1].dependsOn &&
          wf.steps[1].dependsOn.includes(wf.steps[0].id)
        ) {
          details.push("Second step depends on first");
          score += 1;
        }

        if (
          wf.steps[2].dependsOn &&
          wf.steps[2].dependsOn.includes(wf.steps[1].id)
        ) {
          details.push("Third step depends on second");
          score += 1;
        }

        if (wf.entrySteps.length === 1 && wf.exitSteps.length === 1) {
          details.push("Entry and exit steps identified correctly");
          score += 1;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.16.2: Parallel workflow ───────────────────────────
  await harness.runTest(
    "2.16.2",
    "WorkflowBuilder — Parallel fan-out",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");

        const builder = new WorkflowBuilder("test-parallel");
        builder.parallel([
          { agent: "agent-a", task: "Review frontend" },
          { agent: "agent-b", task: "Review backend" },
          { agent: "agent-c", task: "Review database" },
        ]);

        const wf = builder.build();
        details.push(`Parallel workflow built: ${wf.steps.length} steps`);
        score += 2;

        // All parallel steps should have type "parallel"
        const allParallel = wf.steps.every((s) => s.type === "parallel");
        if (allParallel) {
          details.push("All steps are parallel type");
          score += 1;
        }

        // All should be in the same group
        const groups = new Set(wf.steps.map((s) => s.group));
        if (groups.size === 1 && wf.steps[0].group) {
          details.push(`All steps in group: ${wf.steps[0].group}`);
          score += 1;
        }

        // parallelGroups should have one entry with 3 step IDs
        if (wf.parallelGroups.size === 1) {
          const groupSteps = [...wf.parallelGroups.values()][0];
          if (groupSteps.length === 3) {
            details.push("parallelGroups has correct structure");
            score += 2;
          }
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.16.3: Conditional + describe() ────────────────────
  await harness.runTest(
    "2.16.3",
    "WorkflowBuilder — Conditional + describe()",
    async () => {
      let score = 0;
      const maxScore = 7;
      const details: string[] = [];

      try {
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");

        const builder = new WorkflowBuilder("test-conditional");
        builder
          .sequential([{ agent: "router", task: "Analyze request" }])
          .conditional(
            (ctx) => (ctx.type === "frontend" ? "fe-agent" : "be-agent"),
            [
              { agent: "fe-agent", task: "Handle frontend" },
              { agent: "be-agent", task: "Handle backend" },
            ],
          )
          .aggregate("synthesizer", "Combine results");

        const wf = builder.build();
        details.push(`Conditional workflow: ${wf.steps.length} steps`);
        score += 2;

        // Should have: 1 sequential + 2 conditional + 1 aggregate = 4
        if (wf.steps.length === 4) {
          details.push("Correct total step count (4)");
          score += 1;
        }

        const conditionalSteps = wf.steps.filter(
          (s) => s.type === "conditional",
        );
        if (conditionalSteps.length === 2) {
          details.push("2 conditional steps found");
          score += 1;
        }

        const aggregateSteps = wf.steps.filter((s) => s.type === "aggregate");
        if (aggregateSteps.length === 1) {
          details.push("1 aggregate step found");
          score += 1;
        }

        // Test describe() output
        const desc = builder.describe();
        if (
          desc.includes("test-conditional") &&
          desc.includes("sequential") &&
          desc.includes("conditional")
        ) {
          details.push("describe() output contains workflow structure");
          score += 2;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
