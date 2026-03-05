// -----------------------------------------------------------------
// AETHER Preflight Checker
//
// Pre-execution verification for complex workflows. Validates that
// all referenced agents exist and are healthy, required capabilities
// are available, budget is sufficient, and no circular dependencies
// exist.
// -----------------------------------------------------------------

import type {
  AgentDefinition,
  PreflightResult,
  BudgetEstimate,
  AgentStatus,
} from "./types.ts";
import type { CompiledWorkflow, WorkflowStep } from "./workflow-builder.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface PreflightOptions {
  /** Check if target files exist (for code-generation tasks) */
  checkFiles?: boolean;
  /** Average tokens per workflow step for budget estimation */
  avgTokensPerStep?: number;
  /** Average time per workflow step in ms */
  avgTimePerStepMs?: number;
  /** Token budget limit */
  tokenBudget?: number;
  /** Wall-clock time limit in ms */
  timeBudgetMs?: number;
}

// -----------------------------------------------------------------
// Preflight Checker
// -----------------------------------------------------------------

export class PreflightChecker {
  private defaultOptions: Required<PreflightOptions> = {
    checkFiles: false,
    avgTokensPerStep: 4000,
    avgTimePerStepMs: 10000,
    tokenBudget: 500_000,
    timeBudgetMs: 10 * 60 * 1000,
  };

  /**
   * Run preflight checks on a compiled workflow.
   * resolveAgent is a callback to look up agent definitions.
   */
  check(
    workflow: CompiledWorkflow,
    resolveAgent: (id: string) => AgentDefinition | null,
    options?: PreflightOptions,
  ): PreflightResult {
    const opts = { ...this.defaultOptions, ...options };
    const warnings: string[] = [];
    const errors: string[] = [];
    const agentHealth: Record<string, "healthy" | "degraded" | "offline"> = {};

    // 1. Check all referenced agents exist and are healthy
    const agentIds = new Set(workflow.steps.map((s) => s.agent));
    for (const agentId of agentIds) {
      const agent = resolveAgent(agentId);
      if (!agent) {
        errors.push("Agent not found: " + agentId);
        agentHealth[agentId] = "offline";
        continue;
      }

      const health = this.checkAgentHealth(agent);
      agentHealth[agentId] = health;

      if (health === "offline") {
        errors.push("Agent is offline: " + agentId);
      } else if (health === "degraded") {
        warnings.push(
          "Agent is degraded: " + agentId + " (status: " + agent.status + ")",
        );
      }
    }

    // 2. Check capability coverage
    const capabilityWarnings = this.checkCapabilities(workflow, resolveAgent);
    warnings.push(...capabilityWarnings);

    // 3. Check for dependency issues
    const depErrors = this.checkDependencies(workflow);
    errors.push(...depErrors);

    // 4. Estimate budget
    const budget = this.estimateBudget(workflow.steps.length, opts);
    if (!budget.withinBudget) {
      warnings.push(...budget.warnings);
    }

    // 5. Check for empty workflow
    if (workflow.steps.length === 0) {
      errors.push("Workflow has no steps");
    }

    // 6. Check entry/exit points
    if (workflow.entrySteps.length === 0) {
      errors.push("Workflow has no entry steps (all steps have dependencies)");
    }
    if (workflow.exitSteps.length === 0) {
      warnings.push("Workflow has no clear exit steps");
    }

    return {
      passed: errors.length === 0,
      warnings,
      errors,
      budget,
      agentHealth,
    };
  }

  /**
   * Quick check for a single agent's health.
   */
  checkAgentHealth(agent: AgentDefinition): "healthy" | "degraded" | "offline" {
    switch (agent.status) {
      case "idle":
      case "active":
        return "healthy";
      case "busy":
        return "degraded";
      case "error":
        return "degraded";
      case "offline":
        return "offline";
      default:
        return "healthy";
    }
  }

  /**
   * Check if all required capabilities are covered by the workflow agents.
   */
  checkCapabilities(
    workflow: CompiledWorkflow,
    resolveAgent: (id: string) => AgentDefinition | null,
  ): string[] {
    const warnings: string[] = [];

    for (const step of workflow.steps) {
      const agent = resolveAgent(step.agent);
      if (!agent) continue;

      // Check if agent has dependencies that aren't satisfied by other agents
      if (agent.dependencies.length > 0) {
        const otherAgents = workflow.steps
          .filter((s) => s.agent !== step.agent)
          .map((s) => resolveAgent(s.agent))
          .filter((a): a is AgentDefinition => a !== null);

        const allCaps = new Set(otherAgents.flatMap((a) => a.capabilities));

        for (const dep of agent.dependencies) {
          const hasCap = [...allCaps].some(
            (cap) =>
              cap.toLowerCase().includes(dep.toLowerCase()) ||
              dep.toLowerCase().includes(cap.toLowerCase()),
          );
          if (!hasCap) {
            warnings.push(
              "Agent " +
                step.agent +
                " depends on capability '" +
                dep +
                "' which may not be available in this workflow",
            );
          }
        }
      }
    }

    return warnings;
  }

  /**
   * Check for dependency issues in the workflow.
   */
  checkDependencies(workflow: CompiledWorkflow): string[] {
    const errors: string[] = [];
    const stepIds = new Set(workflow.steps.map((s) => s.id));

    for (const step of workflow.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            errors.push("Step " + step.id + " depends on missing step " + dep);
          }
        }

        // Check self-dependency
        if (step.dependsOn.includes(step.id)) {
          errors.push("Step " + step.id + " depends on itself");
        }
      }
    }

    return errors;
  }

  /**
   * Estimate the budget needed for a workflow.
   */
  estimateBudget(
    stepCount: number,
    opts: Required<PreflightOptions>,
  ): BudgetEstimate {
    const estimatedTokens = stepCount * opts.avgTokensPerStep;
    const estimatedTimeMs = stepCount * opts.avgTimePerStepMs;
    const warnings: string[] = [];

    if (estimatedTokens > opts.tokenBudget) {
      warnings.push(
        "Estimated tokens (" +
          estimatedTokens +
          ") exceeds budget (" +
          opts.tokenBudget +
          ")",
      );
    } else if (estimatedTokens > opts.tokenBudget * 0.8) {
      warnings.push(
        "Estimated tokens (" +
          estimatedTokens +
          ") is close to budget (" +
          opts.tokenBudget +
          ")",
      );
    }

    if (estimatedTimeMs > opts.timeBudgetMs) {
      warnings.push(
        "Estimated time (" +
          Math.round(estimatedTimeMs / 1000) +
          "s) exceeds limit (" +
          Math.round(opts.timeBudgetMs / 1000) +
          "s)",
      );
    } else if (estimatedTimeMs > opts.timeBudgetMs * 0.8) {
      warnings.push(
        "Estimated time (" +
          Math.round(estimatedTimeMs / 1000) +
          "s) is close to limit (" +
          Math.round(opts.timeBudgetMs / 1000) +
          "s)",
      );
    }

    return {
      estimatedTokens,
      estimatedTimeMs,
      withinBudget:
        estimatedTokens <= opts.tokenBudget &&
        estimatedTimeMs <= opts.timeBudgetMs,
      warnings,
    };
  }
}
