// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — LM Studio (OpenAI-compatible local API)
//
// Connects to LM Studio's local server at localhost:1234/v1.
// Supports any model loaded in LM Studio (Qwen, Llama, etc.)
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";

export class LMStudioProvider extends BaseLLMProvider {
  private baseUrl: string;

  constructor(host?: string) {
    super("lmstudio", "local"); // No API key needed
    this.baseUrl =
      host ?? process.env.LMSTUDIO_HOST ?? "http://localhost:1234/v1";
  }

  /** LM Studio doesn't need an API key */
  override isConfigured(): boolean {
    return true;
  }

  /** Check whether LM Studio server is reachable */
  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    if (!this.isWithinBudget()) {
      throw new Error("Token budget exceeded");
    }

    const reachable = await this.isReachable();
    if (!reachable) {
      throw new Error(
        `LM Studio is not reachable at ${this.baseUrl}. ` +
          "Make sure LM Studio is running with the local server enabled.",
      );
    }

    // Use model name directly — LM Studio uses whatever model is loaded
    const model = options.model;
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

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `LM Studio connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LM Studio API error (${response.status}): ${err}`);
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
      provider: "lmstudio",
    };
  }
}
