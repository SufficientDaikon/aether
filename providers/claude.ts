// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — Claude (Anthropic Messages API)
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";

export class ClaudeProvider extends BaseLLMProvider {
  private baseUrl = "https://api.anthropic.com/v1/messages";

  /** Model tier → Anthropic model ID */
  static modelMap: Record<string, string> = {
    opus: "claude-opus-4-20250514",
    sonnet: "claude-sonnet-4-20250514",
    haiku: "claude-haiku-3-20241022",
  };

  constructor(apiKey?: string) {
    super("claude", apiKey ?? process.env.ANTHROPIC_API_KEY ?? "");
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error("Claude API key not configured");
    }
    if (!this.isWithinBudget()) {
      throw new Error("Token budget exceeded");
    }

    const model = ClaudeProvider.modelMap[options.model] ?? options.model;
    const startTime = Date.now();

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      system: options.systemPrompt ?? "",
      messages: [{ role: "user", content: prompt }],
    };

    if (options.stopSequences?.length) {
      body.stop_sequences = options.stopSequences;
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;

    const tokensUsed = {
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
      total: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };

    this.trackUsage(tokensUsed.input, tokensUsed.output);

    return {
      content: data.content?.[0]?.text ?? "",
      model: data.model ?? model,
      tokensUsed,
      latencyMs: latency,
      provider: "claude",
    };
  }
}
