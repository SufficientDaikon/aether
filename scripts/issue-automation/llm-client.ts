/**
 * GitHub Models API wrapper (LLM client)
 * Uses fetch() — compatible with Node.js 20+ and Bun
 */

import type { LLMMessage, LLMResponse } from "./types.ts";

const GITHUB_MODELS_ENDPOINT =
  "https://models.inference.ai.azure.com/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface LLMClientOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export class LLMClient {
  private token: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(opts: LLMClientOptions = {}) {
    const token = process.env.GH_PAT ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "No GitHub token found. Set GH_PAT or GITHUB_TOKEN environment variable."
      );
    }
    this.token = token;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.temperature = opts.temperature ?? 0.2;
    this.maxTokens = opts.maxTokens ?? 800;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(GITHUB_MODELS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `GitHub Models API error ${response.status}: ${text.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as LLMResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from LLM");
    }
    return content.trim();
  }

  /** Parse the first JSON object found in an LLM response */
  parseJSON<T>(text: string): T {
    // Extract JSON block from markdown code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenceMatch ? fenceMatch[1].trim() : text;

    // Find first { ... } block
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error(`No JSON object found in LLM response: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(raw.slice(start, end + 1)) as T;
  }
}
