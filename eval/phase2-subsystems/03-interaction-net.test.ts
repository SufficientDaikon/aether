// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: InteractionNet Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.3.1: Add Nodes, Wires, Check Ports ─────────────
  await harness.runTest(
    "2.3.1",
    "InteractionNet — Add nodes, wires, check ports",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { InteractionNet } =
          await import("../../core/interaction-net.ts");
        const net = new InteractionNet();

        // Create task nodes
        const node1 = net.createTaskNode("Task 1", "agent-a", {}, 3);
        const node2 = net.createTaskNode("Task 2", "agent-b", {}, 3);
        details.push(`Created 2 task nodes: ${node1.id}, ${node2.id}`);
        score += 2;

        // Verify nodes exist
        const retrieved1 = net.getNode(node1.id);
        const retrieved2 = net.getNode(node2.id);
        if (retrieved1 && retrieved2) {
          details.push("Both nodes retrievable by ID");
          score += 2;
        }

        // Verify ports
        if (
          node1.principal &&
          node1.principal.index === 0 &&
          node1.aux &&
          node1.aux[0].index === 1 &&
          node1.aux[1].index === 2
        ) {
          details.push(
            "Node ports correctly structured (principal=0, aux1=1, aux2=2)",
          );
          score += 2;
        }

        // Connect via wire
        const wire = net.connect(node1.principal, node2.principal);
        if (
          wire &&
          wire.id &&
          wire.from.nodeId === node1.id &&
          wire.to.nodeId === node2.id
        ) {
          details.push(`Wire created: ${wire.id}`);
          score += 2;
        }

        // Get wires for port
        const wiresForPort = net.getWiresForPort(node1.id, 0);
        if (Array.isArray(wiresForPort) && wiresForPort.length >= 1) {
          details.push(
            `getWiresForPort returned ${wiresForPort.length} wire(s)`,
          );
          score += 1;
        }

        // Node count
        if (net.nodeCount >= 2) {
          details.push(`nodeCount = ${net.nodeCount}`);
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

  // ── Test 2.3.2: Active Pair Detection ─────────────────────
  await harness.runTest(
    "2.3.2",
    "InteractionNet — Active pair detection",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { InteractionNet } =
          await import("../../core/interaction-net.ts");
        const net = new InteractionNet();

        // Create two idle nodes and connect their principal ports
        const con = net.createJoin(2, "concat");
        const era = net.createEraser("test cleanup");
        net.connect(con.principal, era.principal);

        // This should form an active pair (both idle, connected via principal ports)
        const pairs = net.findActivePairs();
        if (Array.isArray(pairs) && pairs.length >= 1) {
          details.push(`Found ${pairs.length} active pair(s)`);
          score += 5;

          // Verify the pair contains our nodes
          const pair = pairs[0];
          const nodeIds = [pair.left.id, pair.right.id];
          if (nodeIds.includes(con.id) && nodeIds.includes(era.id)) {
            details.push("Active pair contains the correct nodes");
            score += 3;
          }
        } else {
          details.push("No active pairs found (expected at least 1)");
        }

        // Check getReadyPairs returns sorted
        const ready = net.getReadyPairs();
        if (Array.isArray(ready)) {
          details.push(`getReadyPairs returned ${ready.length} pair(s)`);
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

  // ── Test 2.3.3: Checkpoint / Restore Round-Trip ───────────
  await harness.runTest(
    "2.3.3",
    "InteractionNet — Checkpoint/restore round-trip",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { InteractionNet } =
          await import("../../core/interaction-net.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          // Build a net with nodes and wires
          const net = new InteractionNet();
          net.setStore(store);

          const t1 = net.createTaskNode("Checkpoint test 1", "agent-a");
          const t2 = net.createTaskNode("Checkpoint test 2", "agent-b");
          const join = net.createJoin(2);
          net.connect(t1.principal, join.principal);
          net.connect(t2.principal, join.principal);

          const nodeCountBefore = net.nodeCount;
          details.push(`Net built with ${nodeCountBefore} nodes`);

          // Checkpoint
          net.checkpoint();
          details.push("Checkpoint saved");
          score += 3;

          // Create a new net and restore
          const net2 = new InteractionNet();
          net2.setStore(store);
          const restored = net2.restore();

          if (restored) {
            details.push("Restore returned true");
            score += 3;

            if (net2.nodeCount === nodeCountBefore) {
              details.push(`Restored node count matches: ${net2.nodeCount}`);
              score += 4;
            } else {
              details.push(
                `Restored node count mismatch: ${net2.nodeCount} vs ${nodeCountBefore}`,
              );
              score += 2;
            }
          } else {
            details.push("Restore returned false");
          }

          await store.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import/init error: ${err instanceof Error ? err.message : String(err)}`,
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

  // ── Test 2.3.4: Factory Methods ───────────────────────────
  await harness.runTest(
    "2.3.4",
    "InteractionNet — Factory methods (buildParallelDAG, buildPipeline, createFanOut)",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { InteractionNet } =
          await import("../../core/interaction-net.ts");
        const net = new InteractionNet();

        // Test buildParallelDAG
        try {
          const dag = net.buildParallelDAG([
            { description: "DAG Task 1", agentId: "agent-a" },
            { description: "DAG Task 2", agentId: "agent-b" },
            { description: "DAG Task 3", agentId: "agent-c" },
          ]);
          if (dag && dag.tasks && dag.join) {
            details.push(
              `buildParallelDAG: created ${dag.tasks.length} task nodes + 1 join`,
            );
            score += 4;
          }
        } catch (err) {
          details.push(
            `buildParallelDAG error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // Test buildPipeline
        try {
          const net2 = new InteractionNet();
          const pipeline = net2.buildPipeline([
            { description: "Step 1", agentId: "agent-a" },
            { description: "Step 2", agentId: "agent-b" },
          ]);
          if (Array.isArray(pipeline) && pipeline.length === 2) {
            details.push(
              `buildPipeline: created ${pipeline.length} sequential nodes`,
            );
            score += 3;
          }
        } catch (err) {
          details.push(
            `buildPipeline error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // Test createFanOut
        try {
          const net3 = new InteractionNet();
          const fanout = net3.createFanOut(
            {
              kind: "task",
              description: "Fan out task",
              agentId: "agent-a",
              context: {},
              priority: 3,
              timeout: 60_000,
            },
            ["agent-b", "agent-c"],
            "all",
          );
          if (fanout && fanout.kind === "duplicator") {
            details.push("createFanOut: created duplicator node");
            score += 3;
          }
        } catch (err) {
          details.push(
            `createFanOut error: ${err instanceof Error ? err.message : String(err)}`,
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
