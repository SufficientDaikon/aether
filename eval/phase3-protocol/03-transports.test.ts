// -----------------------------------------------------------------
// AETHER Eval -- Phase 3: Transport Tests
// Tests CLITransport execution and TransportManager routing
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 3.3.1: CLITransport -- create with echo, execute, verify ------
  await harness.runTest(
    "3.3.1",
    "CLITransport -- Execute echo command and verify output",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { CLITransport } = await import("../../transports/cli.ts");

        const transport = new CLITransport();

        // Verify transport type
        if (transport.transportType === "cli") {
          details.push("transportType is 'cli'");
          score += 1;
        } else {
          details.push(`Unexpected transportType: ${transport.transportType}`);
        }

        // Connect (no-op for CLI, but should mark connected)
        await transport.connect({
          transport: "cli",
          command: "echo",
          inputFormat: "args",
          outputFormat: "stdout-text",
        } as any);

        if (transport.isConnected()) {
          details.push("isConnected() returns true after connect");
          score += 1;
        } else {
          details.push("isConnected() returns false after connect");
        }

        // Execute a task using "echo" command with args input
        const task = {
          id: "eval-cli-task-001",
          description: "Test CLI transport",
          requester: "eval-harness",
          target: "echo-agent",
          priority: 3 as const,
          context: { testKey: "testValue" },
        };

        const agent = {
          id: "echo-agent",
          name: "Echo Agent",
          tier: "worker",
          sections: ["TOOLS" as const],
          capabilities: ["echo"],
          dependencies: [],
          llmRequirement: "local" as const,
          format: "json" as const,
          escalationTarget: null,
          filePath: "/dev/null",
          status: "idle" as const,
          transport: {
            transport: "cli" as const,
            command: "echo",
            args: ["hello-from-eval"],
            inputFormat: "args" as const,
            outputFormat: "stdout-text" as const,
          },
          metadata: {},
        };

        const result = await transport.execute(task, agent, agent.transport);

        if (result && result.requestId === "eval-cli-task-001") {
          details.push("Result requestId matches task ID");
          score += 2;
        } else {
          details.push(`Result requestId mismatch: ${result?.requestId}`);
        }

        if (result.status === "success") {
          details.push("Task completed with status=success");
          score += 2;
        } else {
          details.push(`Task status: ${result.status}`);
        }

        // Output should contain our echo args
        const output = String(result.output ?? "");
        if (output.includes("hello-from-eval")) {
          details.push(
            `Output contains expected text: "${output.slice(0, 80).trim()}"`,
          );
          score += 2;
        } else {
          details.push(
            `Output did not contain expected text: "${output.slice(0, 80).trim()}"`,
          );
        }

        // Duration should be a positive number
        if (typeof result.duration === "number" && result.duration >= 0) {
          details.push(`Duration: ${result.duration}ms`);
          score += 1;
        } else {
          details.push(`Invalid duration: ${result.duration}`);
        }

        // Disconnect
        await transport.disconnect();
        if (!transport.isConnected()) {
          details.push("Disconnected successfully");
          score += 1;
        } else {
          details.push("Still connected after disconnect");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.3.2: TransportManager -- instantiate and check routing ------
  await harness.runTest(
    "3.3.2",
    "TransportManager -- Instantiate and check routing logic",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { TransportManager } =
          await import("../../transports/manager.ts");

        const manager = new TransportManager();
        details.push("TransportManager instantiated");
        score += 2;

        // isExternalAgent: local agent (no transport) -> false
        const localAgent = {
          id: "local-agent",
          name: "Local Agent",
          tier: "worker",
          sections: ["TOOLS" as const],
          capabilities: ["test"],
          dependencies: [],
          llmRequirement: "local" as const,
          format: "json" as const,
          escalationTarget: null,
          filePath: "/dev/null",
          status: "idle" as const,
          metadata: {},
          // no transport field
        };

        if (!manager.isExternalAgent(localAgent)) {
          details.push("isExternalAgent returns false for local agent");
          score += 2;
        } else {
          details.push(
            "isExternalAgent incorrectly returns true for local agent",
          );
        }

        // isExternalAgent: CLI agent (has transport) -> true
        const cliAgent = {
          ...localAgent,
          id: "cli-agent",
          name: "CLI Agent",
          transport: {
            transport: "cli" as const,
            command: "echo",
            args: [],
            inputFormat: "args" as const,
            outputFormat: "stdout-text" as const,
          },
        };

        if (manager.isExternalAgent(cliAgent)) {
          details.push("isExternalAgent returns true for CLI agent");
          score += 2;
        } else {
          details.push(
            "isExternalAgent incorrectly returns false for CLI agent",
          );
        }

        // execute without transport should throw
        try {
          await manager.execute(
            {
              id: "t1",
              description: "test",
              requester: "eval",
              target: "local-agent",
              priority: 3 as const,
              context: {},
            },
            localAgent,
          );
          details.push("FAIL: execute on local agent did not throw");
        } catch (e) {
          if (e instanceof Error && e.message.includes("no transport config")) {
            details.push("execute throws for agent without transport config");
            score += 2;
          } else {
            details.push(
              `execute threw unexpected error: ${e instanceof Error ? e.message : String(e)}`,
            );
            score += 1;
          }
        }

        // getStatus should return empty initially
        const status = manager.getStatus();
        if (Array.isArray(status) && status.length === 0) {
          details.push("getStatus returns empty array initially");
          score += 1;
        } else {
          details.push(
            `getStatus returned: ${JSON.stringify(status).slice(0, 100)}`,
          );
        }

        // disconnectAll should not throw
        try {
          await manager.disconnectAll();
          details.push("disconnectAll completed without error");
          score += 1;
        } catch (e) {
          details.push(
            `disconnectAll error: ${e instanceof Error ? e.message : String(e)}`,
          );
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
