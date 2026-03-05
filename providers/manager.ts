// ─────────────────────────────────────────────────────────────
// AETHER LLM Provider Manager
// Routes requests to the right provider based on agent tier
// ─────────────────────────────────────────────────────────────

import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "./base.ts";
import { ClaudeProvider } from "./claude.ts";
import { OpenAIProvider } from "./openai.ts";
import { GeminiProvider } from "./gemini.ts";
import { OllamaProvider } from "./ollama.ts";
import type { AgentTier, LLMProvider, ProviderConfig } from "../core/types.ts";

/** Default provider config: Claude across all tiers */
const DEFAULT_CONFIG: ProviderConfig = {
  tiers: {
    master: { provider: "claude", model: "opus" },
    manager: { provider: "claude", model: "sonnet" },
    worker: { provider: "claude", model: "haiku" },
  },
  fallbackChain: [
    { provider: "openai", model: "gpt4o" },
    { provider: "gemini", model: "gemini-pro" },
    { provider: "ollama", model: "local" },
  ],
};

export class ProviderManager {
  private providers: Map<string, BaseLLMProvider> = new Map();
  private config: ProviderConfig;

  constructor(config?: ProviderConfig) {
    this.config = config ?? DEFAULT_CONFIG;
    this.initializeProviders();
  }

  // ── Provider Initialization ──────────────────────────────

  private initializeProviders(): void {
    this.providers.set("claude", new ClaudeProvider());
    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("gemini", new GeminiProvider());
    this.providers.set("ollama", new OllamaProvider());
  }

  // ── Tier-based Routing ───────────────────────────────────

  /**
   * Send a prompt using the provider assigned to a specific agent tier.
   * Falls back through the fallback chain if the primary provider fails.
   */
  async sendForTier(
    tier: AgentTier,
    prompt: string,
    options?: Partial<LLMOptions>,
  ): Promise<LLMResponse> {
    const tierConfig = this.config.tiers[tier] ?? {
      provider: "claude",
      model: "haiku",
    };
    const fullOptions: LLMOptions = {
      model: tierConfig.model,
      ...options,
    };

    // Try the primary provider for this tier
    const primary = this.providers.get(tierConfig.provider);
    if (primary?.isConfigured()) {
      try {
        return await primary.send(prompt, fullOptions);
      } catch (err) {
        // Primary failed — log and try fallbacks
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ProviderManager] Primary ${tierConfig.provider} failed for ${tier}: ${msg}`,
        );
      }
    }

    // Walk the fallback chain
    for (const fallback of this.config.fallbackChain) {
      const provider = this.providers.get(fallback.provider);
      if (!provider?.isConfigured()) continue;

      try {
        const fbOptions: LLMOptions = {
          ...fullOptions,
          model: fallback.model,
        };
        return await provider.send(prompt, fbOptions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ProviderManager] Fallback ${fallback.provider} failed: ${msg}`,
        );
      }
    }

    throw new Error(
      `All providers failed for tier "${tier}". ` +
        `Primary: ${tierConfig.provider}. ` +
        `Fallbacks: ${this.config.fallbackChain.map((f) => f.provider).join(", ")}`,
    );
  }

  // ── Direct Provider Access ───────────────────────────────

  /** Send to a specific provider directly, bypassing tier routing */
  async sendDirect(
    provider: LLMProvider,
    prompt: string,
    options: LLMOptions,
  ): Promise<LLMResponse> {
    const p = this.providers.get(provider);
    if (!p) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    if (!p.isConfigured()) {
      throw new Error(
        `Provider "${provider}" is not configured (missing API key)`,
      );
    }
    return p.send(prompt, options);
  }

  // ── Introspection ────────────────────────────────────────

  /** Get list of providers that are configured (have API keys) */
  getAvailableProviders(): LLMProvider[] {
    const available: LLMProvider[] = [];
    for (const [name, provider] of this.providers) {
      if (provider.isConfigured()) {
        available.push(name as LLMProvider);
      }
    }
    return available;
  }

  /** Get total token usage aggregated across all providers */
  getTotalUsage(): { input: number; output: number } {
    let input = 0;
    let output = 0;
    for (const provider of this.providers.values()) {
      const spent = provider.getTotalSpent();
      input += spent.input;
      output += spent.output;
    }
    return { input, output };
  }

  /** Get the underlying provider instance */
  getProvider(name: LLMProvider): BaseLLMProvider | undefined {
    return this.providers.get(name);
  }

  /** Get the current configuration */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  // ── Static Helpers ───────────────────────────────────────

  /**
   * Detect which LLM providers are available by checking environment
   * variables and (for Ollama) whether the local server is reachable.
   */
  static async detectProviders(): Promise<LLMProvider[]> {
    const detected: LLMProvider[] = [];

    if (process.env.ANTHROPIC_API_KEY) {
      detected.push("claude");
    }
    if (process.env.OPENAI_API_KEY) {
      detected.push("openai");
    }
    if (process.env.GOOGLE_AI_KEY) {
      detected.push("gemini");
    }

    // Check Ollama reachability
    try {
      const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
      const response = await fetch(host, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        detected.push("ollama");
      }
    } catch {
      // Ollama not reachable — skip
    }

    return detected;
  }
}
