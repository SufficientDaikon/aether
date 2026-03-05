// ─────────────────────────────────────────────────────────────
// AETHER State Graph
//
// LangGraph-inspired conditional-edge state machine with cycle
// support. Unlike InteractionNet (parallel reduction), StateGraph
// is for sequential decision flows with branches and reflection
// loops.
// ─────────────────────────────────────────────────────────────

import type { StateGraphConfig } from "./types.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** State flowing through the graph */
export type GraphState = Record<string, unknown>;

/** Node executor function */
export type NodeExecutor = (state: GraphState) => Promise<GraphState>;

/** Edge condition: returns target node ID or null to follow default */
export type EdgeCondition = (state: GraphState) => string | null;

interface InternalNode {
  id: string;
  label: string;
  executor: NodeExecutor;
}

interface InternalEdge {
  from: string;
  to: string;
  condition?: EdgeCondition;
}

// ─────────────────────────────────────────────────────────────
// State Graph Builder
// ─────────────────────────────────────────────────────────────

export class StateGraph {
  private config: StateGraphConfig;
  private nodes: Map<string, InternalNode> = new Map();
  private edges: InternalEdge[] = [];

  constructor(config: StateGraphConfig) {
    this.config = config;
  }

  /** Add a processing node to the graph */
  addNode(id: string, label: string, executor: NodeExecutor): this {
    if (this.nodes.has(id)) {
      throw new Error(`Node "${id}" already exists`);
    }
    this.nodes.set(id, { id, label, executor });
    return this;
  }

  /** Add an unconditional edge between nodes */
  addEdge(from: string, to: string): this {
    this.edges.push({ from, to });
    return this;
  }

  /** Add a conditional edge — condition returns target node ID */
  addConditionalEdge(from: string, condition: EdgeCondition): this {
    this.edges.push({ from, to: "__conditional__", condition });
    return this;
  }

  /** Compile the graph, validating structure */
  compile(): CompiledGraph {
    if (!this.nodes.has(this.config.entryNode)) {
      throw new Error(
        `Entry node "${this.config.entryNode}" not found in graph`,
      );
    }

    for (const exit of this.config.exitNodes) {
      if (!this.nodes.has(exit)) {
        throw new Error(`Exit node "${exit}" not found in graph`);
      }
    }

    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) {
        throw new Error(`Edge source "${edge.from}" not found in graph`);
      }
      if (edge.to !== "__conditional__" && !this.nodes.has(edge.to)) {
        throw new Error(`Edge target "${edge.to}" not found in graph`);
      }
    }

    const reachable = this.findReachableNodes(this.config.entryNode);
    const unreachable = [...this.nodes.keys()].filter(
      (id) => !reachable.has(id),
    );

    return new CompiledGraph(
      this.config,
      new Map(this.nodes),
      [...this.edges],
      unreachable,
    );
  }

  private findReachableNodes(start: string): Set<string> {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of this.edges) {
        if (edge.from === current) {
          if (edge.to !== "__conditional__") {
            queue.push(edge.to);
          } else {
            for (const nodeId of this.nodes.keys()) {
              queue.push(nodeId);
            }
          }
        }
      }
    }
    return visited;
  }
}

// ─────────────────────────────────────────────────────────────
// Compiled Graph — Executable
// ─────────────────────────────────────────────────────────────

export class CompiledGraph {
  private config: StateGraphConfig;
  private nodes: Map<string, InternalNode>;
  private edges: InternalEdge[];
  readonly unreachableNodes: string[];

  constructor(
    config: StateGraphConfig,
    nodes: Map<string, InternalNode>,
    edges: InternalEdge[],
    unreachableNodes: string[],
  ) {
    this.config = config;
    this.nodes = nodes;
    this.edges = edges;
    this.unreachableNodes = unreachableNodes;
  }

  /**
   * Execute the graph from entry to exit, flowing state through nodes.
   * Returns the final state and execution trace.
   */
  async run(initialState: GraphState): Promise<{
    state: GraphState;
    trace: Array<{ nodeId: string; label: string; iteration: number }>;
    iterations: number;
    exitNode: string | null;
  }> {
    let currentNode = this.config.entryNode;
    let state = { ...initialState };
    const trace: Array<{ nodeId: string; label: string; iteration: number }> =
      [];
    let iterations = 0;
    let exitNode: string | null = null;

    while (iterations < this.config.maxIterations) {
      iterations++;

      const node = this.nodes.get(currentNode);
      if (!node) {
        throw new Error(`Node "${currentNode}" not found during execution`);
      }

      trace.push({ nodeId: node.id, label: node.label, iteration: iterations });
      state = await node.executor(state);

      if (this.config.exitNodes.includes(currentNode)) {
        exitNode = currentNode;
        break;
      }

      const nextNode = this.resolveNextNode(currentNode, state);
      if (nextNode === null) {
        exitNode = currentNode;
        break;
      }

      currentNode = nextNode;
    }

    if (iterations >= this.config.maxIterations && exitNode === null) {
      exitNode = currentNode;
    }

    return { state, trace, iterations, exitNode };
  }

  getNodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  getEdgeCount(): number {
    return this.edges.length;
  }

  private resolveNextNode(fromId: string, state: GraphState): string | null {
    const outEdges = this.edges.filter((e) => e.from === fromId);
    if (outEdges.length === 0) return null;

    for (const edge of outEdges) {
      if (edge.condition) {
        const target = edge.condition(state);
        if (target !== null) {
          if (!this.nodes.has(target)) {
            throw new Error(
              `Conditional edge from "${fromId}" resolved to non-existent node "${target}"`,
            );
          }
          return target;
        }
      }
    }

    const unconditional = outEdges.find((e) => !e.condition);
    return unconditional?.to === "__conditional__"
      ? null
      : (unconditional?.to ?? null);
  }
}
