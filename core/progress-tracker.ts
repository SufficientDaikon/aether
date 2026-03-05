// -----------------------------------------------------------------
// AETHER Progress Tracker
//
// Monitors long-running workflows for stalls, loops, and budget
// exhaustion. Provides warnings and abort recommendations.
// -----------------------------------------------------------------

import type {
  ProgressConfig,
  ProgressEvent,
  StallWarning,
  LoopWarning,
  BudgetEstimate,
} from "./types.ts";
import type { AetherStore } from "./storage/store.ts";

// -----------------------------------------------------------------
// Defaults
// -----------------------------------------------------------------

const DEFAULT_CONFIG: ProgressConfig = {
  maxTokenBudget: 500_000,
  maxWallClockMs: 10 * 60 * 1000, // 10 minutes
  stallThresholdMs: 60_000, // 1 minute
  loopSimilarityThreshold: 0.9,
  maxConsecutiveSimilar: 3,
};

// -----------------------------------------------------------------
// Progress Tracker
// -----------------------------------------------------------------

export class ProgressTracker {
  private store: AetherStore;
  private config: ProgressConfig;
  private workflowStartTimes: Map<string, number> = new Map();

  constructor(store: AetherStore, config?: Partial<ProgressConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a progress event for a workflow step.
   */
  trackExecution(
    workflowId: string,
    stepIndex: number,
    agentId: string,
    output: string,
    tokensUsed: number,
    durationMs: number,
  ): void {
    // Track start time
    if (!this.workflowStartTimes.has(workflowId)) {
      this.workflowStartTimes.set(workflowId, Date.now());
    }

    const event: ProgressEvent = {
      id: "prog-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      workflowId,
      stepIndex,
      agentId,
      outputHash: this.simpleHash(output),
      tokensUsed,
      duration: durationMs,
      createdAt: new Date().toISOString(),
    };

    this.store.saveProgressEvent(event);
  }

  /**
   * Detect if a workflow has stalled.
   * Returns a warning if the time since the last event exceeds threshold.
   */
  detectStall(workflowId: string): StallWarning | null {
    const latest = this.store.getLatestProgressEvent(workflowId);
    if (!latest) return null;

    const events = this.store.getProgressEvents(workflowId);
    if (events.length < 2) return null;

    // Calculate average step duration
    const durations = events.map((e) => e.duration).filter((d) => d > 0);
    if (durations.length === 0) return null;

    const avgDuration =
      durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const expectedMs = avgDuration * 2; // 2x average is the threshold

    const timeSinceLastEvent =
      Date.now() - new Date(latest.createdAt).getTime();

    if (
      timeSinceLastEvent > Math.max(expectedMs, this.config.stallThresholdMs)
    ) {
      return {
        workflowId,
        stepIndex: latest.stepIndex,
        elapsedMs: timeSinceLastEvent,
        expectedMs,
        message:
          "Workflow stalled: no progress for " +
          Math.round(timeSinceLastEvent / 1000) +
          "s (expected ~" +
          Math.round(expectedMs / 1000) +
          "s per step)",
      };
    }

    return null;
  }

  /**
   * Detect if a workflow is looping.
   * Checks for consecutive similar outputs from the same agent.
   */
  detectLoop(workflowId: string): LoopWarning | null {
    const events = this.store.getProgressEvents(workflowId);
    if (events.length < this.config.maxConsecutiveSimilar) return null;

    // Check last N events for same agent with same output hash
    const recent = events.slice(-this.config.maxConsecutiveSimilar - 1);

    // Group consecutive events by agent
    let consecutiveCount = 1;
    let lastAgent = "";
    let lastHash = "";

    for (let i = recent.length - 1; i >= 0; i--) {
      const event = recent[i];
      if (i === recent.length - 1) {
        lastAgent = event.agentId;
        lastHash = event.outputHash ?? "";
        continue;
      }

      if (
        event.agentId === lastAgent &&
        event.outputHash === lastHash &&
        lastHash !== ""
      ) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount >= this.config.maxConsecutiveSimilar) {
      return {
        workflowId,
        agentId: lastAgent,
        similarity: 1.0, // Hash match = identical
        consecutiveCount,
        message:
          "Loop detected: agent " +
          lastAgent +
          " produced identical output " +
          consecutiveCount +
          " times consecutively",
      };
    }

    // Also check for near-identical outputs using character-level similarity
    if (recent.length >= 2) {
      const lastEvents = recent.filter(
        (e) => e.agentId === recent[recent.length - 1].agentId,
      );
      if (lastEvents.length >= this.config.maxConsecutiveSimilar) {
        // If same agent keeps being selected and producing output,
        // check hash diversity
        const hashes = new Set(lastEvents.map((e) => e.outputHash));
        if (
          hashes.size === 1 &&
          lastEvents.length >= this.config.maxConsecutiveSimilar
        ) {
          return {
            workflowId,
            agentId: lastEvents[0].agentId,
            similarity: 1.0,
            consecutiveCount: lastEvents.length,
            message:
              "Loop detected: agent " +
              lastEvents[0].agentId +
              " produced identical output across " +
              lastEvents.length +
              " steps",
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if a workflow should be aborted.
   * Considers budget, stalls, and loops.
   */
  shouldAbort(workflowId: string): { abort: boolean; reason: string } {
    // Check token budget
    const events = this.store.getProgressEvents(workflowId);
    const totalTokens = events.reduce((sum, e) => sum + e.tokensUsed, 0);
    if (totalTokens > this.config.maxTokenBudget) {
      return {
        abort: true,
        reason:
          "Token budget exceeded: " +
          totalTokens +
          " / " +
          this.config.maxTokenBudget,
      };
    }

    // Check wall-clock time
    const startTime = this.workflowStartTimes.get(workflowId);
    if (startTime) {
      const elapsed = Date.now() - startTime;
      if (elapsed > this.config.maxWallClockMs) {
        return {
          abort: true,
          reason:
            "Wall-clock time exceeded: " +
            Math.round(elapsed / 1000) +
            "s / " +
            Math.round(this.config.maxWallClockMs / 1000) +
            "s",
        };
      }
    }

    // Check for loops
    const loopWarning = this.detectLoop(workflowId);
    if (loopWarning) {
      return { abort: true, reason: loopWarning.message };
    }

    return { abort: false, reason: "" };
  }

  /**
   * Estimate the budget needed for a workflow.
   */
  estimateBudget(
    stepCount: number,
    avgTokensPerStep: number = 4000,
    avgTimePerStepMs: number = 10000,
  ): BudgetEstimate {
    const estimatedTokens = stepCount * avgTokensPerStep;
    const estimatedTimeMs = stepCount * avgTimePerStepMs;
    const warnings: string[] = [];

    if (estimatedTokens > this.config.maxTokenBudget * 0.8) {
      warnings.push(
        "Estimated token usage (" +
          estimatedTokens +
          ") is close to budget (" +
          this.config.maxTokenBudget +
          ")",
      );
    }

    if (estimatedTimeMs > this.config.maxWallClockMs * 0.8) {
      warnings.push(
        "Estimated time (" +
          Math.round(estimatedTimeMs / 1000) +
          "s) is close to limit (" +
          Math.round(this.config.maxWallClockMs / 1000) +
          "s)",
      );
    }

    return {
      estimatedTokens,
      estimatedTimeMs,
      withinBudget:
        estimatedTokens <= this.config.maxTokenBudget &&
        estimatedTimeMs <= this.config.maxWallClockMs,
      warnings,
    };
  }

  /**
   * Get a summary of workflow progress.
   */
  getSummary(workflowId: string): {
    totalSteps: number;
    totalTokens: number;
    totalDurationMs: number;
    averageDurationMs: number;
    uniqueAgents: number;
    stallWarning: StallWarning | null;
    loopWarning: LoopWarning | null;
  } {
    const events = this.store.getProgressEvents(workflowId);
    const totalTokens = events.reduce((sum, e) => sum + e.tokensUsed, 0);
    const totalDurationMs = events.reduce((sum, e) => sum + e.duration, 0);
    const uniqueAgents = new Set(events.map((e) => e.agentId)).size;

    return {
      totalSteps: events.length,
      totalTokens,
      totalDurationMs,
      averageDurationMs:
        events.length > 0 ? totalDurationMs / events.length : 0,
      uniqueAgents,
      stallWarning: this.detectStall(workflowId),
      loopWarning: this.detectLoop(workflowId),
    };
  }

  /** Clear tracking data for a completed workflow */
  cleanup(workflowId: string): void {
    this.workflowStartTimes.delete(workflowId);
    this.store.deleteProgressEvents(workflowId);
  }

  // -- Private helpers ------------------------------------------

  /**
   * Simple string hash for output comparison.
   * Not cryptographic — just for quick equality checks.
   */
  private simpleHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      hash = ((hash << 5) - hash + ch) | 0;
    }
    return "h" + (hash >>> 0).toString(36);
  }
}
