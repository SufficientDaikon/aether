// -----------------------------------------------------------------
// AETHER Durable Workflow Engine
//
// Long-running workflows checkpoint state to SQLite after each step.
// On crash/restart, they resume from the last checkpoint.
// Supports human-in-the-loop pauses and abort.
// -----------------------------------------------------------------

import type { WorkflowCheckpoint, DurableWorkflowStatus } from "./types.ts";
import type { AetherStore } from "./storage/store.ts";
import type { CompiledWorkflow, WorkflowStep } from "./workflow-builder.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/** Step executor callback provided by the runtime */
export type StepExecutor = (
  step: WorkflowStep,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Options for durable workflow execution */
export interface DurableWorkflowOptions {
  /** Conversation ID to associate with this workflow */
  conversationId?: string;
  /** Steps that require human approval before proceeding */
  approvalRequired?: Set<string>;
  /** Callback invoked when a step requires approval */
  onApprovalNeeded?: (
    stepId: string,
    context: Record<string, unknown>,
  ) => Promise<boolean>;
  /** Callback invoked after each step completes */
  onStepComplete?: (stepId: string, result: Record<string, unknown>) => void;
}

/** Result of a durable workflow execution */
export interface DurableWorkflowResult {
  workflowId: string;
  status: DurableWorkflowStatus;
  completedSteps: number;
  totalSteps: number;
  finalState: Record<string, unknown>;
  pausedAtStep?: string;
  abortReason?: string;
}

// -----------------------------------------------------------------
// Durable Workflow
// -----------------------------------------------------------------

export class DurableWorkflow {
  private store: AetherStore;
  private workflow: CompiledWorkflow;
  private stepExecutor: StepExecutor;
  private options: DurableWorkflowOptions;
  private status: DurableWorkflowStatus = "running";
  private abortReason?: string;

  constructor(
    store: AetherStore,
    workflow: CompiledWorkflow,
    stepExecutor: StepExecutor,
    options?: DurableWorkflowOptions,
  ) {
    this.store = store;
    this.workflow = workflow;
    this.stepExecutor = stepExecutor;
    this.options = options ?? {};
  }

  /**
   * Execute the workflow from the beginning.
   * Checkpoints state after each step.
   */
  async run(
    initialState: Record<string, unknown> = {},
  ): Promise<DurableWorkflowResult> {
    return this.executeFrom(0, initialState);
  }

  /**
   * Resume a workflow from a checkpoint.
   * Loads the checkpoint and continues from the next step.
   */
  async resume(workflowId?: string): Promise<DurableWorkflowResult> {
    const wfId = workflowId ?? this.workflow.id;
    const checkpoint = this.store.getLatestCheckpoint(wfId);

    if (!checkpoint) {
      throw new Error("No checkpoint found for workflow: " + wfId);
    }

    const nextStep = checkpoint.stepIndex + 1;
    return this.executeFrom(nextStep, checkpoint.state);
  }

  /**
   * Pause the workflow. The current step completes but
   * no further steps are executed.
   */
  pause(): void {
    this.status = "paused";
  }

  /**
   * Abort the workflow with a reason.
   */
  abort(reason: string): void {
    this.status = "aborted";
    this.abortReason = reason;
  }

  /** Get the current workflow status */
  getStatus(): DurableWorkflowStatus {
    return this.status;
  }

  /**
   * Get all checkpoints for this workflow.
   */
  getCheckpoints(): WorkflowCheckpoint[] {
    return this.store.getCheckpoints(this.workflow.id);
  }

  /**
   * Clean up checkpoints for a completed workflow.
   */
  cleanup(): void {
    this.store.deleteCheckpoints(this.workflow.id);
  }

  /**
   * Find all incomplete workflows in the store.
   * Used on startup to discover workflows that need resuming.
   */
  static findIncomplete(store: AetherStore): string[] {
    return store.getIncompleteWorkflowIds();
  }

  // -- Private --------------------------------------------------

  private async executeFrom(
    startIndex: number,
    initialState: Record<string, unknown>,
  ): Promise<DurableWorkflowResult> {
    this.status = "running";
    let state = { ...initialState };

    // Topologically sort steps respecting dependencies
    const ordered = this.topologicalSort();
    const completedStepIds = new Set<string>();

    // Mark steps before startIndex as already completed
    for (let i = 0; i < startIndex && i < ordered.length; i++) {
      completedStepIds.add(ordered[i].id);
    }

    for (let i = startIndex; i < ordered.length; i++) {
      // Check for pause or abort
      if (this.status === "paused") {
        return {
          workflowId: this.workflow.id,
          status: "paused",
          completedSteps: i,
          totalSteps: ordered.length,
          finalState: state,
          pausedAtStep: ordered[i].id,
        };
      }

      if (this.status === "aborted") {
        return {
          workflowId: this.workflow.id,
          status: "aborted",
          completedSteps: i,
          totalSteps: ordered.length,
          finalState: state,
          abortReason: this.abortReason,
        };
      }

      const step = ordered[i];

      // Check if dependencies are satisfied
      if (step.dependsOn) {
        const unmet = step.dependsOn.filter((d) => !completedStepIds.has(d));
        if (unmet.length > 0) {
          // Skip this step — dependencies not met (shouldn't happen with topo sort)
          continue;
        }
      }

      // Check if approval is required
      if (
        this.options.approvalRequired?.has(step.id) &&
        this.options.onApprovalNeeded
      ) {
        const approved = await this.options.onApprovalNeeded(step.id, state);
        if (!approved) {
          this.status = "paused";
          // Checkpoint before the approval-needed step
          this.saveCheckpoint(i - 1, state);
          return {
            workflowId: this.workflow.id,
            status: "paused",
            completedSteps: i,
            totalSteps: ordered.length,
            finalState: state,
            pausedAtStep: step.id,
          };
        }
      }

      // Execute the step
      try {
        const result = await this.stepExecutor(step, state);
        state = { ...state, ...result, ["__step_" + step.id]: result };
        completedStepIds.add(step.id);

        // Checkpoint after successful step
        this.saveCheckpoint(i, state);

        // Notify callback
        this.options.onStepComplete?.(step.id, result);
      } catch (err) {
        // Checkpoint the failure state
        this.saveCheckpoint(i - 1, {
          ...state,
          __failedStep: step.id,
          __error: err instanceof Error ? err.message : String(err),
        });

        this.status = "failed";
        return {
          workflowId: this.workflow.id,
          status: "failed",
          completedSteps: i,
          totalSteps: ordered.length,
          finalState: state,
          abortReason:
            "Step " +
            step.id +
            " failed: " +
            (err instanceof Error ? err.message : String(err)),
        };
      }
    }

    // All steps completed
    this.status = "completed";

    // Clean up checkpoints on success (optional — caller can call cleanup())
    return {
      workflowId: this.workflow.id,
      status: "completed",
      completedSteps: ordered.length,
      totalSteps: ordered.length,
      finalState: state,
    };
  }

  private saveCheckpoint(
    stepIndex: number,
    state: Record<string, unknown>,
  ): void {
    this.store.saveCheckpoint({
      id: "chk-" + this.workflow.id + "-" + stepIndex + "-" + Date.now(),
      workflowId: this.workflow.id,
      stepIndex,
      state,
      conversationId: this.options.conversationId,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Topological sort of workflow steps respecting dependencies.
   * Uses Kahn's algorithm.
   */
  private topologicalSort(): WorkflowStep[] {
    const steps = this.workflow.steps;
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const stepMap = new Map<string, WorkflowStep>();

    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      if (!adjacency.has(step.id)) adjacency.set(step.id, []);
    }

    for (const step of steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!adjacency.has(dep)) adjacency.set(dep, []);
          adjacency.get(dep)!.push(step.id);
          inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
        }
      }
    }

    const queue = [...inDegree.entries()]
      .filter(([, d]) => d === 0)
      .map(([id]) => id);
    const sorted: WorkflowStep[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const step = stepMap.get(nodeId);
      if (step) sorted.push(step);

      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }
}
