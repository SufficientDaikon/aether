// ─────────────────────────────────────────────────────────────
// AETHER E2E Persistence Tests
//
// Verifies that all data written to SQLiteStore survives a
// close/reopen cycle. Each test creates a fresh temp directory,
// opens the store, writes data, closes, reopens, and asserts
// the data is intact.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteStore } from "../core/storage/sqlite-store.ts";
import type {
  AgentDefinition,
  TaskResult,
  EscalationRecord,
} from "../core/types.ts";
import type { HighwayMessage } from "../core/memory-highway.ts";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Create a unique temporary directory for each test. */
function createTestDir(): string {
  return mkdtempSync(join(tmpdir(), "aether-e2e-"));
}

/** Build an AgentDefinition with sensible defaults and optional overrides. */
function createAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    tier: "worker",
    sections: ["FRONTEND"],
    capabilities: ["react", "typescript"],
    dependencies: ["build-tools"],
    llmRequirement: "haiku",
    format: "markdown",
    escalationTarget: null,
    filePath: "/agents/test.agent.md",
    status: "idle",
    metadata: {},
    ...overrides,
  };
}

/** Build a TaskResult with sensible defaults and optional overrides. */
function createTaskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    requestId: "task-001",
    executor: "test-agent",
    status: "success",
    output: { result: "done" },
    duration: 1234,
    tokensUsed: 500,
    ...overrides,
  };
}

/** Build a HighwayMessage with sensible defaults and optional overrides. */
function createMessage(
  overrides: Partial<HighwayMessage> = {},
): HighwayMessage {
  return {
    id: "msg-001",
    channel: "tasks",
    sender: "agent-a",
    type: "task",
    payload: { description: "do something" },
    summary: "Agent A requests a task",
    priority: 3,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

describe("E2E Persistence — SQLiteStore close/reopen", () => {
  const dirs: string[] = [];

  afterEach(() => {
    // Clean up all temp directories created during the test
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; ignore errors on Windows lock files
      }
    }
    dirs.length = 0;
  });

  /** Helper that tracks a newly created dir for cleanup. */
  function trackDir(): string {
    const dir = createTestDir();
    dirs.push(dir);
    return dir;
  }

  // ────────────────────────────────────────────────────────────
  // 1. Agent persistence
  // ────────────────────────────────────────────────────────────

  it("should persist agents across restart", async () => {
    const dir = trackDir();

    // First lifecycle — write agents
    const store1 = new SQLiteStore(dir);
    await store1.init();
    store1.saveAgent(
      createAgent({ id: "agent-1", name: "Frontend Worker", tier: "worker" }),
    );
    store1.saveAgent(
      createAgent({
        id: "agent-2",
        name: "Backend Manager",
        tier: "manager",
        sections: ["BACKEND"],
        capabilities: ["node", "postgres"],
        escalationTarget: "agent-master",
      }),
    );
    store1.saveAgent(
      createAgent({
        id: "agent-master",
        name: "Master Agent",
        tier: "master",
        format: "xml",
        llmRequirement: "opus",
        metadata: { priority: "high" },
      }),
    );
    await store1.close();

    // Second lifecycle — verify agents survived
    const store2 = new SQLiteStore(dir);
    await store2.init();

    const a1 = store2.getAgent("agent-1");
    expect(a1).not.toBeNull();
    expect(a1!.id).toBe("agent-1");
    expect(a1!.name).toBe("Frontend Worker");
    expect(a1!.tier).toBe("worker");
    expect(a1!.sections).toEqual(["FRONTEND"]);
    expect(a1!.capabilities).toEqual(["react", "typescript"]);
    expect(a1!.dependencies).toEqual(["build-tools"]);
    expect(a1!.format).toBe("markdown");
    expect(a1!.status).toBe("idle");

    const a2 = store2.getAgent("agent-2");
    expect(a2).not.toBeNull();
    expect(a2!.tier).toBe("manager");
    expect(a2!.sections).toEqual(["BACKEND"]);
    expect(a2!.capabilities).toEqual(["node", "postgres"]);
    expect(a2!.escalationTarget).toBe("agent-master");

    const master = store2.getAgent("agent-master");
    expect(master).not.toBeNull();
    expect(master!.tier).toBe("master");
    expect(master!.format).toBe("xml");
    expect(master!.llmRequirement).toBe("opus");
    expect(master!.metadata).toEqual({ priority: "high" });

    const all = store2.getAllAgents();
    expect(all.length).toBe(3);

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 2. Task result persistence
  // ────────────────────────────────────────────────────────────

  it("should persist task results across restart", async () => {
    const dir = trackDir();

    // First lifecycle — save task results
    const store1 = new SQLiteStore(dir);
    await store1.init();
    store1.saveTaskResult(
      createTaskResult({
        requestId: "t-1",
        executor: "worker-a",
        status: "success",
        duration: 100,
        tokensUsed: 200,
      }),
      "Build the frontend",
      "manager-1",
      2,
    );
    store1.saveTaskResult(
      createTaskResult({
        requestId: "t-2",
        executor: "worker-b",
        status: "failure",
        output: { error: "timeout" },
        duration: 5000,
      }),
      "Deploy service",
      "manager-1",
      4,
    );
    store1.saveTaskResult(
      createTaskResult({
        requestId: "t-3",
        executor: "worker-a",
        status: "escalated",
        duration: 300,
      }),
    );
    await store1.close();

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    const t1 = store2.getTaskResult("t-1");
    expect(t1).not.toBeNull();
    expect(t1!.requestId).toBe("t-1");
    expect(t1!.executor).toBe("worker-a");
    expect(t1!.status).toBe("success");
    expect(t1!.duration).toBe(100);
    expect(t1!.tokensUsed).toBe(200);

    const t2 = store2.getTaskResult("t-2");
    expect(t2).not.toBeNull();
    expect(t2!.status).toBe("failure");
    expect(t2!.output).toEqual({ error: "timeout" });
    expect(t2!.duration).toBe(5000);

    const t3 = store2.getTaskResult("t-3");
    expect(t3).not.toBeNull();
    expect(t3!.status).toBe("escalated");

    // getRecentTasks returns newest first
    const recent = store2.getRecentTasks(10);
    expect(recent.length).toBe(3);
    // All three request IDs should be present
    const ids = recent.map((r) => r.requestId);
    expect(ids).toContain("t-1");
    expect(ids).toContain("t-2");
    expect(ids).toContain("t-3");

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 3. Escalation persistence
  // ────────────────────────────────────────────────────────────

  it("should persist escalation records and master count across restart", async () => {
    const dir = trackDir();

    // First lifecycle — save escalation data
    const store1 = new SQLiteStore(dir);
    await store1.init();

    const record: EscalationRecord = {
      agentId: "worker-flaky",
      count: 3,
      lastEscalation: Date.now(),
      reasons: ["timeout", "model error", "context overflow"],
    };
    store1.saveEscalationRecord("worker-flaky", record);

    store1.saveEscalationRecord("worker-crash", {
      agentId: "worker-crash",
      count: 1,
      lastEscalation: Date.now() - 60_000,
      reasons: ["segfault"],
    });

    // Increment master escalation count a few times
    store1.incrementMasterEscalationCount();
    store1.incrementMasterEscalationCount();
    store1.incrementMasterEscalationCount();

    await store1.close();

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    const rec1 = store2.getEscalationRecord("worker-flaky");
    expect(rec1).not.toBeNull();
    expect(rec1!.agentId).toBe("worker-flaky");
    expect(rec1!.count).toBe(3);
    expect(rec1!.reasons).toEqual([
      "timeout",
      "model error",
      "context overflow",
    ]);
    expect(rec1!.lastEscalation).toBe(record.lastEscalation);

    const rec2 = store2.getEscalationRecord("worker-crash");
    expect(rec2).not.toBeNull();
    expect(rec2!.count).toBe(1);
    expect(rec2!.reasons).toEqual(["segfault"]);

    const masterCount = store2.getMasterEscalationCount();
    expect(masterCount).toBe(3);

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 4. Message persistence
  // ────────────────────────────────────────────────────────────

  it("should persist messages across restart", async () => {
    const dir = trackDir();
    const now = Date.now();

    // First lifecycle — save messages
    const store1 = new SQLiteStore(dir);
    await store1.init();

    store1.saveMessage(
      createMessage({
        id: "m-1",
        channel: "tasks",
        sender: "manager-1",
        type: "task",
        summary: "Build login page",
        priority: 4,
        correlationId: "corr-100",
        timestamp: now - 3000,
      }),
    );

    store1.saveMessage(
      createMessage({
        id: "m-2",
        channel: "tasks",
        sender: "worker-1",
        type: "result",
        summary: "Login page built",
        priority: 3,
        correlationId: "corr-100",
        timestamp: now - 2000,
      }),
    );

    store1.saveMessage(
      createMessage({
        id: "m-3",
        channel: "events",
        sender: "system",
        type: "event",
        summary: "Deploy triggered",
        priority: 2,
        timestamp: now - 1000,
      }),
    );

    await store1.close();

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    // Channel-scoped query
    const taskMsgs = store2.getRecentMessages("tasks", 10);
    expect(taskMsgs.length).toBe(2);
    // Messages should be in ascending timestamp order (reversed from DESC)
    expect(taskMsgs[0].id).toBe("m-1");
    expect(taskMsgs[1].id).toBe("m-2");

    const eventMsgs = store2.getRecentMessages("events", 10);
    expect(eventMsgs.length).toBe(1);
    expect(eventMsgs[0].id).toBe("m-3");
    expect(eventMsgs[0].summary).toBe("Deploy triggered");

    // Wildcard query
    const allMsgs = store2.getRecentMessages("*", 10);
    expect(allMsgs.length).toBe(3);

    // Correlation query
    const correlated = store2.getMessagesByCorrelation("corr-100");
    expect(correlated.length).toBe(2);
    expect(correlated[0].id).toBe("m-1");
    expect(correlated[1].id).toBe("m-2");
    expect(correlated[0].type).toBe("task");
    expect(correlated[1].type).toBe("result");

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 5. KV persistence
  // ────────────────────────────────────────────────────────────

  it("should persist KV pairs across restart (non-expired survive, expired do not)", async () => {
    const dir = trackDir();

    // First lifecycle — set KV pairs
    const store1 = new SQLiteStore(dir);
    await store1.init();

    // Permanent keys (no TTL)
    store1.kvSet("config:theme", "dark");
    store1.kvSet("config:locale", { lang: "en", region: "US" });
    store1.kvSet("counter:visits", 42);

    // Key with a very long TTL (should survive)
    store1.kvSet("session:long", "still-valid", 3_600_000); // 1 hour from now

    // Key with an already-expired TTL (set TTL of 1ms, then wait)
    store1.kvSet("session:expired", "gone", 1);

    await store1.close();

    // Small delay to ensure the 1ms TTL has lapsed
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    expect(store2.kvGet("config:theme")).toBe("dark");
    expect(store2.kvGet("config:locale")).toEqual({ lang: "en", region: "US" });
    expect(store2.kvGet("counter:visits")).toBe(42);
    expect(store2.kvGet("session:long")).toBe("still-valid");

    // Expired key should return null
    expect(store2.kvGet("session:expired")).toBeNull();

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 6. TF-IDF state persistence
  // ────────────────────────────────────────────────────────────

  it("should persist TF-IDF state across restart", async () => {
    const dir = trackDir();

    const tfidfState = {
      df: { hello: 5, world: 3, typescript: 10, react: 8 },
      vocab: { hello: 0, world: 1, typescript: 2, react: 3 },
      totalDocs: 25,
    };

    // First lifecycle — save TF-IDF state
    const store1 = new SQLiteStore(dir);
    await store1.init();
    store1.saveTFIDFState(tfidfState);
    await store1.close();

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    const loaded = store2.loadTFIDFState();
    expect(loaded).not.toBeNull();
    expect(loaded!.df).toEqual(tfidfState.df);
    expect(loaded!.vocab).toEqual(tfidfState.vocab);
    expect(loaded!.totalDocs).toBe(25);

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 7. InteractionNet snapshot persistence
  // ────────────────────────────────────────────────────────────

  it("should persist InteractionNet snapshot across restart", async () => {
    const dir = trackDir();

    const nodes = [
      {
        id: "node-1",
        kind: "constructor" as const,
        status: "idle" as const,
        priority: 3 as const,
        principal: { nodeId: "node-1", index: 0 as const },
        aux: [
          { nodeId: "node-1", index: 1 as const },
          { nodeId: "node-1", index: 2 as const },
        ] as [{ nodeId: string; index: 1 }, { nodeId: string; index: 2 }],
        payload: {
          kind: "constructor" as const,
          mergeStrategy: "concat" as const,
          arity: 2,
          inputs: [],
        },
        createdAt: Date.now(),
        claimedBy: null,
      },
      {
        id: "node-2",
        kind: "duplicator" as const,
        status: "active" as const,
        priority: 2 as const,
        principal: { nodeId: "node-2", index: 0 as const },
        aux: [
          { nodeId: "node-2", index: 1 as const },
          { nodeId: "node-2", index: 2 as const },
        ] as [{ nodeId: string; index: 1 }, { nodeId: string; index: 2 }],
        payload: { kind: "duplicator" as const, fanOut: 2, label: "broadcast" },
        createdAt: Date.now(),
        claimedBy: "worker-1",
      },
    ];

    const wires = [
      {
        id: "wire-1",
        from: { nodeId: "node-1", index: 0 as const },
        to: { nodeId: "node-2", index: 0 as const },
      },
    ];

    // First lifecycle — save snapshot
    const store1 = new SQLiteStore(dir);
    await store1.init();
    store1.saveNetSnapshot(nodes as any, wires);
    await store1.close();

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    const snapshot = store2.loadNetSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nodes.length).toBe(2);
    expect(snapshot!.wires.length).toBe(1);

    expect(snapshot!.nodes[0].id).toBe("node-1");
    expect(snapshot!.nodes[0].kind).toBe("constructor");
    expect(snapshot!.nodes[1].id).toBe("node-2");
    expect(snapshot!.nodes[1].kind).toBe("duplicator");
    expect(snapshot!.nodes[1].claimedBy).toBe("worker-1");

    expect(snapshot!.wires[0].id).toBe("wire-1");
    expect(snapshot!.wires[0].from.nodeId).toBe("node-1");
    expect(snapshot!.wires[0].to.nodeId).toBe("node-2");

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 8. Metrics persistence
  // ────────────────────────────────────────────────────────────

  it("should persist counters and gauges across restart", async () => {
    const dir = trackDir();

    // First lifecycle — set metrics
    const store1 = new SQLiteStore(dir);
    await store1.init();

    store1.incrementCounter("tasks.completed", 10);
    store1.incrementCounter("tasks.completed", 5);
    store1.incrementCounter("tasks.failed", 2);

    store1.setGauge("agents.active", 7);
    store1.setGauge("memory.usageMB", 256.5);
    store1.setGauge("queue.depth", 42);

    await store1.close();

    // Second lifecycle — verify
    const store2 = new SQLiteStore(dir);
    await store2.init();

    expect(store2.getCounter("tasks.completed")).toBe(15);
    expect(store2.getCounter("tasks.failed")).toBe(2);
    expect(store2.getCounter("nonexistent")).toBe(0);

    expect(store2.getGauge("agents.active")).toBe(7);
    expect(store2.getGauge("memory.usageMB")).toBe(256.5);
    expect(store2.getGauge("queue.depth")).toBe(42);
    expect(store2.getGauge("nonexistent")).toBe(0);

    await store2.close();
  });

  // ────────────────────────────────────────────────────────────
  // 9. Multiple lifecycle cycles
  // ────────────────────────────────────────────────────────────

  it("should survive multiple init/write/close/reopen cycles", async () => {
    const dir = trackDir();

    // ── Cycle 1: Write initial data ──────────────────────────
    const store1 = new SQLiteStore(dir);
    await store1.init();

    store1.saveAgent(
      createAgent({ id: "persistent-agent", name: "Cycle1 Agent" }),
    );
    store1.saveTaskResult(
      createTaskResult({
        requestId: "cycle1-task",
        executor: "persistent-agent",
        status: "success",
        duration: 100,
      }),
    );
    store1.kvSet("cycle", 1);
    store1.incrementCounter("restarts", 1);
    store1.setGauge("cycle.current", 1);

    store1.saveMessage(
      createMessage({
        id: "cycle1-msg",
        channel: "lifecycle",
        sender: "test",
        type: "event",
        summary: "Cycle 1 complete",
        timestamp: Date.now() - 2000,
      }),
    );

    await store1.close();

    // ── Cycle 2: Write more data, verify cycle 1 data ────────
    const store2 = new SQLiteStore(dir);
    await store2.init();

    // Verify cycle 1 data exists
    expect(store2.getAgent("persistent-agent")).not.toBeNull();
    expect(store2.getAgent("persistent-agent")!.name).toBe("Cycle1 Agent");
    expect(store2.getTaskResult("cycle1-task")).not.toBeNull();
    expect(store2.kvGet("cycle")).toBe(1);

    // Write more data
    store2.saveAgent(
      createAgent({
        id: "cycle2-agent",
        name: "Cycle2 Agent",
        tier: "manager",
      }),
    );
    store2.saveTaskResult(
      createTaskResult({
        requestId: "cycle2-task",
        executor: "cycle2-agent",
        status: "partial",
        duration: 200,
      }),
    );
    store2.kvSet("cycle", 2);
    store2.incrementCounter("restarts", 1);
    store2.setGauge("cycle.current", 2);

    store2.saveMessage(
      createMessage({
        id: "cycle2-msg",
        channel: "lifecycle",
        sender: "test",
        type: "event",
        summary: "Cycle 2 complete",
        timestamp: Date.now() - 1000,
      }),
    );

    store2.saveEscalationRecord("persistent-agent", {
      agentId: "persistent-agent",
      count: 1,
      lastEscalation: Date.now(),
      reasons: ["performance degradation"],
    });

    store2.saveTFIDFState({
      df: { cycle: 2, test: 1 },
      vocab: { cycle: 0, test: 1 },
      totalDocs: 5,
    });

    await store2.close();

    // ── Cycle 3: Verify everything from cycles 1 and 2 ──────
    const store3 = new SQLiteStore(dir);
    await store3.init();

    // Agents from both cycles
    const allAgents = store3.getAllAgents();
    expect(allAgents.length).toBe(2);
    expect(store3.getAgent("persistent-agent")).not.toBeNull();
    expect(store3.getAgent("cycle2-agent")).not.toBeNull();
    expect(store3.getAgent("cycle2-agent")!.tier).toBe("manager");

    // Tasks from both cycles
    const allTasks = store3.getRecentTasks(10);
    expect(allTasks.length).toBe(2);
    expect(store3.getTaskResult("cycle1-task")!.status).toBe("success");
    expect(store3.getTaskResult("cycle2-task")!.status).toBe("partial");

    // KV was overwritten in cycle 2
    expect(store3.kvGet("cycle")).toBe(2);

    // Counter accumulated across cycles
    expect(store3.getCounter("restarts")).toBe(2);

    // Gauge reflects last set value
    expect(store3.getGauge("cycle.current")).toBe(2);

    // Messages from both cycles
    const lifecycleMsgs = store3.getRecentMessages("lifecycle", 10);
    expect(lifecycleMsgs.length).toBe(2);
    const msgIds = lifecycleMsgs.map((m) => m.id);
    expect(msgIds).toContain("cycle1-msg");
    expect(msgIds).toContain("cycle2-msg");

    // Escalation from cycle 2
    const esc = store3.getEscalationRecord("persistent-agent");
    expect(esc).not.toBeNull();
    expect(esc!.count).toBe(1);
    expect(esc!.reasons).toEqual(["performance degradation"]);

    // TF-IDF from cycle 2
    const tfidf = store3.loadTFIDFState();
    expect(tfidf).not.toBeNull();
    expect(tfidf!.totalDocs).toBe(5);
    expect(tfidf!.df).toEqual({ cycle: 2, test: 1 });

    await store3.close();
  });
});
