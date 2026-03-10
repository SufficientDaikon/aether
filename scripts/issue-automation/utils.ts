/**
 * Utility functions: retry, batch processing, GitHub CLI helpers.
 * Standalone — does NOT import from core/.
 */

import { execSync } from "child_process";

// ─── Retry ────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffFactor?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoffFactor = 2 } = opts;
  let lastError: unknown;
  let delay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= backoffFactor;
      }
    }
  }
  throw lastError;
}

// ─── Batching ─────────────────────────────────────────────────────────────────

export async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>,
  delayMs: number = 1000
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── GitHub CLI helpers ───────────────────────────────────────────────────────

/** Run a gh CLI command and return stdout as string */
export function ghExec(args: string): string {
  try {
    return execSync(`gh ${args}`, { encoding: "utf-8" }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`gh CLI error: ${msg}`);
  }
}

/** Add labels to an issue */
export function addLabels(
  repo: string,
  issueNumber: number,
  labels: string[]
): void {
  if (labels.length === 0) return;
  const labelArgs = labels.map((l) => `--add-label "${l}"`).join(" ");
  ghExec(`issue edit ${issueNumber} --repo ${repo} ${labelArgs}`);
}

/** Remove a label from an issue */
export function removeLabel(
  repo: string,
  issueNumber: number,
  label: string
): void {
  ghExec(
    `issue edit ${issueNumber} --repo ${repo} --remove-label "${label}"`
  );
}

/** Post a comment on an issue */
export function postComment(
  repo: string,
  issueNumber: number,
  body: string
): void {
  const escaped = body.replace(/'/g, "'\\''");
  ghExec(`issue comment ${issueNumber} --repo ${repo} --body '${escaped}'`);
}

/** Close an issue with a comment */
export function closeIssue(
  repo: string,
  issueNumber: number,
  reason: "completed" | "not_planned" = "not_planned"
): void {
  ghExec(
    `issue close ${issueNumber} --repo ${repo} --reason "${reason}"`
  );
}

/** Delete a comment by ID */
export function deleteComment(repo: string, commentId: number): void {
  const [owner, repoName] = repo.split("/");
  ghExec(
    `api repos/${owner}/${repoName}/issues/comments/${commentId} -X DELETE`
  );
}

// ─── GitHub Step Summary ──────────────────────────────────────────────────────

export function appendStepSummary(markdown: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return; // Not running in GitHub Actions

  const { appendFileSync } = require("fs");
  appendFileSync(summaryPath, markdown + "\n", "utf-8");
}

// ─── Parse numbers safely ─────────────────────────────────────────────────────

export function safeParseFloat(value: unknown, fallback = 0): number {
  const n = parseFloat(String(value));
  return isNaN(n) ? fallback : n;
}

export function safeParseInt(value: unknown, fallback = 0): number {
  const n = parseInt(String(value), 10);
  return isNaN(n) ? fallback : n;
}
