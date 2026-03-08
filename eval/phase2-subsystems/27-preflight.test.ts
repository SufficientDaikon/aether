// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: PreflightChecker Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { makeAgent, registerFullHierarchy } from "../helpers/agent-fixtures.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.27.1: Preflight with all agents present ───────────
  await harness.runTest(
    "2.27.1",
    "PreflightChecker — All agents present (should pass)",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { PreflightChecker } = await import("../../core/preflight.ts");
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");

        const checker = new PreflightChecker();
        details.push("PreflightChecker created");
        score += 1;

        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        // Build a workflow using known agents
        const wf = new WorkflowBuilder("preflight-test")
          .sequential([
            { agent: "react-specialist", task: "Build the UI" },
            { agent: "postgres-db-architect", task: "Design the schema" },
            { agent: "test-engineer", task: "Write tests" },
          ])
          .build();

        const result = checker.check(wf, (id) => registry.get(id) ?? null);

        if (result.passed) {
          details.push("Preflight PASSED (all agents present)");
          score += 4;
        } else {
          details.push(`Preflight failed: errors=${result.errors.join("; ")}`);
        }

        if (result.errors.length === 0) {
          details.push("No errors");
          score += 2;
        }

        // agentHealth should show all agents as healthy
        const allHealthy = Object.values(result.agentHealth).every(
          (h) => h === "healthy",
        );
        if (allHealthy) {
          details.push("All agents reported healthy");
          score += 2;
        }

        // Budget should be within limits
        if (result.budget && result.budget.withinBudget) {
          details.push("Budget within limits");
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

  // ── Test 2.27.2: Preflight with missing agents ──────────────
  await harness.runTest(
    "2.27.2",
    "PreflightChecker — Missing agents (should fail)",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { PreflightChecker } = await import("../../core/preflight.ts");
        const { WorkflowBuilder } =
          await import("../../core/workflow-builder.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");

        const checker = new PreflightChecker();
        const registry = new AgentRegistry();
        registerFullHierarchy(registry);

        // Build a workflow with one non-existent agent
        const wf = new WorkflowBuilder("preflight-fail-test")
          .sequential([
            { agent: "react-specialist", task: "Build the UI" },
            { agent: "non-existent-agent", task: "Do something impossible" },
            { agent: "test-engineer", task: "Write tests" },
          ])
          .build();

        const result = checker.check(wf, (id) => registry.get(id) ?? null);

        if (!result.passed) {
          details.push("Preflight correctly FAILED (missing agent)");
          score += 4;
        } else {
          details.push("Preflight passed unexpectedly");
        }

        if (result.errors.length > 0) {
          details.push(`Errors: ${result.errors.join("; ")}`);
          score += 2;
        }

        // Check that the non-existent agent is flagged
        const missingError = result.errors.find((e) =>
          e.includes("non-existent-agent"),
        );
        if (missingError) {
          details.push("Missing agent correctly identified in errors");
          score += 2;
        }

        // agentHealth should mark the missing agent as offline
        if (result.agentHealth["non-existent-agent"] === "offline") {
          details.push("Missing agent health: offline");
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
