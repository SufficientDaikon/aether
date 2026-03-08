// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: SQLiteStore Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { makeAgent } from "../helpers/agent-fixtures.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.1.1: Agent CRUD ──────────────────────────────────
  await harness.runTest("2.1.1", "SQLiteStore — Agent CRUD", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");
      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const store = new SQLiteStore(tempDir);
      await store.init();

      try {
        // Save agent
        const agent = makeAgent({
          id: "store-test-agent-1",
          name: "Store Test Agent",
        });
        store.saveAgent(agent);
        details.push("saveAgent succeeded");
        score += 2;

        // Get agent
        const retrieved = store.getAgent("store-test-agent-1");
        if (retrieved && retrieved.id === "store-test-agent-1") {
          details.push("getAgent returned correct agent");
          score += 2;
        } else {
          details.push("getAgent failed or returned wrong agent");
        }

        // Get all agents
        const all = await store.getAllAgents();
        if (Array.isArray(all) && all.length >= 1) {
          details.push(`getAllAgents returned ${all.length} agent(s)`);
          score += 2;
        } else {
          details.push("getAllAgents returned unexpected result");
        }

        // Update status
        store.updateAgentStatus("store-test-agent-1", "busy");
        const updated = store.getAgent("store-test-agent-1");
        if (updated && updated.status === "busy") {
          details.push("updateAgentStatus changed status to busy");
          score += 2;
        } else {
          details.push("updateAgentStatus did not update correctly");
        }

        // Edge case: get non-existent agent
        const missing = store.getAgent("nonexistent-agent-xyz");
        if (!missing || missing === null || missing === undefined) {
          details.push("getAgent returns null/undefined for missing agent");
          score += 2;
        } else {
          details.push("getAgent did not handle missing agent gracefully");
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
  });

  // ── Test 2.1.2: Task CRUD ──────────────────────────────────
  await harness.runTest("2.1.2", "SQLiteStore — Task CRUD", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");
      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const store = new SQLiteStore(tempDir);
      await store.init();

      try {
        // Save a task result
        const taskResult = {
          requestId: "task-eval-001",
          executor: "test-agent",
          status: "success" as const,
          output: "Test output data",
          duration: 1234,
          tokensUsed: 500,
        };
        store.saveTaskResult(taskResult);
        details.push("saveTaskResult succeeded");
        score += 3;

        // Retrieve the task result
        const retrieved = store.getTaskResult("task-eval-001");
        if (retrieved && retrieved.requestId === "task-eval-001") {
          details.push("getTaskResult returned correct task");
          score += 3;
        } else {
          details.push("getTaskResult did not return expected task");
        }

        // Get task metrics
        try {
          const metrics = store.getTaskMetrics();
          if (metrics && typeof metrics.totalTasks === "number") {
            details.push(`Task metrics: totalTasks=${metrics.totalTasks}`);
            score += 2;
          } else {
            details.push("getTaskMetrics returned unexpected structure");
            score += 1;
          }
        } catch {
          details.push("getTaskMetrics not available or errored");
        }

        // Edge case: missing task
        const missing = store.getTaskResult("nonexistent-task-xyz");
        if (!missing || missing === null || missing === undefined) {
          details.push("getTaskResult handles missing task gracefully");
          score += 2;
        } else {
          details.push("getTaskResult did not handle missing gracefully");
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
  });

  // ── Test 2.1.3: KV Store ──────────────────────────────────
  await harness.runTest("2.1.3", "SQLiteStore — KV Operations", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");
      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const store = new SQLiteStore(tempDir);
      await store.init();

      try {
        // Set a KV pair
        store.kvSet("test-key", { hello: "world" });
        details.push("kvSet succeeded");
        score += 2;

        // Get the value back
        const value = store.kvGet("test-key");
        if (
          value &&
          typeof value === "object" &&
          (value as any).hello === "world"
        ) {
          details.push("kvGet returned correct value");
          score += 2;
        } else {
          details.push(`kvGet returned: ${JSON.stringify(value)}`);
        }

        // Delete the key
        store.kvDelete("test-key");
        const deleted = store.kvGet("test-key");
        if (deleted === null || deleted === undefined) {
          details.push("kvDelete removed the key");
          score += 2;
        } else {
          details.push("kvDelete did not remove the key");
        }

        // TTL concept: set with TTL
        try {
          store.kvSet("ttl-key", "ephemeral", 1000);
          const ttlValue = store.kvGet("ttl-key");
          if (ttlValue !== null && ttlValue !== undefined) {
            details.push("kvSet with TTL stored value");
            score += 2;
          } else {
            details.push("kvSet with TTL did not store value");
          }
        } catch {
          details.push("kvSet TTL parameter not supported or errored");
          score += 1;
        }

        // Edge case: get non-existent key
        const missing = store.kvGet("nonexistent-key-xyz");
        if (missing === null || missing === undefined) {
          details.push("kvGet returns null for missing key");
          score += 2;
        } else {
          details.push("kvGet did not handle missing key gracefully");
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
  });

  // ── Test 2.1.4: FTS5 Search ────────────────────────────────
  await harness.runTest("2.1.4", "SQLiteStore — FTS5 Search", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");
      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const store = new SQLiteStore(tempDir);
      await store.init();

      try {
        // Upsert content into FTS
        store.ftsUpsert(
          "docs",
          "doc-1",
          "React component architecture guide",
          "text",
        );
        store.ftsUpsert(
          "docs",
          "doc-2",
          "PostgreSQL database optimization techniques",
          "text",
        );
        store.ftsUpsert(
          "docs",
          "doc-3",
          "React state management with Redux",
          "text",
        );
        details.push("ftsUpsert succeeded for 3 documents");
        score += 3;

        // Search for React-related content
        const results = store.ftsQuery("docs", "React", 10);
        if (Array.isArray(results) && results.length >= 2) {
          details.push(`ftsQuery('React') returned ${results.length} results`);
          score += 4;
        } else if (Array.isArray(results) && results.length >= 1) {
          details.push(
            `ftsQuery('React') returned ${results.length} result(s)`,
          );
          score += 2;
        } else {
          details.push(
            `ftsQuery returned unexpected: ${JSON.stringify(results)}`,
          );
        }

        // Search for something not present
        const empty = store.ftsQuery("docs", "xyznonexistent", 10);
        if (Array.isArray(empty) && empty.length === 0) {
          details.push("ftsQuery returns empty for non-matching query");
          score += 3;
        } else {
          details.push(
            `Non-matching ftsQuery returned ${Array.isArray(empty) ? empty.length : "non-array"}`,
          );
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
        `Import/init error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (tempDir)
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    return { score, maxScore, details: details.join("; ") };
  });

  // ── Test 2.1.5: Vector Operations ──────────────────────────
  await harness.runTest(
    "2.1.5",
    "SQLiteStore — Vector Operations (sqlite-vec)",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");
        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir, 384);
        await store.init();

        try {
          // Create a 384-dim vector
          const vec384 = new Array(384)
            .fill(0)
            .map((_, i) => Math.sin(i * 0.1));
          // Normalize it
          const norm = Math.sqrt(vec384.reduce((s, v) => s + v * v, 0));
          const normalizedVec = vec384.map((v) => v / norm);

          // Insert vector
          store.vectorUpsert(
            "docs",
            "vec-doc-1",
            normalizedVec,
            {
              sourceId: "test",
              contentType: "text",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              boost: 1.0,
            },
            "A test document about React components",
          );
          details.push("vectorUpsert succeeded");
          score += 3;

          // Insert a second vector (slightly different)
          const vec2 = new Array(384).fill(0).map((_, i) => Math.cos(i * 0.1));
          const norm2 = Math.sqrt(vec2.reduce((s, v) => s + v * v, 0));
          const normalizedVec2 = vec2.map((v) => v / norm2);

          store.vectorUpsert(
            "docs",
            "vec-doc-2",
            normalizedVec2,
            {
              sourceId: "test2",
              contentType: "text",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              boost: 1.0,
            },
            "A test document about PostgreSQL databases",
          );
          details.push("Second vectorUpsert succeeded");
          score += 2;

          // Query with the first vector
          const results = store.vectorQuery("docs", normalizedVec, 5);
          if (Array.isArray(results) && results.length >= 1) {
            details.push(`vectorQuery returned ${results.length} result(s)`);
            // Check that the closest match is vec-doc-1
            if (results[0].id === "vec-doc-1") {
              details.push("Closest match is correct (vec-doc-1)");
              score += 3;
            } else {
              details.push(`Closest match was ${results[0].id}`);
              score += 1;
            }
          } else {
            details.push("vectorQuery returned no results");
          }

          // Vector count
          try {
            const count = store.vectorCount("docs");
            if (count >= 2) {
              details.push(`vectorCount('docs') = ${count}`);
              score += 2;
            } else {
              details.push(`vectorCount returned ${count}`);
              score += 1;
            }
          } catch {
            details.push("vectorCount not available");
          }

          await store.close();
        } catch (err) {
          // sqlite-vec may not be available
          details.push(
            `Vector ops error (sqlite-vec may be unavailable): ${err instanceof Error ? err.message : String(err)}`,
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
}
