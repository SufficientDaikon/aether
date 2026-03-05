// ─────────────────────────────────────────────────────────────
// Tests: InteractionNet — HVM2-inspired computation graph
// ─────────────────────────────────────────────────────────────

import { describe, test, expect, beforeEach } from "bun:test";
import {
  InteractionNet,
  type INetNode,
  type Wire,
  type Port,
  type ActivePair,
  type TaskPayload,
  type CombinatorKind,
} from "../core/interaction-net.ts";

describe("InteractionNet", () => {
  let net: InteractionNet;

  beforeEach(() => {
    net = new InteractionNet();
  });

  // ── Node Operations ──────────────────────────────────────

  describe("Node operations", () => {
    test("generates unique IDs", () => {
      const id1 = net.nextId("test");
      const id2 = net.nextId("test");
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test-/);
    });

    test("adds and retrieves nodes", () => {
      const node: INetNode = {
        id: "n1",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n1", index: 0 },
        aux: [
          { nodeId: "n1", index: 1 },
          { nodeId: "n1", index: 2 },
        ],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(node);
      expect(net.getNode("n1")).toBe(node);
      expect(net.nodeCount).toBe(1);
    });

    test("removes nodes and their wires", () => {
      const n1: INetNode = {
        id: "n1",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n1", index: 0 },
        aux: [{ nodeId: "n1", index: 1 }, { nodeId: "n1", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      const n2: INetNode = {
        id: "n2",
        kind: "eraser",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n2", index: 0 },
        aux: [{ nodeId: "n2", index: 1 }, { nodeId: "n2", index: 2 }],
        payload: { kind: "eraser", reason: "cancel" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);
      net.connect(n1.principal, n2.principal);

      expect(net.nodeCount).toBe(2);
      expect(net.getStats().totalWires).toBe(1);

      net.removeNode("n1");
      expect(net.nodeCount).toBe(1);
      expect(net.getStats().totalWires).toBe(0);
    });

    test("getAllNodes returns all nodes", () => {
      const n1: INetNode = {
        id: "a",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "a", index: 0 },
        aux: [{ nodeId: "a", index: 1 }, { nodeId: "a", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };
      const n2: INetNode = {
        id: "b",
        kind: "eraser",
        status: "idle",
        priority: 3,
        principal: { nodeId: "b", index: 0 },
        aux: [{ nodeId: "b", index: 1 }, { nodeId: "b", index: 2 }],
        payload: { kind: "eraser", reason: "cancel" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);

      const all = net.getAllNodes();
      expect(all).toHaveLength(2);
      expect(all.map((n) => n.id).sort()).toEqual(["a", "b"]);
    });
  });

  // ── Wire Operations ──────────────────────────────────────

  describe("Wire operations", () => {
    test("connects two ports", () => {
      const n1: INetNode = {
        id: "n1",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n1", index: 0 },
        aux: [{ nodeId: "n1", index: 1 }, { nodeId: "n1", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };
      const n2: INetNode = {
        id: "n2",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n2", index: 0 },
        aux: [{ nodeId: "n2", index: 1 }, { nodeId: "n2", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);

      const wire = net.connect(n1.principal, n2.principal);
      expect(wire.from.nodeId).toBe("n1");
      expect(wire.to.nodeId).toBe("n2");
      expect(net.getStats().totalWires).toBe(1);
    });

    test("getWiresForPort returns connected wires", () => {
      const n1: INetNode = {
        id: "x",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "x", index: 0 },
        aux: [{ nodeId: "x", index: 1 }, { nodeId: "x", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };
      const n2: INetNode = {
        id: "y",
        kind: "eraser",
        status: "idle",
        priority: 3,
        principal: { nodeId: "y", index: 0 },
        aux: [{ nodeId: "y", index: 1 }, { nodeId: "y", index: 2 }],
        payload: { kind: "eraser", reason: "cancel" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);
      net.connect(n1.principal, n2.principal);

      const wires = net.getWiresForPort("x", 0);
      expect(wires).toHaveLength(1);
      expect(wires[0].to.nodeId).toBe("y");
    });

    test("getConnectedNode returns the other endpoint", () => {
      const n1: INetNode = {
        id: "a",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "a", index: 0 },
        aux: [{ nodeId: "a", index: 1 }, { nodeId: "a", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };
      const n2: INetNode = {
        id: "b",
        kind: "eraser",
        status: "idle",
        priority: 3,
        principal: { nodeId: "b", index: 0 },
        aux: [{ nodeId: "b", index: 1 }, { nodeId: "b", index: 2 }],
        payload: { kind: "eraser", reason: "cancel" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);
      net.connect(n1.principal, n2.principal);

      const connected = net.getConnectedNode("a", 0);
      expect(connected?.id).toBe("b");
    });
  });

  // ── Active Pair Detection ────────────────────────────────

  describe("Active pair detection", () => {
    test("detects active pair between two principal-connected nodes", () => {
      const n1: INetNode = {
        id: "n1",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n1", index: 0 },
        aux: [{ nodeId: "n1", index: 1 }, { nodeId: "n1", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };
      const n2: INetNode = {
        id: "n2",
        kind: "duplicator",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n2", index: 0 },
        aux: [{ nodeId: "n2", index: 1 }, { nodeId: "n2", index: 2 }],
        payload: { kind: "duplicator", label: "fanout", targets: ["a", "b"], mode: "all" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);
      net.connect(n1.principal, n2.principal);

      const pairs = net.findActivePairs();
      expect(pairs.length).toBeGreaterThanOrEqual(1);

      const pair = pairs[0];
      const ids = [pair.left.id, pair.right.id].sort();
      expect(ids).toEqual(["n1", "n2"]);
    });

    test("getReadyPairs only returns idle-status pairs", () => {
      const makeNode = (id: string, kind: CombinatorKind): INetNode => ({
        id,
        kind,
        status: "idle",
        priority: 3,
        principal: { nodeId: id, index: 0 },
        aux: [{ nodeId: id, index: 1 }, { nodeId: id, index: 2 }],
        payload:
          kind === "eraser"
            ? { kind: "eraser", reason: "cancel" }
            : { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      });

      const a = makeNode("a", "constructor");
      const b = makeNode("b", "eraser");
      const c = makeNode("c", "constructor");
      const d = makeNode("d", "eraser");

      net.addNode(a);
      net.addNode(b);
      net.addNode(c);
      net.addNode(d);

      net.connect(a.principal, b.principal);
      net.connect(c.principal, d.principal);

      // Mark one pair as reducing
      a.status = "reducing";

      const ready = net.getReadyPairs();
      // Only c-d pair should be ready (both idle)
      const readyIds = ready.map((p) => [p.left.id, p.right.id].sort().join("-"));
      expect(readyIds).toContain("c-d");
      expect(readyIds).not.toContain("a-b");
    });

    test("claimPair atomically marks nodes as reducing", () => {
      const n1: INetNode = {
        id: "n1",
        kind: "constructor",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n1", index: 0 },
        aux: [{ nodeId: "n1", index: 1 }, { nodeId: "n1", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: null,
      };
      const n2: INetNode = {
        id: "n2",
        kind: "eraser",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n2", index: 0 },
        aux: [{ nodeId: "n2", index: 1 }, { nodeId: "n2", index: 2 }],
        payload: { kind: "eraser", reason: "cancel" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);
      const wire = net.connect(n1.principal, n2.principal);

      // Find the active pair via the net API
      const pairs = net.findActivePairs();
      expect(pairs.length).toBeGreaterThanOrEqual(1);

      const claimed = net.claimPair(pairs[0].id, "test-worker");
      expect(claimed).not.toBeNull();
      expect(n1.status).toBe("reducing");
      expect(n2.status).toBe("reducing");
      expect(n1.claimedBy).toBe("test-worker");
    });

    test("claimPair fails if nodes are not idle", () => {
      const n1: INetNode = {
        id: "n1",
        kind: "constructor",
        status: "reducing",
        priority: 3,
        principal: { nodeId: "n1", index: 0 },
        aux: [{ nodeId: "n1", index: 1 }, { nodeId: "n1", index: 2 }],
        payload: { kind: "constructor", label: "join", arity: 2, strategy: "concat" },
        createdAt: Date.now(),
        claimedBy: "other",
      };
      const n2: INetNode = {
        id: "n2",
        kind: "eraser",
        status: "idle",
        priority: 3,
        principal: { nodeId: "n2", index: 0 },
        aux: [{ nodeId: "n2", index: 1 }, { nodeId: "n2", index: 2 }],
        payload: { kind: "eraser", reason: "cancel" },
        createdAt: Date.now(),
        claimedBy: null,
      };

      net.addNode(n1);
      net.addNode(n2);
      const wire = net.connect(n1.principal, n2.principal);

      // Even though there's a wire, claimPair should return null
      // because n1 is already in "reducing" status
      const pairs = net.findActivePairs();
      // findActivePairs filters out non-idle nodes, so no pairs should be found
      expect(pairs).toHaveLength(0);

      // Trying to claim a non-existent pair returns null
      const claimed = net.claimPair("ap-n1:n2", "worker-2");
      expect(claimed).toBeNull();
    });
  });

  // ── Factory Methods ──────────────────────────────────────

  describe("Factory methods", () => {
    test("createTaskNode creates a constructor node with task payload", () => {
      const task = net.createTaskNode("test task", "agent-1", { foo: "bar" }, 4);

      expect(task.kind).toBe("constructor");
      expect(task.status).toBe("idle");
      expect(task.priority).toBe(4);

      const payload = task.payload as TaskPayload;
      expect(payload.kind).toBe("task");
      expect(payload.description).toBe("test task");
      expect(payload.agentId).toBe("agent-1");
      expect(payload.context.foo).toBe("bar");
    });

    test("createJoin creates a constructor for joining results", () => {
      const join = net.createJoin(3, "concat");
      expect(join.kind).toBe("constructor");
      expect(join.payload).toHaveProperty("kind", "constructor");
    });

    test("createEraser creates an eraser node", () => {
      const eraser = net.createEraser("timeout");
      expect(eraser.kind).toBe("eraser");
      expect(eraser.payload).toHaveProperty("kind", "eraser");
    });

    test("createFanOut creates a duplicator node", () => {
      const payload: TaskPayload = {
        kind: "task",
        description: "test",
        agentId: "agent-1",
        context: {},
        priority: 3,
        timeout: 120_000,
      };

      const fanout = net.createFanOut(payload, ["a", "b", "c"], "all");
      expect(fanout.kind).toBe("duplicator");
    });
  });

  // ── DAG Construction ─────────────────────────────────────

  describe("DAG construction", () => {
    test("buildParallelDAG creates task nodes connected to a join", () => {
      const result = net.buildParallelDAG([
        { description: "task1", agentId: "agent-1" },
        { description: "task2", agentId: "agent-2" },
        { description: "task3", agentId: "agent-3" },
      ]);

      expect(result.tasks).toHaveLength(3);
      expect(result.join).toBeDefined();
      expect(result.join.kind).toBe("constructor");

      // Each task should be connected to the join
      for (const task of result.tasks) {
        const wires = net.getWiresForPort(task.id, 0);
        expect(wires.length).toBeGreaterThanOrEqual(1);
      }

      // Active pairs should be detected
      const pairs = net.findActivePairs();
      expect(pairs.length).toBeGreaterThanOrEqual(3);
    });

    test("buildPipeline creates sequential task chain", () => {
      const nodes = net.buildPipeline([
        { description: "step1", agentId: "agent-1" },
        { description: "step2", agentId: "agent-2" },
        { description: "step3", agentId: "agent-3" },
      ]);

      expect(nodes).toHaveLength(3);

      // Check sequential wiring: step1.aux[1] → step2.principal
      // aux[1] has port index 2 (principal=0, aux[0]=1, aux[1]=2)
      const step1Wires = net.getWiresForPort(nodes[0].id, 2);
      expect(step1Wires.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── isNormalForm ──────────────────────────────────────────

  describe("Normal form detection", () => {
    test("empty net is in normal form", () => {
      expect(net.isNormalForm()).toBe(true);
    });

    test("net with active pairs is not in normal form", () => {
      net.buildParallelDAG([
        { description: "t", agentId: "a" },
      ]);

      // Has active pairs from the task-join connection
      expect(net.isNormalForm()).toBe(false);
    });
  });

  // ── Stats ────────────────────────────────────────────────

  describe("Stats", () => {
    test("getStats returns correct counts", () => {
      net.createTaskNode("task1", "agent-1");
      net.createTaskNode("task2", "agent-2");
      net.createEraser("done");

      const stats = net.getStats();
      expect(stats.totalNodes).toBe(3);
      expect(stats.byKind.constructor).toBe(2); // tasks are constructors
      expect(stats.byKind.eraser).toBe(1);
      expect(stats.byStatus.idle).toBe(3);
    });
  });
});
