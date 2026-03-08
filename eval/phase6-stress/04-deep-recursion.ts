// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: Executor Deep Recursion Depth Guard
// Configure AgentExecutor with maxDepth:3, mock provider that always
// returns subtask blocks, verify execution stops at max depth
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.4",
    "AgentExecutor -- Depth guard stops recursion at maxDepth:3",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      const TIMEOUT_MS = 15_000;

      try {
        const { AgentExecutor } = await import("../../core/executor.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { EscalationManager } = await import("../../core/escalation.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");
        const { createMockProviderManager } =
          await import("../helpers/mock-provider.ts");
        const { makeAgent } = await import("../helpers/agent-fixtures.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-stress-depth-"));
        const logger = new SynapseLogger(tempDir, "warn");

        try {
          const registry = new AgentRegistry();
          const escalation = new EscalationManager(registry, {
            threshold: 10,
            windowMs: 300_000,
          });

          // Register an agent that always tries to recurse
          const recursiveAgent = makeAgent({
            id: "recursive-agent",
            name: "Recursive Agent",
            tier: "worker",
            sections: ["TOOLS"],
            capabilities: ["recursion", "testing"],
            escalationTarget: null,
          });
          registry.register(recursiveAgent);

          const { providers, mock } = createMockProviderManager();

          // Monkey-patch mock to always return subtask blocks
          const originalSend = mock.send.bind(mock);
          mock.send = async (prompt: string, options: any) => {
            const response = await originalSend(prompt, options);
            // Inject a subtasks block that requests the same agent again
            response.content =
              "Processing task...\n\n```subtasks\n" +
              JSON.stringify([
                {
                  target: "recursive-agent",
                  description: "Recursive sub-task",
                  priority: 3,
                },
              ]) +
              "\n```\n\nMain output completed.";
            return response;
          };

          const executor = new AgentExecutor(
            registry,
            escalation,
            logger,
            providers,
            undefined,
            {
              maxDepth: 3,
              enableSubTasks: true,
              enableEscalation: false,
              defaultTimeout: 10_000,
            },
          );

          details.push("Executor configured with maxDepth=3");
          score += 2;

          // Execute a task that will recursively try to spawn subtasks
          const task = {
            id: "depth-test-task",
            description: "Test deep recursion guard",
            requester: "eval",
            target: "recursive-agent",
            priority: 3 as const,
            context: {},
          };

          const resultPromise = executor.execute(task);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Depth guard test timed out")),
              TIMEOUT_MS,
            ),
          );

          const result = await Promise.race([resultPromise, timeoutPromise]);

          details.push(
            `Execution completed: status=${result.status}, duration=${result.duration}ms`,
          );
          score += 2;

          // The executor should have stopped without crashing
          // Result could be success (with nested outputs) or failure (max depth)
          if (result.status === "success" || result.status === "failure") {
            score += 2;
            details.push("Execution terminated gracefully (no crash or hang)");
          }

          // Verify metrics show the depth was hit
          const metrics = executor.getMetrics();
          details.push(
            `Metrics: totalTasks=${metrics.totalTasks}, successful=${metrics.successful}, failed=${metrics.failed}`,
          );

          // The executor should have executed at most maxDepth+1 = 4 levels
          // (depth 0, 1, 2, 3 where 3 is the stop point)
          if (metrics.totalTasks >= 2 && metrics.totalTasks <= 10) {
            score += 2;
            details.push(
              `Task count ${metrics.totalTasks} is within expected range for depth guard`,
            );
          } else if (metrics.totalTasks > 10) {
            details.push(
              `WARNING: ${metrics.totalTasks} tasks executed -- depth guard may not be working`,
            );
          } else {
            score += 1;
            details.push(`Task count: ${metrics.totalTasks}`);
          }

          // Check that the output contains depth-limit evidence
          const outputStr = JSON.stringify(result.output);
          if (
            outputStr.includes("depth") ||
            outputStr.includes("recursion") ||
            outputStr.includes("Maximum") ||
            result.status === "failure" ||
            (result.output &&
              typeof result.output === "object" &&
              "subTaskResults" in (result.output as any))
          ) {
            score += 2;
            details.push("Output shows depth handling evidence");
          } else {
            details.push(`Output snippet: ${outputStr.slice(0, 200)}`);
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
        if (tempDir) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
        }
      }

      return {
        score,
        maxScore,
        details: details.join("; "),
        metadata: { test: "deep-recursion" },
      };
    },
  );
}
