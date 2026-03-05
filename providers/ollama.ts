// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider — Ollama (Local Models)
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";

export class OllamaProvider extends BaseLLMProvider {
  private baseUrl: string;

  /** Model tier → default Ollama model */
  static modelMap: Record<string, string> = {
    local: "llama3.2",
  };

  constructor(host?: string) {
    super("ollama", "local"); // No API key needed
    this.baseUrl = host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
  }

  /** Ollama doesn't need an API key — always "configured" */
  override isConfigured(): boolean {
    return true;
  }

  /** Check whether the Ollama server is reachable */
  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
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

    // Verify Ollama is reachable before attempting to generate
    const reachable = await this.isReachable();
    if (!reachable) {
      throw new Error(
        `Ollama is not reachable at ${this.baseUrl}. ` +
          "Ensure Ollama is installed and running (ollama serve)."
      );
    }

    const model = OllamaProvider.modelMap[options.model] ?? options.model;
    const startTime = Date.now();

    const body: Record<string, unknown> = {
      model,
      prompt,
      stream: false,
      options: {
        num_predict: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      },
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    if (options.stopSequences?.length) {
      (body.options as Record<string, unknown>).stop = options.stopSequences;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Ollama connection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;

    // Ollama provides token counts in some versions; estimate otherwise
    const outputText: string = data.response ?? "";
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    const tokensUsed = {
      input: data.prompt_eval_count ?? estimateTokens(prompt),
      output: data.eval_count ?? estimateTokens(outputText),
      total: 0,
    };
    tokensUsed.total = tokensUsed.input + tokensUsed.output;

    this.trackUsage(tokensUsed.input, tokensUsed.output);

    return {
      content: outputText,
      model: data.model ?? model,
      tokensUsed,
      latencyMs: latency,
      provider: "ollama",
    };
  }
}
