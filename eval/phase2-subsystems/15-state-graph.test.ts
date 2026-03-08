// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: StateGraph Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.15.1: Build graph with 3 nodes, compile, and execute ──
  await harness.runTest(
    "2.15.1",
    "StateGraph — Build, compile, execute linear graph",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { StateGraph } = await import("../../core/state-graph.ts");

        const graph = new StateGraph({
          id: "test-graph-1",
          maxIterations: 10,
          entryNode: "start",
          exitNodes: ["end"],
        });

        graph
          .addNode("start", "Start Node", async (state) => {
            return { ...state, started: true, step: 1 };
          })
          .addNode("process", "Process Node", async (state) => {
            return { ...state, processed: true, step: 2 };
          })
          .addNode("end", "End Node", async (state) => {
            return { ...state, ended: true, step: 3 };
          });

        graph.addEdge("start", "process");
        graph.addEdge("process", "end");

        details.push("Graph built with 3 nodes and 2 edges");
        score += 2;

        const compiled = graph.compile();
        details.push("Graph compiled successfully");
        score += 2;

        const nodeIds = compiled.getNodeIds();
        if (
          nodeIds.length === 3 &&
          nodeIds.includes("start") &&
          nodeIds.includes("process") &&
          nodeIds.includes("end")
        ) {
          details.push("Compiled graph has correct nodes");
          score += 1;
        }

        if (compiled.getEdgeCount() === 2) {
          details.push("Compiled graph has correct edge count");
          score += 1;
        }

        const result = await compiled.run({ input: "hello" });

        if (
          result.state.started &&
          result.state.processed &&
          result.state.ended
        ) {
          details.push("All nodes executed in order");
          score += 2;
        }

        if (
          result.trace.length === 3 &&
          result.trace[0].nodeId === "start" &&
          result.trace[2].nodeId === "end"
        ) {
          details.push(
            `Trace: ${result.trace.map((t) => t.nodeId).join(" -> ")}`,
          );
          score += 1;
        }

        if (result.exitNode === "end") {
          details.push("Exit node correct");
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

  // ── Test 2.15.2: Conditional branch in state graph ───────────
  await harness.runTest(
    "2.15.2",
    "StateGraph — Conditional branching",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { StateGraph } = await import("../../core/state-graph.ts");

        const graph = new StateGraph({
          id: "test-graph-cond",
          maxIterations: 10,
          entryNode: "start",
          exitNodes: ["success", "failure"],
        });

        graph
          .addNode("start", "Entry", async (state) => {
            return { ...state, checked: true };
          })
          .addNode("success", "Success Path", async (state) => {
            return { ...state, path: "success" };
          })
          .addNode("failure", "Failure Path", async (state) => {
            return { ...state, path: "failure" };
          });

        // Conditional edge: route based on state.valid
        graph.addConditionalEdge("start", (state) => {
          return state.valid ? "success" : "failure";
        });

        const compiled = graph.compile();
        details.push("Conditional graph compiled");
        score += 2;

        // Test valid=true path
        const r1 = await compiled.run({ valid: true });
        if (r1.state.path === "success" && r1.exitNode === "success") {
          details.push("valid=true routed to success");
          score += 3;
        }

        if (
          r1.trace.length === 2 &&
          r1.trace[0].nodeId === "start" &&
          r1.trace[1].nodeId === "success"
        ) {
          details.push("Trace correct for success path");
          score += 1;
        }

        // Test valid=false path
        const r2 = await compiled.run({ valid: false });
        if (r2.state.path === "failure" && r2.exitNode === "failure") {
          details.push("valid=false routed to failure");
          score += 3;
        }

        if (
          r2.trace.length === 2 &&
          r2.trace[0].nodeId === "start" &&
          r2.trace[1].nodeId === "failure"
        ) {
          details.push("Trace correct for failure path");
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
}
