/**
 * Duplicate detector — compares a new issue against up to 1000 recent open issues
 *
 * Usage (standalone):
 *   ISSUE_NUMBER=42 REPO=owner/repo bun run scripts/issue-automation/duplicate-detector.ts
 */

import type { Issue, DuplicateCheckResult } from "./types.ts";
import { compareBatch } from "./batch-comparator.ts";
import { processBatches, addLabels, postComment, ghExec, appendStepSummary } from "./utils.ts";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;
const MAX_CANDIDATES = 1000;
const DUPLICATE_LABEL = "duplicate";

export async function detectDuplicate(
  issueNumber: number,
  title: string,
  body: string,
  repo: string
): Promise<DuplicateCheckResult> {
  // Fetch recent open issues (excluding the current one)
  const issuesJson = ghExec(
    `issue list --repo ${repo} --state open --limit ${MAX_CANDIDATES} --json number,title,body,labels,state,createdAt,updatedAt,url`
  );

  const allIssues: Issue[] = JSON.parse(issuesJson);
  const candidates = allIssues.filter((i) => i.number !== issueNumber);

  if (candidates.length === 0) {
    return { isDuplicate: false };
  }

  console.log(`Comparing issue #${issueNumber} against ${candidates.length} open issues...`);

  const newIssue = { number: issueNumber, title, body };

  // Process in batches with delay
  const matches = await processBatches(
    candidates,
    BATCH_SIZE,
    (batch) => compareBatch(newIssue, batch),
    BATCH_DELAY_MS
  );

  if (matches.length === 0) {
    return { isDuplicate: false };
  }

  // Pick highest scoring match
  const best = matches.reduce((a, b) => (a.score > b.score ? a : b));

  return {
    isDuplicate: true,
    originalIssue: best.issueNumber,
    score: best.score,
    reasoning: best.reasoning,
  };
}

export async function markDuplicate(
  issueNumber: number,
  result: DuplicateCheckResult,
  repo: string
): Promise<void> {
  if (!result.isDuplicate || !result.originalIssue) return;

  // Add duplicate label
  addLabels(repo, issueNumber, [DUPLICATE_LABEL]);

  // Post comment
  const comment = `🔄 **Duplicate Issue Detected**

This issue appears to be a duplicate of #${result.originalIssue} (similarity: ${((result.score ?? 0) * 100).toFixed(0)}%).

> ${result.reasoning}

**This issue will be automatically closed in 3 days** unless it's disputed.

To dispute this: leave a comment explaining why this is NOT a duplicate, or use the 👎 reaction on this comment. A maintainer will review your dispute.

_Detected automatically by the AETHER issue automation system._`;

  postComment(repo, issueNumber, comment);
  console.log(
    `Issue #${issueNumber} marked as duplicate of #${result.originalIssue}`
  );
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? "0", 10);
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  if (!issueNumber || !repo) {
    console.error("Usage: ISSUE_NUMBER=42 REPO=owner/repo bun run duplicate-detector.ts");
    process.exit(1);
  }

  const issueJson = ghExec(
    `issue view ${issueNumber} --repo ${repo} --json title,body`
  );
  const { title, body } = JSON.parse(issueJson);

  const result = await detectDuplicate(issueNumber, title, body ?? "", repo);
  console.log(JSON.stringify(result, null, 2));

  if (result.isDuplicate) {
    await markDuplicate(issueNumber, result, repo);
  }

  appendStepSummary(`## 🔄 Duplicate Detection — #${issueNumber}
| Field | Value |
|-------|-------|
| Is Duplicate | ${result.isDuplicate ? `✅ Yes (#${result.originalIssue})` : "❌ No"} |
| Score | ${result.score !== undefined ? `${(result.score * 100).toFixed(0)}%` : "N/A"} |
| Reasoning | ${result.reasoning ?? "N/A"} |
`);
}
