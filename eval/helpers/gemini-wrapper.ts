// ─────────────────────────────────────────────────────────────
// AETHER Eval — Gemini API Wrapper
// Direct Gemini calls with rate limiting + cost tracking
// ─────────────────────────────────────────────────────────────

import { RateLimiter } from "./rate-limiter.ts";
import { CostTracker } from "./cost-tracker.ts";
import type { LLMResponse } from "../../providers/base.ts";

export interface GeminiCallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export class GeminiWrapper {
  private rateLimiter: RateLimiter;
  private costTracker: CostTracker;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

  private static MODEL_MAP: Record<string, string> = {
    "gemini-ultra": "gemini-2.5-pro",
    "gemini-pro": "gemini-2.5-pro",
    "gemini-flash": "gemini-2.5-flash",
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-1.5-pro": "gemini-2.5-pro",
    "gemini-1.5-flash": "gemini-2.5-flash",
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-2.5-pro": "gemini-2.5-pro",
  };

  constructor(rateLimiter: RateLimiter, costTracker: CostTracker) {
    this.rateLimiter = rateLimiter;
    this.costTracker = costTracker;
  }

  async send(
    prompt: string,
    options: GeminiCallOptions = {},
  ): Promise<LLMResponse> {
    const rawModel = options.model ?? "gemini-2.5-flash";
    const model = GeminiWrapper.MODEL_MAP[rawModel] ?? rawModel;

    while (true) {
      await this.rateLimiter.waitForSlot();
      const apiKey = this.costTracker.getActiveKey();
      const startTime = Date.now();

      try {
        const url = `${this.baseUrl}/${model}:generateContent?key=${apiKey}`;
        const body: Record<string, unknown> = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: options.maxTokens ?? 8192,
            temperature: options.temperature ?? 0.7,
          },
        };
        if (options.systemPrompt) {
          body.systemInstruction = {
            parts: [{ text: options.systemPrompt }],
          };
        }

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          if (!this.rateLimiter.shouldRetry()) {
            throw new Error("Rate limit exceeded after maximum retries");
          }
          const backoff = this.rateLimiter.getBackoffMs();
          console.log(
            `[GeminiWrapper] 429 rate limited. Backing off ${Math.round(backoff)}ms`,
          );
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(
            `Gemini API error (${response.status}): ${errText.slice(0, 500)}`,
          );
        }

        const data = (await response.json()) as any;
        const latencyMs = Date.now() - startTime;

        const tokensUsed = {
          input:
            data.usageMetadata?.promptTokenCount ??
            Math.ceil(prompt.length / 4),
          output: data.usageMetadata?.candidatesTokenCount ?? 0,
          total: data.usageMetadata?.totalTokenCount ?? 0,
        };

        this.rateLimiter.onSuccess();
        this.costTracker.recordCall(
          model,
          tokensUsed.input,
          tokensUsed.output,
          latencyMs,
        );

        const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        return {
          content,
          model,
          tokensUsed,
          latencyMs,
          provider: "gemini",
        };
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) {
          continue;
        }
        throw err;
      }
    }
  }

  getCostSummary() {
    return this.costTracker.getSummary();
  }
}
