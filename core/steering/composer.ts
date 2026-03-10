// ─────────────────────────────────────────────────────────────
// Steering Composer — filters, orders, and truncates steering
// context for a specific agent within a token budget
// ─────────────────────────────────────────────────────────────

import type { SteeringFile } from "./loader.ts";

export interface ComposedSteering {
  content: string;
  sources: string[];
  totalTokens: number;
  truncated: boolean;
}

/** Estimate token count: words * 1.3 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

/**
 * Check whether a steering file's scope matches the given agent ID.
 *
 * Matching rules:
 *  - "global" matches everything
 *  - Exact agent ID match (e.g. scope "react-specialist" matches agentId "react-specialist")
 *  - Category match: scope "frontend" matches agents whose id contains "frontend",
 *    "ui", "react", "ux"; scope "backend" matches "backend", "api", "db", "postgres", "bun-runtime";
 *    scope "security" matches "security", "sentinel", "hardener", "vuln", "threat";
 *    scope "testing" matches "test", "qa", "playwright"
 */
export function scopeMatchesAgent(scope: string, agentId: string): boolean {
  const s = scope.toLowerCase();
  const a = agentId.toLowerCase();

  if (s === "global") return true;
  if (s === a) return true;

  const categoryMap: Record<string, string[]> = {
    frontend: ["frontend", "ui", "react", "ux", "css", "design"],
    backend: ["backend", "api", "db", "postgres", "redis", "bun-runtime", "server"],
    security: ["security", "sentinel", "hardener", "vuln", "threat", "cyber"],
    testing: ["test", "qa", "playwright", "audit"],
  };

  const keywords = categoryMap[s];
  if (keywords) {
    return keywords.some((kw) => a.includes(kw));
  }

  // Partial match: scope appears in agent ID
  return a.includes(s);
}

/**
 * Compose steering context for a specific agent, within a token budget.
 *
 * Steps:
 *  1. Filter files by scope matching agentId
 *  2. Order by priority (highest first; ties broken by filename)
 *  3. Accumulate content until maxTokens is reached
 *  4. Drop lowest-priority files first when truncating
 */
export function compose(
  files: SteeringFile[],
  agentId: string,
  maxTokens: number = Infinity,
): ComposedSteering {
  // Filter by scope
  const matching = files.filter((f) => scopeMatchesAgent(f.meta.scope, agentId));

  // Sort by priority descending, then filename ascending for stability
  const sorted = [...matching].sort((a, b) => {
    if (b.meta.priority !== a.meta.priority) return b.meta.priority - a.meta.priority;
    return a.filename.localeCompare(b.filename);
  });

  const parts: string[] = [];
  const sources: string[] = [];
  let totalTokens = 0;
  let truncated = false;

  for (const file of sorted) {
    const tokens = estimateTokens(file.content);
    if (totalTokens + tokens > maxTokens) {
      truncated = true;
      // Try to fit a partial segment if we have room
      if (totalTokens < maxTokens) {
        const remaining = maxTokens - totalTokens;
        const words = file.content.split(/\s+/).filter(Boolean);
        const wordsToTake = Math.floor(remaining / 1.3);
        if (wordsToTake > 0) {
          parts.push(words.slice(0, wordsToTake).join(" "));
          sources.push(file.path);
          totalTokens += Math.ceil(wordsToTake * 1.3);
        }
      }
      break;
    }
    parts.push(file.content);
    sources.push(file.path);
    totalTokens += tokens;
  }

  return {
    content: parts.join("\n\n---\n\n"),
    sources,
    totalTokens,
    truncated,
  };
}
