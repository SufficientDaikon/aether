/**
 * Grace closer — closes issues marked as duplicate after 3-day grace period
 *
 * Usage (standalone):
 *   REPO=owner/repo bun run scripts/issue-automation/grace-closer.ts
 */

import type { Issue } from "./types.ts";
import { ghExec, postComment, appendStepSummary, sleep } from "./utils.ts";

const DUPLICATE_LABEL = "duplicate";
const GRACE_PERIOD_DAYS = 3;

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

export interface GraceCloseResult {
  issueNumber: number;
  action: "closed" | "skipped";
  daysSinceLabeled: number;
  reason: string;
}

export async function runGraceCloser(
  repo: string,
  dryRun: boolean = false
): Promise<GraceCloseResult[]> {
  const [owner, repoName] = repo.split("/");

  // Fetch all open duplicate-labeled issues with timeline events
  const issuesJson = ghExec(
    `issue list --repo ${repo} --state open --label "${DUPLICATE_LABEL}" --limit 200 --json number,title,labels,createdAt,updatedAt`
  );
  const issues: Issue[] = JSON.parse(issuesJson);

  const results: GraceCloseResult[] = [];

  for (const issue of issues) {
    // Find when the duplicate label was added via timeline
    let labeledAt: string | null = null;
    try {
      const timelineJson = ghExec(
        `api repos/${owner}/${repoName}/issues/${issue.number}/timeline --paginate`
      );
      const events: Array<{
        event: string;
        label?: { name: string };
        created_at: string;
      }> = JSON.parse(timelineJson);

      const labelEvent = events
        .filter(
          (e) => e.event === "labeled" && e.label?.name === DUPLICATE_LABEL
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .pop(); // earliest label event

      labeledAt = labelEvent?.created_at ?? null;
    } catch {
      // Fallback: use issue's updated_at
      labeledAt = issue.updated_at;
    }

    const days = labeledAt ? daysSince(labeledAt) : 0;

    if (days >= GRACE_PERIOD_DAYS) {
      if (!dryRun) {
        ghExec(
          `issue close ${issue.number} --repo ${repo} --reason "not_planned"`
        );
        postComment(
          repo,
          issue.number,
          `🔒 This issue has been automatically closed as a duplicate after the ${GRACE_PERIOD_DAYS}-day grace period.\n\nIf you believe this is NOT a duplicate, please reopen with additional context explaining the difference.\n\n_Closed automatically by the AETHER issue automation system._`
        );
      }
      results.push({
        issueNumber: issue.number,
        action: "closed",
        daysSinceLabeled: days,
        reason: `Grace period expired (${days} days since labeled)`,
      });
      console.log(`Closed duplicate #${issue.number} after ${days} days`);
    } else {
      results.push({
        issueNumber: issue.number,
        action: "skipped",
        daysSinceLabeled: days,
        reason: `Grace period active (${days}/${GRACE_PERIOD_DAYS} days)`,
      });
    }

    await sleep(100);
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

  console.log(`Running grace closer on ${repo}${dryRun ? " (dry run)" : ""}...`);
  const results = await runGraceCloser(repo, dryRun);

  const closed = results.filter((r) => r.action === "closed").length;
  const skipped = results.filter((r) => r.action === "skipped").length;
  console.log(`Done: ${closed} closed, ${skipped} skipped`);

  appendStepSummary(`## 🔒 Grace Period Closer
| Action | Count |
|--------|-------|
| Closed (duplicate) | ${closed} |
| Skipped (grace active) | ${skipped} |

${dryRun ? "> ⚠️ Dry run — no changes made" : ""}

### Details
${results
  .map((r) => `- #${r.issueNumber}: ${r.action} — ${r.reason}`)
  .join("\n")}
`);
}
