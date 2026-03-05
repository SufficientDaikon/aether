// -----------------------------------------------------------------
// AETHER Reaction Engine
//
// A rule-based engine that watches MemoryHighway events and triggers
// workflows or tasks automatically. Rules define channel/condition
// triggers and actions. Cooldown prevents reaction storms.
// -----------------------------------------------------------------

import type { ReactionRule } from "./types.ts";
import type {
  HighwayMessage,
  MessageHandler,
  MemoryHighway,
} from "./memory-highway.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/** Runtime state for a reaction rule */
interface RuleState {
  rule: ReactionRule;
  lastFiredAt: number;
  fireCount: number;
  /** Parsed condition function (compiled from rule.trigger.condition string) */
  conditionFn: ((msg: HighwayMessage) => boolean) | null;
}

/** Result of a reaction firing */
export interface ReactionResult {
  ruleId: string;
  fired: boolean;
  action: ReactionRule["action"]["type"];
  target?: string;
  skippedReason?: string;
}

/** Callback for executing reaction actions */
export type ReactionActionHandler = (
  rule: ReactionRule,
  triggerMessage: HighwayMessage,
) => Promise<void>;

// -----------------------------------------------------------------
// Reaction Engine
// -----------------------------------------------------------------

export class ReactionEngine {
  private highway: MemoryHighway;
  private rules: Map<string, RuleState> = new Map();
  private unsubscribe: (() => void) | null = null;
  private actionHandler: ReactionActionHandler | null = null;
  private running = false;
  private reactionLog: ReactionResult[] = [];
  private maxLogSize = 100;

  constructor(highway: MemoryHighway) {
    this.highway = highway;
  }

  /**
   * Set the action handler that executes tasks/workflows
   * when a reaction fires.
   */
  setActionHandler(handler: ReactionActionHandler): void {
    this.actionHandler = handler;
  }

  /**
   * Add a reaction rule.
   */
  addRule(rule: ReactionRule): void {
    // Compile condition string into a function if present
    let conditionFn: ((msg: HighwayMessage) => boolean) | null = null;
    if (rule.trigger.condition) {
      conditionFn = this.compileCondition(rule.trigger.condition);
    }

    this.rules.set(rule.id, {
      rule,
      lastFiredAt: 0,
      fireCount: 0,
      conditionFn,
    });
  }

  /**
   * Remove a reaction rule by ID.
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Enable or disable a rule.
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const state = this.rules.get(ruleId);
    if (state) {
      state.rule.enabled = enabled;
    }
  }

  /**
   * Get all registered rules.
   */
  getRules(): ReactionRule[] {
    return [...this.rules.values()].map((s) => s.rule);
  }

  /**
   * Start the reaction engine.
   * Subscribes to MemoryHighway wildcard channel to receive all events.
   */
  start(): void {
    if (this.running) return;

    const handler: MessageHandler = async (message: HighwayMessage) => {
      await this.processMessage(message);
    };

    this.unsubscribe = this.highway.subscribe("*", handler);
    this.running = true;
  }

  /**
   * Stop the reaction engine.
   * Unsubscribes from MemoryHighway.
   */
  stop(): void {
    if (!this.running) return;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.running = false;
  }

  /** Check if the engine is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get the reaction log (recent fired/skipped reactions) */
  getLog(): ReactionResult[] {
    return [...this.reactionLog];
  }

  /** Clear the reaction log */
  clearLog(): void {
    this.reactionLog = [];
  }

  /** Reset fire counts and cooldowns for all rules */
  resetCounters(): void {
    for (const state of this.rules.values()) {
      state.lastFiredAt = 0;
      state.fireCount = 0;
    }
  }

  // -- Private --------------------------------------------------

  /**
   * Process an incoming message against all rules.
   */
  private async processMessage(message: HighwayMessage): Promise<void> {
    for (const [ruleId, state] of this.rules) {
      if (!state.rule.enabled) continue;

      // Check channel match
      if (!this.channelMatches(state.rule.trigger.channel, message.channel)) {
        continue;
      }

      // Check message type match
      if (
        state.rule.trigger.messageType &&
        state.rule.trigger.messageType !== message.type
      ) {
        continue;
      }

      // Check condition
      if (state.conditionFn && !state.conditionFn(message)) {
        continue;
      }

      // Check cooldown
      const now = Date.now();
      if (state.rule.cooldownMs > 0 && state.lastFiredAt > 0) {
        const elapsed = now - state.lastFiredAt;
        if (elapsed < state.rule.cooldownMs) {
          this.logReaction({
            ruleId,
            fired: false,
            action: state.rule.action.type,
            target: state.rule.action.target,
            skippedReason:
              "Cooldown: " +
              Math.round((state.rule.cooldownMs - elapsed) / 1000) +
              "s remaining",
          });
          continue;
        }
      }

      // Check max fires
      if (state.rule.maxFires > 0 && state.fireCount >= state.rule.maxFires) {
        this.logReaction({
          ruleId,
          fired: false,
          action: state.rule.action.type,
          target: state.rule.action.target,
          skippedReason:
            "Max fires reached: " + state.fireCount + "/" + state.rule.maxFires,
        });
        continue;
      }

      // Fire the rule
      state.lastFiredAt = now;
      state.fireCount++;

      this.logReaction({
        ruleId,
        fired: true,
        action: state.rule.action.type,
        target: state.rule.action.target,
      });

      // Execute the action
      if (this.actionHandler) {
        try {
          await this.actionHandler(state.rule, message);
        } catch {
          // Swallow reaction handler errors to not crash the engine
        }
      }
    }
  }

  /**
   * Check if a rule's channel pattern matches a message channel.
   * Supports exact match and wildcard ("*") prefix matching.
   */
  private channelMatches(pattern: string, channel: string): boolean {
    if (pattern === "*") return true;
    if (pattern === channel) return true;

    // Support prefix wildcards: "tasks.*" matches "tasks.completed"
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return channel.startsWith(prefix);
    }

    return false;
  }

  /**
   * Compile a condition string into a function.
   * Supports simple expressions like:
   *   - "type:result" — match message type
   *   - "payload.status:failed" — match nested payload field
   *   - "sender:agent-123" — match sender
   */
  private compileCondition(
    condition: string,
  ): (msg: HighwayMessage) => boolean {
    // Parse "field:value" pairs
    const parts = condition.split(",").map((s) => s.trim());
    const checks: Array<{ path: string; value: string }> = [];

    for (const part of parts) {
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) continue;
      checks.push({
        path: part.slice(0, colonIdx).trim(),
        value: part.slice(colonIdx + 1).trim(),
      });
    }

    return (msg: HighwayMessage): boolean => {
      for (const check of checks) {
        const actual = this.getNestedValue(msg, check.path);
        if (String(actual) !== check.value) return false;
      }
      return true;
    };
  }

  /**
   * Get a nested value from an object using dot notation.
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private logReaction(result: ReactionResult): void {
    this.reactionLog.push(result);
    if (this.reactionLog.length > this.maxLogSize) {
      this.reactionLog = this.reactionLog.slice(-this.maxLogSize);
    }
  }
}

// -----------------------------------------------------------------
// Factory: Common reaction rules
// -----------------------------------------------------------------

/** Create a rule that fires when a task fails N times */
export function taskFailureRule(
  id: string,
  failureThreshold: number = 3,
  targetAgent?: string,
): ReactionRule {
  return {
    id,
    trigger: {
      channel: "results",
      messageType: "result",
      condition: "payload.status:failed",
    },
    action: {
      type: "execute_task",
      target: targetAgent,
      taskTemplate: "Investigate and fix the recurring failure",
    },
    cooldownMs: 30_000,
    maxFires: failureThreshold,
    enabled: true,
  };
}

/** Create a rule that fires when a review completes to auto-run tests */
export function postReviewTestRule(id: string): ReactionRule {
  return {
    id,
    trigger: {
      channel: "results",
      messageType: "result",
      condition: "payload.taskType:review",
    },
    action: {
      type: "execute_task",
      taskTemplate: "Run the test suite and report results",
    },
    cooldownMs: 60_000,
    maxFires: 0, // unlimited
    enabled: true,
  };
}
