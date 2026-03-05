// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — OpenAI (Chat Completions API)
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";

export class OpenAIProvider extends BaseLLMProvider {
  private baseUrl = "https://api.openai.com/v1/chat/completions";

  /** Model tier → OpenAI model ID */
  static modelMap: Record<string, string> = {
    "gpt4o": "gpt-4o",
    "gpt4o-mini": "gpt-4o-mini",
  };

  constructor(apiKey?: string) {
    super("openai", apiKey ?? process.env.OPENAI_API_KEY ?? "");
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error("OpenAI API key not configured");
    }
    if (!this.isWithinBudget()) {
      throw new Error("Token budget exceeded");
    }

    const model = OpenAIProvider.modelMap[options.model] ?? options.model;
    const startTime = Date.now();

    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    };

    if (options.stopSequences?.length) {
      body.stop = options.stopSequences;
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;

    const tokensUsed = {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      total: data.usage?.total_tokens ?? 0,
    };

    this.trackUsage(tokensUsed.input, tokensUsed.output);

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? model,
      tokensUsed,
      latencyMs: latency,
      provider: "openai",
    };
  }
}
