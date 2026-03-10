/**
 * Batch comparator — compares a new issue against a batch of existing issues
 * Returns similarity scores for each pair.
 */

import type { Issue, SimilarityResult } from "./types.ts";
import { LLMClient } from "./llm-client.ts";
import { sanitizeIssueText, sanitizeAndDelimit } from "./sanitizer.ts";
import { withRetry, safeParseFloat } from "./utils.ts";

const SIMILARITY_THRESHOLD = 0.8;

interface BatchSimilarityResponse {
  comparisons: Array<{
    issue_number: number;
    score: number;
    reasoning: string;
  }>;
}

export async function compareBatch(
  newIssue: { number: number; title: string; body: string },
  candidates: Issue[]
): Promise<SimilarityResult[]> {
  if (candidates.length === 0) return [];

  const cleanNewTitle = sanitizeIssueText(newIssue.title, 500);
  const cleanNewBody = sanitizeIssueText(newIssue.body, 2000);

  const candidateList = candidates
    .map(
      (c, i) =>
        `[${i + 1}] Issue #${c.number}: ${sanitizeIssueText(c.title, 200)}`
    )
    .join("\n");

  const llm = new LLMClient({ temperature: 0.1, maxTokens: 600 });

  const systemPrompt = `You are a duplicate issue detector for a GitHub repository.
Compare a new issue against a list of existing issues and score their similarity.
Score 0.0 = completely different, 1.0 = identical/obvious duplicate.
Only score >= 0.8 if they describe the exact same problem.

Respond with ONLY valid JSON in this format:
{
  "comparisons": [
    { "issue_number": 123, "score": 0.9, "reasoning": "Same error message and stack trace" },
    { "issue_number": 456, "score": 0.3, "reasoning": "Different component, similar theme" }
  ]
}`;

  const userMessage = `NEW ISSUE #${newIssue.number}:
${sanitizeAndDelimit(cleanNewTitle, "new_title")}
${sanitizeAndDelimit(cleanNewBody, "new_body", 2000)}

EXISTING ISSUES TO COMPARE:
${sanitizeAndDelimit(candidateList, "existing_issues")}

Return scores for all ${candidates.length} existing issues.`;

  let raw: string;
  try {
    raw = await withRetry(() =>
      llm.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ])
    );
  } catch (err) {
    console.error("LLM batch comparison failed:", err);
    return [];
  }

  let parsed: BatchSimilarityResponse;
  try {
    parsed = llm.parseJSON<BatchSimilarityResponse>(raw);
  } catch {
    console.error("Failed to parse batch comparison response:", raw.slice(0, 300));
    return [];
  }

  return (parsed.comparisons ?? [])
    .filter((c) => typeof c.issue_number === "number")
    .map((c) => ({
      issueNumber: c.issue_number,
      score: safeParseFloat(c.score, 0),
      reasoning: c.reasoning ?? "",
    }))
    .filter((c) => c.score >= SIMILARITY_THRESHOLD);
}
