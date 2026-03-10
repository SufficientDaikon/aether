/**
 * Confidence Gate (R04.5)
 * Blocks agent actions whose confidence score falls below a per-action threshold.
 */

export interface ConfidenceConfig {
  classification: number;
  duplicateDetection: number;
  spamDetection: number;
  custom: Record<string, number>;
}

export interface ConfidenceResult {
  allowed: boolean;
  threshold: number;
  reason?: string;
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  classification: 0.8,
  duplicateDetection: 0.8,
  spamDetection: 0.85,
  custom: {},
};

/**
 * Check whether an action's confidence score meets its threshold.
 */
export function checkConfidence(
  action: string,
  score: number,
  config: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
): ConfidenceResult {
  // Custom overrides take priority
  const threshold =
    config.custom[action] ??
    (config as Record<string, unknown>)[action] as number | undefined ??
    undefined;

  if (threshold === undefined) {
    return {
      allowed: false,
      threshold: 0,
      reason: `Unknown action "${action}" — no threshold configured`,
    };
  }

  if (score >= threshold) {
    return { allowed: true, threshold };
  }

  return {
    allowed: false,
    threshold,
    reason: `Confidence ${score} below threshold ${threshold} for action "${action}"`,
  };
}
