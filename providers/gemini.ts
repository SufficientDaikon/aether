// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — Google Gemini (Generative Language API)
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";

export class GeminiProvider extends BaseLLMProvider {
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

  /** Model tier → Gemini model ID */
  static modelMap: Record<string, string> = {
    "gemini-ultra": "gemini-1.5-pro",
    "gemini-pro": "gemini-1.5-pro",
    "gemini-flash": "gemini-1.5-flash",
  };

  constructor(apiKey?: string) {
    super("gemini", apiKey ?? process.env.GOOGLE_AI_KEY ?? "");
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error("Gemini API key not configured");
    }
    if (!this.isWithinBudget()) {
      throw new Error("Token budget exceeded");
    }

    const model = GeminiProvider.modelMap[options.model] ?? options.model;
    const startTime = Date.now();

    const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        ...(options.stopSequences?.length
          ? { stopSequences: options.stopSequences }
          : {}),
      },
    };

    if (options.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;

    const tokensUsed = {
      input: data.usageMetadata?.promptTokenCount ?? 0,
      output: data.usageMetadata?.candidatesTokenCount ?? 0,
      total: data.usageMetadata?.totalTokenCount ?? 0,
    };

    this.trackUsage(tokensUsed.input, tokensUsed.output);

    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      model,
      tokensUsed,
      latencyMs: latency,
      provider: "gemini",
    };
  }
}
