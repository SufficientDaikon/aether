/**
 * Dispute handler — listens for 👎 reactions or dispute comments to remove duplicate label
 *
 * Usage (standalone):
 *   ISSUE_NUMBER=42 REPO=owner/repo bun run scripts/issue-automation/dispute-handler.ts
 */

import type { Reaction } from "./types.ts";
import {
  removeLabel,
  addLabels,
  postComment,
  ghExec,
  appendStepSummary,
} from "./utils.ts";

const DUPLICATE_LABEL = "duplicate";
const THUMBS_DOWN = "-1";

interface ReactionResponse {
  content: string;
  user: { login: string };
}

export interface DisputeResult {
  disputed: boolean;
  reason: string;
  issueNumber: number;
}

export async function checkForDispute(
  issueNumber: number,
  repo: string
): Promise<DisputeResult> {
  const [owner, repoName] = repo.split("/");

  // Check if issue has duplicate label
  const issueJson = ghExec(
    `issue view ${issueNumber} --repo ${repo} --json labels,comments`
  );
  const issue: { labels: Array<{ name: string }>; comments: Array<{ body: string; authorAssociation: string }> } =
    JSON.parse(issueJson);

  const hasDuplicateLabel = issue.labels.some((l) => l.name === DUPLICATE_LABEL);
  if (!hasDuplicateLabel) {
    return { disputed: false, reason: "No duplicate label", issueNumber };
  }

  // Check for 👎 reactions on the duplicate detection comment
  const commentsJson = ghExec(
    `api repos/${owner}/${repoName}/issues/${issueNumber}/comments`
  );
  const comments: Array<{ id: number; body: string; author_association: string }> =
    JSON.parse(commentsJson);

  // Find the duplicate detection comment (bot comment with specific marker)
  const dupComment = comments.find((c) =>
    c.body.includes("Duplicate Issue Detected") &&
    c.body.includes("AETHER issue automation system")
  );

  if (dupComment) {
    // Check reactions on that comment
    const reactionsJson = ghExec(
      `api repos/${owner}/${repoName}/issues/comments/${dupComment.id}/reactions`
    );
    const reactions: ReactionResponse[] = JSON.parse(reactionsJson);
    const thumbsDown = reactions.find((r) => r.content === THUMBS_DOWN);

    if (thumbsDown) {
      return {
        disputed: true,
        reason: `👎 reaction from @${thumbsDown.user.login}`,
        issueNumber,
      };
    }
  }

  // Check for dispute comment keywords
  const disputeKeywords = [
    "not a duplicate",
    "not duplicate",
    "different issue",
    "different problem",
    "dispute",
    "disputing",
  ];

  const hasDisputeComment = issue.comments.some((c) => {
    if (["MEMBER", "OWNER", "COLLABORATOR"].includes(c.authorAssociation)) {
      return true; // Maintainer override always counts
    }
    const lower = c.body.toLowerCase();
    return disputeKeywords.some((kw) => lower.includes(kw));
  });

  if (hasDisputeComment) {
    return {
      disputed: true,
      reason: "Dispute comment found",
      issueNumber,
    };
  }

  return { disputed: false, reason: "No dispute signals found", issueNumber };
}

export async function resolveDispute(
  issueNumber: number,
  disputeResult: DisputeResult,
  repo: string
): Promise<void> {
  if (!disputeResult.disputed) return;

  // Remove duplicate label
  removeLabel(repo, issueNumber, DUPLICATE_LABEL);

  // Add pending-maintainer-response for human review
  addLabels(repo, issueNumber, ["pending-maintainer-response"]);

  postComment(
    repo,
    issueNumber,
    `🔄 **Duplicate Label Removed**

The duplicate classification for this issue has been disputed.

**Reason:** ${disputeResult.reason}

A maintainer will review this issue to determine if it is truly a duplicate.

_Dispute resolved automatically by the AETHER issue automation system._`
  );

  console.log(
    `Dispute resolved for issue #${issueNumber}: ${disputeResult.reason}`
  );
}

export async function scanForDisputes(repo: string): Promise<{
  checked: number;
  disputed: number;
}> {
  // Find all open issues with duplicate label
  const issuesJson = ghExec(
    `issue list --repo ${repo} --state open --label "${DUPLICATE_LABEL}" --limit 100 --json number`
  );
  const issues: Array<{ number: number }> = JSON.parse(issuesJson);

  let disputed = 0;

  for (const issue of issues) {
    const result = await checkForDispute(issue.number, repo);
    if (result.disputed) {
      await resolveDispute(issue.number, result, repo);
      disputed++;
    }
  }

  return { checked: issues.length, disputed };
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  const issueNumberEnv = process.env.ISSUE_NUMBER;
  if (!repo) {
    console.error("REPO environment variable required");
    process.exit(1);
  }

  if (issueNumberEnv) {
    // Single issue check
    const issueNumber = parseInt(issueNumberEnv, 10);
    const result = await checkForDispute(issueNumber, repo);
    if (result.disputed) {
      await resolveDispute(issueNumber, result, repo);
    }
    console.log(JSON.stringify(result, null, 2));
    appendStepSummary(`## 🔄 Dispute Check — #${issueNumber}
| Field | Value |
|-------|-------|
| Disputed | ${result.disputed ? "✅ Yes" : "❌ No"} |
| Reason | ${result.reason} |
`);
  } else {
    // Scan all
    const stats = await scanForDisputes(repo);
    console.log(JSON.stringify(stats, null, 2));
    appendStepSummary(`## 🔄 Dispute Scan
| Metric | Count |
|--------|-------|
| Issues Checked | ${stats.checked} |
| Disputes Resolved | ${stats.disputed} |
`);
  }
}
