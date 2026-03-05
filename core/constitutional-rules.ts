// -----------------------------------------------------------------
// AETHER Constitutional Rules Engine
//
// Configurable rule engine that evaluates agent actions against
// safety invariants. Inspired by Constitutional AI principles.
// Rules can block, warn, log, or escalate based on pattern matching.
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface ConstitutionalRule {
  id: string;
  name: string;
  description: string;
  /** "all" applies to every tier, or an array of specific tier names */
  scope: "all" | string[];
  condition: {
    /** Match on action type (e.g., "shell_exec", "file_write", "git_commit") */
    actionType?: string;
    /** Regex pattern to match against action details */
    pattern?: string;
    /** Match only agents of this tier */
    agentTier?: string;
  };
  enforcement: "block" | "warn" | "log" | "escalate";
  message: string;
}

export interface RuleEvaluationResult {
  allowed: boolean;
  ruleId?: string;
  ruleName?: string;
  enforcement?: ConstitutionalRule["enforcement"];
  message?: string;
}

export interface ActionContext {
  agentId: string;
  agentTier: string;
  type: string; // action type
  details: Record<string, unknown>;
}

// -----------------------------------------------------------------
// Default Rules
// -----------------------------------------------------------------

export const DEFAULT_CONSTITUTIONAL_RULES: ConstitutionalRule[] = [
  {
    id: "no-destructive-db-ops",
    name: "Destructive DB Guard",
    description:
      "Block direct destructive database operations (DROP, TRUNCATE, DELETE FROM) from workers and managers",
    scope: ["worker", "manager"],
    condition: {
      actionType: "shell_exec",
      pattern: "\\b(DROP\\s+TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM)\\b",
    },
    enforcement: "block",
    message:
      "Destructive database operations require sentinel or master approval",
  },
  {
    id: "no-rm-rf-root",
    name: "Filesystem Safety Guard",
    description: "Block rm -rf / or equivalent dangerous filesystem operations",
    scope: "all",
    condition: {
      actionType: "shell_exec",
      pattern: "rm\\s+-rf\\s+/(?!\\w)",
    },
    enforcement: "block",
    message: "Destructive filesystem operation blocked for safety",
  },
  {
    id: "test-reminder-on-commit",
    name: "Test-First Reminder",
    description: "Warn when committing code without running tests",
    scope: "all",
    condition: {
      actionType: "git_commit",
    },
    enforcement: "warn",
    message: "Consider running tests before committing changes",
  },
  {
    id: "budget-guard",
    name: "Budget Limit Guard",
    description: "Log when new tasks are submitted (for budget tracking)",
    scope: "all",
    condition: {
      actionType: "task_submit",
    },
    enforcement: "log",
    message: "New task submitted — tracking budget impact",
  },
  {
    id: "no-secret-exposure",
    name: "Secret Exposure Guard",
    description: "Block actions that may expose API keys or passwords in logs",
    scope: "all",
    condition: {
      pattern:
        "(?:AKIA[0-9A-Z]{16}|password\\s*=\\s*[\"'][^\"']+[\"']|sk-[a-zA-Z0-9]{20,})",
    },
    enforcement: "block",
    message: "Action contains potential secrets or credentials — blocked",
  },
];

// -----------------------------------------------------------------
// Constitutional Rules Engine
// -----------------------------------------------------------------

export class ConstitutionalRulesEngine {
  private rules: Map<string, ConstitutionalRule> = new Map();

  constructor(rules?: ConstitutionalRule[]) {
    const initialRules = rules ?? DEFAULT_CONSTITUTIONAL_RULES;
    for (const rule of initialRules) {
      this.rules.set(rule.id, rule);
    }
  }

  // ── Rule Management ───────────────────────────────────────────

  addRule(rule: ConstitutionalRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  getRule(ruleId: string): ConstitutionalRule | undefined {
    return this.rules.get(ruleId);
  }

  getRules(): ConstitutionalRule[] {
    return [...this.rules.values()];
  }

  // ── Evaluation ────────────────────────────────────────────────

  /**
   * Evaluate an agent action against all constitutional rules.
   * Returns the first blocking/warning result, or an "allowed" result.
   */
  evaluate(action: ActionContext): RuleEvaluationResult {
    for (const rule of this.rules.values()) {
      // Check scope
      if (!this.matchesScope(rule, action.agentTier)) {
        continue;
      }

      // Check conditions
      if (!this.matchesCondition(rule, action)) {
        continue;
      }

      // Rule matched — apply enforcement
      switch (rule.enforcement) {
        case "block":
          return {
            allowed: false,
            ruleId: rule.id,
            ruleName: rule.name,
            enforcement: "block",
            message: rule.message,
          };

        case "warn":
          // Warnings are allowed but flagged
          return {
            allowed: true,
            ruleId: rule.id,
            ruleName: rule.name,
            enforcement: "warn",
            message: rule.message,
          };

        case "escalate":
          return {
            allowed: false,
            ruleId: rule.id,
            ruleName: rule.name,
            enforcement: "escalate",
            message: rule.message,
          };

        case "log":
          // Log-only rules don't block — continue checking other rules
          continue;
      }
    }

    return { allowed: true };
  }

  /**
   * Evaluate all rules and return ALL matches (not just the first).
   * Useful for audit and reporting.
   */
  evaluateAll(action: ActionContext): RuleEvaluationResult[] {
    const results: RuleEvaluationResult[] = [];

    for (const rule of this.rules.values()) {
      if (!this.matchesScope(rule, action.agentTier)) continue;
      if (!this.matchesCondition(rule, action)) continue;

      results.push({
        allowed:
          rule.enforcement !== "block" && rule.enforcement !== "escalate",
        ruleId: rule.id,
        ruleName: rule.name,
        enforcement: rule.enforcement,
        message: rule.message,
      });
    }

    return results;
  }

  // ── Private ───────────────────────────────────────────────────

  private matchesScope(rule: ConstitutionalRule, agentTier: string): boolean {
    if (rule.scope === "all") return true;
    return rule.scope.includes(agentTier);
  }

  private matchesCondition(
    rule: ConstitutionalRule,
    action: ActionContext,
  ): boolean {
    const cond = rule.condition;

    // Check action type
    if (cond.actionType && cond.actionType !== action.type) {
      return false;
    }

    // Check agent tier
    if (cond.agentTier && cond.agentTier !== action.agentTier) {
      return false;
    }

    // Check pattern (regex) against stringified action details
    if (cond.pattern) {
      const detailsStr = JSON.stringify(action.details);
      try {
        const regex = new RegExp(cond.pattern, "i");
        if (!regex.test(detailsStr)) {
          return false;
        }
      } catch {
        // Invalid regex — skip this condition
        return false;
      }
    }

    return true;
  }
}
