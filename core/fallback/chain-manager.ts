// ─────────────────────────────────────────────────────────────
// Per-Tier Fallback Chain Manager
// R10.1 — FallbackChainManager class
// ─────────────────────────────────────────────────────────────

/** Configuration for FallbackChainManager */
export interface FallbackChainConfig {
  /**
   * Maps tier names to ordered arrays of model identifiers.
   * The first entry is tried first; subsequent entries are fallbacks.
   *
   * @example
   * {
   *   master:  ["claude-opus-4-6", "gpt-4o", "gemini-2.5-pro"],
   *   worker:  ["claude-sonnet-4", "gpt-4o-mini"],
   * }
   */
  chains: Record<string, string[]>;
}

/** Captures a single model attempt and its error */
export interface FallbackAttempt {
  model: string;
  error: Error;
}

/**
 * Manages per-tier model fallback chains.
 *
 * For a given agent tier, tries each configured model in order.
 * Returns the first successful result. If every model fails, throws a
 * descriptive error listing all models and their individual failure reasons.
 *
 * @example
 * const manager = new FallbackChainManager({
 *   chains: { master: ["claude-opus-4-6", "gpt-4o", "gemini-2.5-pro"] },
 * });
 * const result = await manager.executeWithFallback("master", model =>
 *   providerManager.sendToModel(model, prompt)
 * );
 */
export class FallbackChainManager {
  private chains: Record<string, string[]>;

  constructor(config: FallbackChainConfig) {
    // Shallow-copy each chain array to prevent external mutation
    this.chains = Object.fromEntries(
      Object.entries(config.chains).map(([tier, models]) => [tier, [...models]])
    );
  }

  /**
   * Execute an operation using the fallback chain for the given tier.
   *
   * @param tier      Agent tier name (e.g. "master", "worker")
   * @param operation Function that receives a model identifier and returns a Promise
   * @returns         The result from the first successful model
   * @throws          If no chain is configured for the tier, or all models fail
   */
  async executeWithFallback<T>(
    tier: string,
    operation: (model: string) => Promise<T>
  ): Promise<T> {
    const chain = this.chains[tier];
    if (!chain || chain.length === 0) {
      throw new Error(
        `FallbackChainManager: no chain configured for tier "${tier}"`
      );
    }

    const attempts: FallbackAttempt[] = [];

    for (const model of chain) {
      try {
        return await operation(model);
      } catch (err) {
        attempts.push({
          model,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    const lines = attempts.map(a => `  [${a.model}] ${a.error.message}`).join("\n");
    throw new Error(
      `FallbackChainManager: all models failed for tier "${tier}":\n${lines}`
    );
  }

  /**
   * Return a copy of the fallback chain for a tier, or `undefined` if not configured.
   */
  getChain(tier: string): string[] | undefined {
    return this.chains[tier] ? [...this.chains[tier]] : undefined;
  }

  /**
   * Set or replace the fallback chain for a tier.
   * Stores a copy of the provided array.
   */
  setChain(tier: string, models: string[]): void {
    this.chains[tier] = [...models];
  }

  /** Return all configured tier names */
  getTiers(): string[] {
    return Object.keys(this.chains);
  }
}
