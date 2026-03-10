/**
 * Lifecycle manager — manages stale issues
 *
 * Usage (standalone):
 *   REPO=owner/repo bun run scripts/issue-automation/lifecycle-manager.ts
 */

import type { Issue } from "./types.ts";
import {
  addLabels,
  postComment,
  ghExec,
  appendStepSummary,
  sleep,
} from "./utils.ts";

const STALE_DAYS = 30;
const CLOSE_STALE_DAYS = 7; // days after stale label before closing
const STALE_LABEL = "pending-response";

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

export interface StaleResult {
  issueNumber: number;
  action: "warned" | "closed" | "skipped";
  daysStale: number;
}

export async function processStaleIssues(
  repo: string,
  dryRun: boolean = false
): Promise<StaleResult[]> {
  const issuesJson = ghExec(
    `issue list --repo ${repo} --state open --limit 200 --json number,title,labels,updatedAt,createdAt`
  );
  const issues: Issue[] = JSON.parse(issuesJson);

  const results: StaleResult[] = [];

  for (const issue of issues) {
    const labelNames = issue.labels.map((l) => l.name);
    const isAlreadyStale = labelNames.includes(STALE_LABEL);
    const staleDays = daysSince(issue.updated_at);

    if (isAlreadyStale) {
      // Already warned — check if we should close
      if (staleDays >= CLOSE_STALE_DAYS && !dryRun) {
        ghExec(`issue close ${issue.number} --repo ${repo} --reason "not_planned"`);
        postComment(
          repo,
          issue.number,
          `🔒 This issue has been automatically closed due to inactivity (${staleDays} days since last update).\n\nFeel free to reopen if this is still relevant. Please provide new information or context when reopening.\n\n_Closed automatically by the AETHER lifecycle manager._`
        );
        results.push({ issueNumber: issue.number, action: "closed", daysStale: staleDays });
        console.log(`Closed stale issue #${issue.number} (${staleDays} days)`);
      } else {
        results.push({ issueNumber: issue.number, action: "skipped", daysStale: staleDays });
      }
    } else if (staleDays >= STALE_DAYS) {
      // Mark as stale
      if (!dryRun) {
        addLabels(repo, issue.number, [STALE_LABEL]);
        postComment(
          repo,
          issue.number,
          `⏰ **Stale Issue Warning**\n\nThis issue has had no activity for ${staleDays} days.\n\nIf this is still relevant, please:\n- Leave a comment with any updates\n- Confirm the issue still exists in the latest version\n\nThis issue will be **automatically closed in ${CLOSE_STALE_DAYS} days** if there's no activity.\n\n_Managed by the AETHER lifecycle manager._`
        );
      }
      results.push({ issueNumber: issue.number, action: "warned", daysStale: staleDays });
      console.log(`Warned stale issue #${issue.number} (${staleDays} days)`);
    }

    await sleep(100); // Rate limit
  }

  return results;
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  const dryRun = process.env.DRY_RUN === "true";
  if (!repo) {
    console.error("REPO environment variable required");
    process.exit(1);
  }

  console.log(`Running lifecycle manager on ${repo}${dryRun ? " (dry run)" : ""}...`);
  const results = await processStaleIssues(repo, dryRun);

  const warned = results.filter((r) => r.action === "warned").length;
  const closed = results.filter((r) => r.action === "closed").length;
  const skipped = results.filter((r) => r.action === "skipped").length;

  console.log(`Done: ${warned} warned, ${closed} closed, ${skipped} skipped`);

  appendStepSummary(`## ⏰ Lifecycle Manager
| Action | Count |
|--------|-------|
| Warned (stale) | ${warned} |
| Closed | ${closed} |
| Skipped | ${skipped} |

${dryRun ? "> ⚠️ Dry run — no changes made" : ""}
`);
}
