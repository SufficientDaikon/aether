// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: SharedStateBus Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.21.1: Create session, update state, verify versions ──
  await harness.runTest(
    "2.21.1",
    "SharedStateBus — Session lifecycle and versioning",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { SharedStateBus } = await import("../../core/shared-state.ts");
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        try {
          const bus = new SharedStateBus(highway, logger, null, {
            publishChanges: false,
            persistSessions: false,
          });

          // Create a session
          const initial = bus.createSession("sess-1", "Build a web app", {
            status: "planning",
          });
          details.push("Session created");
          score += 2;

          if (initial.version === 0) {
            details.push("Initial version is 0");
            score += 1;
          }

          if (initial.goal === "Build a web app") {
            details.push("Goal set correctly");
            score += 1;
          }

          // Update state — version should increment
          const updated1 = bus.update("sess-1", {
            agent: "agent-a",
            reason: "Started coding",
            patches: { status: "coding", currentFile: "app.ts" },
            setActiveRole: "agent-a",
            incrementStep: true,
          });

          if (updated1.version === 1) {
            details.push("Version incremented to 1 after first update");
            score += 2;
          }

          if (
            updated1.values.status === "coding" &&
            updated1.values.currentFile === "app.ts"
          ) {
            details.push("Patches applied correctly");
            score += 1;
          }

          if (updated1.activeRole === "agent-a") {
            details.push("Active role set");
            score += 1;
          }

          // Second update
          const updated2 = bus.update("sess-1", {
            agent: "agent-b",
            reason: "Review complete",
            patches: { status: "reviewed" },
            incrementStep: true,
          });

          if (updated2.version === 2) {
            details.push("Version incremented to 2 after second update");
            score += 1;
          }

          if (updated2.stepCount === 2) {
            details.push("Step count: 2");
            score += 1;
          }

          // Verify getState returns copy
          const state = bus.getState("sess-1");
          if (
            state &&
            state.version === 2 &&
            state.values.status === "reviewed"
          ) {
            details.push("getState returns current state");
          }

          // Check transitions
          const transitions = bus.getTransitions("sess-1");
          if (transitions.length === 2) {
            details.push(`${transitions.length} transitions recorded`);
          }

          bus.closeSession("sess-1");

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
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.21.2: Multiple sessions and communication edges ───
  await harness.runTest(
    "2.21.2",
    "SharedStateBus — Multiple sessions and edge tracking",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { SharedStateBus } = await import("../../core/shared-state.ts");
        const { MemoryHighway } = await import("../../core/memory-highway.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const highway = new MemoryHighway(logger, null, null, {
          enableRAG: false,
          enableDedup: false,
        });

        try {
          const bus = new SharedStateBus(highway, logger, null, {
            publishChanges: false,
            persistSessions: false,
          });

          bus.createSession("sess-a", "Task A");
          bus.createSession("sess-b", "Task B");

          const ids = bus.getSessionIds();
          if (ids.length === 2) {
            details.push("2 sessions created");
            score += 2;
          }

          if (bus.hasSession("sess-a") && bus.hasSession("sess-b")) {
            details.push("hasSession works");
            score += 1;
          }

          // Record communication edges
          bus.recordEdge("sess-a", "agent-1", "agent-2", "task");
          bus.recordEdge("sess-a", "agent-1", "agent-2", "task");
          bus.recordEdge("sess-a", "agent-2", "agent-3", "result");

          const edges = bus.getEdges("sess-a");
          if (edges.length === 2) {
            details.push("2 unique comm edges recorded");
            score += 2;
          }

          // Check edge count incremented
          const edge12 = edges.find(
            (e) => e.from === "agent-1" && e.to === "agent-2",
          );
          if (edge12 && edge12.count === 2) {
            details.push("Edge count incremented on repeat");
            score += 2;
          }

          // Adjacency list
          const adj = bus.getAdjacencyList("sess-a");
          if (adj["agent-1"] && adj["agent-1"].includes("agent-2")) {
            details.push("Adjacency list correct");
            score += 1;
          }

          // getValue/update
          bus.update("sess-a", {
            agent: "agent-1",
            reason: "Set key",
            patches: { myKey: "myValue" },
          });
          const val = bus.getValue("sess-a", "myKey");
          if (val === "myValue") {
            details.push("getValue returns correct value");
            score += 2;
          }

          bus.closeSession("sess-a");
          bus.closeSession("sess-b");

          if (!bus.hasSession("sess-a")) {
            details.push("Session closed successfully");
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
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
