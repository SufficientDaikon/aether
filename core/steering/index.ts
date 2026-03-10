// ─────────────────────────────────────────────────────────────
// Steering Module — barrel export
// ─────────────────────────────────────────────────────────────

export {
  parseFrontMatter,
  loadSteeringFile,
  loadSteering,
  type SteeringMeta,
  type SteeringFile,
  type LoadSteeringResult,
} from "./loader.ts";

export {
  compose,
  estimateTokens,
  scopeMatchesAgent,
  type ComposedSteering,
} from "./composer.ts";
