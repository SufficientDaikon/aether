// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — GitHub Copilot
//
// Uses GitHub Copilot's API via a token obtained from the
// GitHub CLI (`gh auth token`) or GITHUB_TOKEN env var.
// Copilot exposes an OpenAI-compatible Chat Completions endpoint.
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";

export class CopilotProvider extends BaseLLMProvider {
  private baseUrl: string;

  /** Model aliases → Copilot model IDs */
  static modelMap: Record<string, string> = {
    "copilot": "gpt-4o",
    "copilot-fast": "gpt-4o-mini",
    "claude-sonnet": "claude-3.5-sonnet",
    "gpt4o": "gpt-4o",
    "gpt4o-mini": "gpt-4o-mini",
  };

  constructor(token?: string) {
    // Try: explicit token → GITHUB_TOKEN → gh auth token (resolved lazily)
    const apiKey =
      token ??
      process.env.GITHUB_TOKEN ??
      process.env.GH_TOKEN ??
      "";
    super("copilot", apiKey);
    this.baseUrl =
      process.env.COPILOT_API_URL ??
      "https://models.inference.ai.azure.com";
  }

  override isConfigured(): boolean {
    if (this.apiKey) return true;
    // Try to get token from gh CLI at check time
    return !!this.resolveToken();
  }

  private resolveToken(): string {
    if (this.apiKey) return this.apiKey;

    try {
      const { execSync } = require("node:child_process");
      const token = execSync("gh auth token", {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (token) {
        // Cache for future calls
        (this as any).apiKey = token;
        return token;
      }
    } catch {
      // gh not installed or not authenticated
    }
    return "";
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    const token = this.resolveToken();
    if (!token) {
      throw new Error(
        "GitHub Copilot token not found. Set GITHUB_TOKEN, GH_TOKEN, or run `gh auth login`.",
      );
    }
    if (!this.isWithinBudget()) {
      throw new Error("Token budget exceeded");
    }

    const model =
      CopilotProvider.modelMap[options.model] ?? options.model;
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Copilot API connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Copilot API error (${response.status}): ${err}`);
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
      provider: "copilot",
    };
  }
}
