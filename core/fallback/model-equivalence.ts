// ─────────────────────────────────────────────────────────────
// Model Equivalence Map
// R10.2 — MODEL_EQUIVALENCE + getEquivalentModel()
// ─────────────────────────────────────────────────────────────

/**
 * Capability tiers that group equivalent models across providers.
 * - **opus**   — Highest capability flagship models
 * - **sonnet** — Balanced mid-tier models
 * - **haiku**  — Lightweight fast models
 */
export type CapabilityTier = "opus" | "sonnet" | "haiku";

/** Describes equivalent models for a single capability tier */
export interface ModelEquivalenceEntry {
  /** Ordered list of equivalent model identifiers across providers */
  models: string[];
  /** Human-readable description of this tier's capability level */
  description: string;
}

/**
 * Canonical cross-provider model equivalence map.
 *
 * | Tier   | Models                                        |
 * |--------|-----------------------------------------------|
 * | opus   | gpt-4o, claude-opus-4-6, gemini-2.5-pro       |
 * | sonnet | gpt-4o-mini, claude-sonnet-4, llama3.1:70b    |
 * | haiku  | gpt-4o-mini, qwen2.5:7b, local                |
 */
export const MODEL_EQUIVALENCE: Record<CapabilityTier, ModelEquivalenceEntry> = {
  opus: {
    models: ["gpt-4o", "claude-opus-4-6", "gemini-2.5-pro"],
    description: "Highest-capability flagship models for complex reasoning",
  },
  sonnet: {
    models: ["gpt-4o-mini", "claude-sonnet-4", "llama3.1:70b"],
    description: "Balanced mid-tier models for general-purpose tasks",
  },
  haiku: {
    models: ["gpt-4o-mini", "qwen2.5:7b", "local"],
    description: "Lightweight fast models for simple or high-throughput tasks",
  },
};

/**
 * Get the preferred equivalent model for a capability tier.
 *
 * When `preferredProvider` is supplied, returns the first model whose
 * identifier contains that substring (case-insensitive). Falls back to the
 * first model in the list if no match is found.
 *
 * @param tier              Capability tier to look up
 * @param preferredProvider Optional provider substring (e.g. "claude", "gpt")
 * @returns                 Model identifier, or `undefined` if tier is unknown
 *
 * @example
 * getEquivalentModel("opus", "claude") // → "claude-opus-4-6"
 * getEquivalentModel("sonnet")         // → "gpt-4o-mini"
 */
export function getEquivalentModel(
  tier: CapabilityTier,
  preferredProvider?: string
): string | undefined {
  const entry = MODEL_EQUIVALENCE[tier];
  if (!entry || entry.models.length === 0) return undefined;

  if (preferredProvider) {
    const match = entry.models.find(m =>
      m.toLowerCase().includes(preferredProvider.toLowerCase())
    );
    if (match) return match;
  }

  return entry.models[0];
}

/**
 * Get all equivalent models for a capability tier.
 *
 * @param tier Capability tier to look up
 * @returns    Array of model identifiers (empty if tier not found)
 */
export function getEquivalentModels(tier: CapabilityTier): string[] {
  return MODEL_EQUIVALENCE[tier]?.models ?? [];
}

/**
 * Find which capability tier a model belongs to.
 *
 * @param modelId Model identifier to search for
 * @returns       The `CapabilityTier`, or `undefined` if not in the map
 */
export function getTierForModel(modelId: string): CapabilityTier | undefined {
  for (const [tier, entry] of Object.entries(MODEL_EQUIVALENCE) as [
    CapabilityTier,
    ModelEquivalenceEntry,
  ][]) {
    if (entry.models.includes(modelId)) return tier;
  }
  return undefined;
}
