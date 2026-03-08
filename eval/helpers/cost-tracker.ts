// ─────────────────────────────────────────────────────────────
// AETHER Eval — Cost Tracker
// Budget tracking with dual-key switching for Gemini API
// ─────────────────────────────────────────────────────────────

// Gemini pricing per 1M tokens (approximate, 2025 rates)
const PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5.0 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
};

interface CallRecord {
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  keyUsed: "gemma" | "bun";
  latencyMs: number;
}

export interface CostTrackerConfig {
  gemmaKey: string;
  bunKey: string;
  budgetLimit: number;
  switchThreshold: number;
}

export class CostTracker {
  private config: CostTrackerConfig;
  private records: CallRecord[] = [];
  private totalCost = 0;
  private currentKey: "gemma" | "bun" = "gemma";

  constructor(config: CostTrackerConfig) {
    this.config = config;
  }

  /** Get the API key to use for the next call (auto-switches at threshold) */
  getActiveKey(): string {
    if (
      this.currentKey === "gemma" &&
      this.totalCost >= this.config.budgetLimit * this.config.switchThreshold
    ) {
      console.log(
        `[CostTracker] Budget threshold reached ($${this.totalCost.toFixed(2)}/$${this.config.budgetLimit}). Switching to free-tier key "bun".`,
      );
      this.currentKey = "bun";
    }
    return this.currentKey === "gemma"
      ? this.config.gemmaKey
      : this.config.bunKey;
  }

  getActiveKeyName(): "gemma" | "bun" {
    // Check without side effects
    if (
      this.currentKey === "gemma" &&
      this.totalCost >= this.config.budgetLimit * this.config.switchThreshold
    ) {
      this.currentKey = "bun";
    }
    return this.currentKey;
  }

  /** Record a completed API call */
  recordCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
  ): void {
    const pricing = PRICING[model] ?? PRICING["gemini-2.5-flash"];
    const cost =
      (inputTokens / 1_000_000) * pricing.inputPer1M +
      (outputTokens / 1_000_000) * pricing.outputPer1M;

    if (this.currentKey === "gemma") {
      this.totalCost += cost;
    }

    this.records.push({
      timestamp: Date.now(),
      model,
      inputTokens,
      outputTokens,
      estimatedCost: cost,
      keyUsed: this.currentKey,
      latencyMs,
    });
  }

  /** Force switch to a specific key */
  forceKey(key: "gemma" | "bun"): void {
    this.currentKey = key;
  }

  getSummary(): {
    totalCost: number;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    remainingBudget: number;
    activeKey: "gemma" | "bun";
    byModel: Record<string, { calls: number; cost: number; tokens: number }>;
  } {
    const byModel: Record<
      string,
      { calls: number; cost: number; tokens: number }
    > = {};
    let totalInput = 0;
    let totalOutput = 0;

    for (const r of this.records) {
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      if (!byModel[r.model])
        byModel[r.model] = { calls: 0, cost: 0, tokens: 0 };
      byModel[r.model].calls++;
      byModel[r.model].cost += r.estimatedCost;
      byModel[r.model].tokens += r.inputTokens + r.outputTokens;
    }

    return {
      totalCost: this.totalCost,
      totalCalls: this.records.length,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      remainingBudget: this.config.budgetLimit - this.totalCost,
      activeKey: this.getActiveKeyName(),
      byModel,
    };
  }

  getRecords(): CallRecord[] {
    return [...this.records];
  }
}
