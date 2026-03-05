// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — Base Interface & Abstract Class
// ─────────────────────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: { input: number; output: number; total: number };
  latencyMs: number;
  provider: string;
}

export interface LLMOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface TokenBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  totalSpent: { input: number; output: number };
  sessionStart: number;
}

export abstract class BaseLLMProvider {
  protected name: string;
  protected apiKey: string;
  protected budget: TokenBudget;

  constructor(name: string, apiKey: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.budget = {
      maxInputTokens: Infinity,
      maxOutputTokens: Infinity,
      totalSpent: { input: 0, output: 0 },
      sessionStart: Date.now(),
    };
  }

  /** Send a prompt and get a response */
  abstract send(prompt: string, options: LLMOptions): Promise<LLMResponse>;

  /** Check if the provider is configured (has API key) */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Get remaining budget */
  getRemainingBudget(): { input: number; output: number } {
    return {
      input: this.budget.maxInputTokens - this.budget.totalSpent.input,
      output: this.budget.maxOutputTokens - this.budget.totalSpent.output,
    };
  }

  /** Set budget limits */
  setBudget(maxInput: number, maxOutput: number): void {
    this.budget.maxInputTokens = maxInput;
    this.budget.maxOutputTokens = maxOutput;
  }

  /** Track token usage */
  protected trackUsage(input: number, output: number): void {
    this.budget.totalSpent.input += input;
    this.budget.totalSpent.output += output;
  }

  /** Check if within budget */
  protected isWithinBudget(): boolean {
    return (
      this.budget.totalSpent.input < this.budget.maxInputTokens &&
      this.budget.totalSpent.output < this.budget.maxOutputTokens
    );
  }

  /** Get provider name */
  getName(): string {
    return this.name;
  }

  /** Get total spent tokens */
  getTotalSpent(): { input: number; output: number } {
    return { ...this.budget.totalSpent };
  }
}
