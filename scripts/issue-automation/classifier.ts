/**
 * Issue classifier — labels new issues using LLM + taxonomy
 *
 * Usage (standalone):
 *   ISSUE_NUMBER=42 REPO=owner/repo bun run scripts/issue-automation/classifier.ts
 */

import type { ClassificationResult } from "./types.ts";
import { LLMClient } from "./llm-client.ts";
import { sanitizeAndDelimit, sanitizeIssueText } from "./sanitizer.ts";
import { TAXONOMY_PROMPT_DESCRIPTION, filterValidLabels } from "./taxonomy.ts";
import { withRetry, addLabels, ghExec, appendStepSummary } from "./utils.ts";

const MAX_TITLE_LEN = 500;
const MAX_BODY_LEN = 10_000;

export async function classifyIssue(
  title: string,
  body: string,
  issueNumber: number,
  repo: string
): Promise<ClassificationResult> {
  const cleanTitle = sanitizeIssueText(title, MAX_TITLE_LEN);
  const cleanBody = sanitizeIssueText(body, MAX_BODY_LEN);

  const llm = new LLMClient({ temperature: 0.1 });

  const systemPrompt = `${TAXONOMY_PROMPT_DESCRIPTION}

Respond with ONLY a JSON object in this exact format:
{
  "labels": ["label1", "label2"],
  "confidence": 0.95,
  "reasoning": "Brief explanation"
}`;

  const userMessage = `Classify this GitHub issue:

Title: ${sanitizeAndDelimit(cleanTitle, "issue_title", MAX_TITLE_LEN)}

Body:
${sanitizeAndDelimit(cleanBody, "issue_body", MAX_BODY_LEN)}`;

  const raw = await withRetry(() =>
    llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ])
  );

  let result: ClassificationResult;
  try {
    result = llm.parseJSON<ClassificationResult>(raw);
  } catch {
    console.error("Failed to parse LLM JSON, using fallback:", raw.slice(0, 200));
    result = {
      labels: ["bug"],
      confidence: 0.5,
      reasoning: "LLM response parse failure — fallback to bug label",
    };
  }

  // Validate and filter labels
  result.labels = filterValidLabels(result.labels ?? []).slice(0, 3);
  result.confidence = Math.max(0, Math.min(1, result.confidence ?? 0.5));

  // Always include pending-triage
  const finalLabels = [...new Set(["pending-triage", ...result.labels])];

  // Apply labels
  addLabels(repo, issueNumber, finalLabels);
  console.log(`Issue #${issueNumber} labeled: ${finalLabels.join(", ")}`);

  return { ...result, labels: finalLabels };
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? "0", 10);
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  if (!issueNumber || !repo) {
    console.error("Usage: ISSUE_NUMBER=42 REPO=owner/repo bun run classifier.ts");
    process.exit(1);
  }

  // Fetch issue data
  const issueJson = ghExec(
    `issue view ${issueNumber} --repo ${repo} --json title,body`
  );
  const { title, body } = JSON.parse(issueJson);

  const result = await classifyIssue(title, body ?? "", issueNumber, repo);
  console.log(JSON.stringify(result, null, 2));

  appendStepSummary(`## 🏷️ Issue Classification — #${issueNumber}
| Field | Value |
|-------|-------|
| Labels | ${result.labels.join(", ")} |
| Confidence | ${(result.confidence * 100).toFixed(0)}% |
| Reasoning | ${result.reasoning} |
`);
}
