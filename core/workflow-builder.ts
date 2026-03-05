// -----------------------------------------------------------------
// AETHER Workflow Builder
//
// Fluent TypeScript API for constructing workflows that compile down
// to structured task sequences. Supports sequential chains, parallel
// fan-out, handoff chains, conditional branches, and aggregation.
// -----------------------------------------------------------------

import type { AgentTier } from "./types.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/** A step in the workflow */
export interface WorkflowStep {
  id: string;
  agent: string;
  task: string;
  type: "sequential" | "parallel" | "handoff" | "conditional" | "aggregate";
  group?: string;
  dependsOn?: string[];
  condition?: (context: Record<string, unknown>) => string;
  metadata?: Record<string, unknown>;
}

/** Compiled workflow ready for execution */
export interface CompiledWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  parallelGroups: Map<string, string[]>;
  entrySteps: string[];
  exitSteps: string[];
}

/** Agent-task pair for builder input */
export interface AgentTask {
  agent: string;
  task: string;
  metadata?: Record<string, unknown>;
}

// -----------------------------------------------------------------
// Workflow Builder
// -----------------------------------------------------------------

export class WorkflowBuilder {
  private name: string;
  private steps: WorkflowStep[] = [];
  private parallelGroups: Map<string, string[]> = new Map();
  private stepCounter = 0;
  private lastStepIds: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a sequential chain of agent tasks.
   * Each step depends on the previous one completing.
   */
  sequential(tasks: AgentTask[]): this {
    const stepIds: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const stepId = this.nextStepId();
      const dependsOn =
        i === 0
          ? this.lastStepIds.length > 0
            ? [...this.lastStepIds]
            : undefined
          : [stepIds[i - 1]];

      this.steps.push({
        id: stepId,
        agent: tasks[i].agent,
        task: tasks[i].task,
        type: "sequential",
        dependsOn,
        metadata: tasks[i].metadata,
      });

      stepIds.push(stepId);
    }

    this.lastStepIds = stepIds.length > 0 ? [stepIds[stepIds.length - 1]] : [];
    return this;
  }

  /**
   * Add parallel tasks that fan out simultaneously.
   * All depend on the previous step(s) completing, and
   * subsequent steps will depend on all parallel tasks.
   */
  parallel(tasks: AgentTask[]): this {
    const groupId = "parallel-" + this.stepCounter;
    const stepIds: string[] = [];

    for (const task of tasks) {
      const stepId = this.nextStepId();
      const dependsOn =
        this.lastStepIds.length > 0 ? [...this.lastStepIds] : undefined;

      this.steps.push({
        id: stepId,
        agent: task.agent,
        task: task.task,
        type: "parallel",
        group: groupId,
        dependsOn,
        metadata: task.metadata,
      });

      stepIds.push(stepId);
    }

    this.parallelGroups.set(groupId, stepIds);
    this.lastStepIds = stepIds;
    return this;
  }

  /**
   * Add a handoff chain where each agent transfers control to the next.
   * Unlike sequential, handoff carries conversation state forward.
   */
  handoff(tasks: AgentTask[]): this {
    const stepIds: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const stepId = this.nextStepId();
      const dependsOn =
        i === 0
          ? this.lastStepIds.length > 0
            ? [...this.lastStepIds]
            : undefined
          : [stepIds[i - 1]];

      this.steps.push({
        id: stepId,
        agent: tasks[i].agent,
        task: tasks[i].task,
        type: "handoff",
        dependsOn,
        metadata: { ...tasks[i].metadata, preserveHistory: true },
      });

      stepIds.push(stepId);
    }

    this.lastStepIds = stepIds.length > 0 ? [stepIds[stepIds.length - 1]] : [];
    return this;
  }

  /**
   * Add a conditional branch.
   * The router function receives accumulated context and returns
   * the agent ID that should handle the next step.
   */
  conditional(
    router: (context: Record<string, unknown>) => string,
    branches: AgentTask[],
  ): this {
    const stepIds: string[] = [];

    for (const branch of branches) {
      const stepId = this.nextStepId();
      const dependsOn =
        this.lastStepIds.length > 0 ? [...this.lastStepIds] : undefined;

      this.steps.push({
        id: stepId,
        agent: branch.agent,
        task: branch.task,
        type: "conditional",
        dependsOn,
        condition: router,
        metadata: branch.metadata,
      });

      stepIds.push(stepId);
    }

    this.lastStepIds = stepIds;
    return this;
  }

  /**
   * Add an aggregation step that collects results from previous
   * parallel or conditional steps and produces a unified output.
   */
  aggregate(
    agent: string,
    task: string,
    metadata?: Record<string, unknown>,
  ): this {
    const stepId = this.nextStepId();
    const dependsOn =
      this.lastStepIds.length > 0 ? [...this.lastStepIds] : undefined;

    this.steps.push({
      id: stepId,
      agent,
      task,
      type: "aggregate",
      dependsOn,
      metadata,
    });

    this.lastStepIds = [stepId];
    return this;
  }

  /**
   * Compile the workflow into an executable structure.
   * Validates the graph and identifies entry/exit steps.
   */
  build(): CompiledWorkflow {
    if (this.steps.length === 0) {
      throw new Error("Cannot build empty workflow");
    }

    // Find entry steps (no dependencies)
    const entrySteps = this.steps
      .filter((s) => !s.dependsOn || s.dependsOn.length === 0)
      .map((s) => s.id);

    // Find exit steps (no other step depends on them)
    const allDeps = new Set(this.steps.flatMap((s) => s.dependsOn ?? []));
    const exitSteps = this.steps
      .filter((s) => !allDeps.has(s.id))
      .map((s) => s.id);

    // Validate all dependencies reference existing steps
    const stepIds = new Set(this.steps.map((s) => s.id));
    for (const step of this.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            throw new Error(
              "Step " + step.id + " depends on non-existent step " + dep,
            );
          }
        }
      }
    }

    // Check for cycles using topological sort attempt
    this.detectCycles();

    return {
      id: "wf-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      name: this.name,
      steps: [...this.steps],
      parallelGroups: new Map(this.parallelGroups),
      entrySteps,
      exitSteps,
    };
  }

  /** Get a summary of the workflow structure */
  describe(): string {
    const lines: string[] = ["Workflow: " + this.name, ""];

    for (const step of this.steps) {
      const deps = step.dependsOn
        ? " (after: " + step.dependsOn.join(", ") + ")"
        : "";
      const group = step.group ? " [" + step.group + "]" : "";
      lines.push(
        "  " +
          step.id +
          " [" +
          step.type +
          "] " +
          step.agent +
          ": " +
          step.task +
          deps +
          group,
      );
    }

    return lines.join("\n");
  }

  // -- Private helpers ------------------------------------------

  private nextStepId(): string {
    return "step-" + this.stepCounter++;
  }

  private detectCycles(): void {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const step of this.steps) {
      if (!inDegree.has(step.id)) inDegree.set(step.id, 0);
      if (!adjacency.has(step.id)) adjacency.set(step.id, []);

      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!adjacency.has(dep)) adjacency.set(dep, []);
          adjacency.get(dep)!.push(step.id);
          inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue = [...inDegree.entries()]
      .filter(([, d]) => d === 0)
      .map(([id]) => id);
    let processed = 0;

    while (queue.length > 0) {
      const node = queue.shift()!;
      processed++;
      for (const neighbor of adjacency.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (processed !== this.steps.length) {
      throw new Error("Workflow contains circular dependencies");
    }
  }
}

// -----------------------------------------------------------------
// Convenience factory functions
// -----------------------------------------------------------------

/** Create a simple sequential workflow from agent-task pairs */
export function sequentialWorkflow(
  name: string,
  tasks: AgentTask[],
): CompiledWorkflow {
  return new WorkflowBuilder(name).sequential(tasks).build();
}

/** Create a parallel fan-out with aggregation */
export function parallelWithAggregation(
  name: string,
  parallelTasks: AgentTask[],
  aggregator: AgentTask,
): CompiledWorkflow {
  return new WorkflowBuilder(name)
    .parallel(parallelTasks)
    .aggregate(aggregator.agent, aggregator.task, aggregator.metadata)
    .build();
}
