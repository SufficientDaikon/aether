/**
 * Spam detector — analyzes comments for spam patterns
 *
 * Usage (standalone):
 *   MODE=single COMMENT_ID=12345 ISSUE_NUMBER=42 REPO=owner/repo bun run scripts/issue-automation/spam-detector.ts
 *   MODE=bulk REPO=owner/repo bun run scripts/issue-automation/spam-detector.ts
 */

import type { Comment, SpamResult, SpamAction } from "./types.ts";
import { LLMClient } from "./llm-client.ts";
import { sanitizeAndDelimit, sanitizeIssueText } from "./sanitizer.ts";
import { withRetry, deleteComment, postComment, ghExec, appendStepSummary, sleep } from "./utils.ts";

const SKIP_ROLES = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);
const AUTO_DELETE_THRESHOLD = 0.85;
const FLAG_THRESHOLD = 0.60;

const SPAM_CATEGORIES = [
  "crypto_scam",
  "telegram_whatsapp_spam",
  "phishing",
  "homoglyph_obfuscation",
  "leetspeak_spam",
  "promotional",
  "off_topic_advertisement",
] as const;

// Audit log path
const AUDIT_LOG_PATH = process.env.SPAM_AUDIT_LOG ?? "/tmp/spam-audit.jsonl";

interface AuditEntry {
  timestamp: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  author: string;
  action: SpamAction;
  confidence: number;
  categories: string[];
  reasoning: string;
}

function writeAuditLog(entry: AuditEntry): void {
  const { appendFileSync } = require("fs");
  try {
    appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    console.error("Failed to write audit log:", e);
  }
}

export async function analyzeComment(
  commentBody: string,
  authorAssociation: string
): Promise<SpamResult> {
  // Skip trusted roles
  if (SKIP_ROLES.has(authorAssociation.toUpperCase())) {
    return { action: "none", confidence: 0, reasoning: "Trusted role", categories: [] };
  }

  const cleanBody = sanitizeIssueText(commentBody, 3000);
  const llm = new LLMClient({ temperature: 0.1, maxTokens: 400 });

  const systemPrompt = `You are a spam detector for a GitHub repository.
Analyze the comment and determine if it is spam.

Spam categories to check:
- crypto_scam: cryptocurrency scams, investment schemes, NFT spam
- telegram_whatsapp_spam: links/invites to Telegram/WhatsApp groups
- phishing: fake login pages, credential harvesting links
- homoglyph_obfuscation: using lookalike characters to hide spam URLs
- leetspeak_spam: using 1337speak to evade filters
- promotional: unsolicited ads/promotions unrelated to the repo
- off_topic_advertisement: irrelevant commercial content

Respond with ONLY valid JSON:
{
  "confidence": 0.0,
  "categories": [],
  "reasoning": "explanation"
}
Where confidence is 0.0 (definitely not spam) to 1.0 (definitely spam).`;

  const userMessage = `Analyze this GitHub comment for spam:
${sanitizeAndDelimit(cleanBody, "comment_body", 3000)}`;

  let raw: string;
  try {
    raw = await withRetry(() =>
      llm.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ])
    );
  } catch (err) {
    console.error("LLM spam analysis failed:", err);
    return { action: "none", confidence: 0, reasoning: "LLM failure", categories: [] };
  }

  let parsed: { confidence: number; categories: string[]; reasoning: string };
  try {
    parsed = llm.parseJSON(raw);
  } catch {
    return { action: "none", confidence: 0, reasoning: "Parse failure", categories: [] };
  }

  const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0));
  const categories = (parsed.categories ?? []).filter((c: string) =>
    SPAM_CATEGORIES.includes(c as (typeof SPAM_CATEGORIES)[number])
  );

  let action: SpamAction;
  if (confidence >= AUTO_DELETE_THRESHOLD) {
    action = "delete";
  } else if (confidence >= FLAG_THRESHOLD) {
    action = "flag";
  } else {
    action = "none";
  }

  return {
    action,
    confidence,
    reasoning: parsed.reasoning ?? "",
    categories,
  };
}

export async function processComment(
  commentId: number,
  commentBody: string,
  authorLogin: string,
  authorAssociation: string,
  issueNumber: number,
  repo: string
): Promise<SpamResult> {
  const result = await analyzeComment(commentBody, authorAssociation);

  if (result.action === "delete") {
    deleteComment(repo, commentId);
    console.log(
      `Deleted spam comment ${commentId} by ${authorLogin} (confidence: ${result.confidence})`
    );
    writeAuditLog({
      timestamp: new Date().toISOString(),
      repo,
      issueNumber,
      commentId,
      author: authorLogin,
      action: "delete",
      confidence: result.confidence,
      categories: result.categories,
      reasoning: result.reasoning,
    });
  } else if (result.action === "flag") {
    const flagComment = `⚠️ **Potential Spam Flagged**

A comment by @${authorLogin} has been flagged for review (confidence: ${(result.confidence * 100).toFixed(0)}%).

Categories: ${result.categories.join(", ") || "general spam"}

A maintainer should review and delete if confirmed spam.`;
    postComment(repo, issueNumber, flagComment);
    console.log(
      `Flagged comment ${commentId} by ${authorLogin} (confidence: ${result.confidence})`
    );
    writeAuditLog({
      timestamp: new Date().toISOString(),
      repo,
      issueNumber,
      commentId,
      author: authorLogin,
      action: "flag",
      confidence: result.confidence,
      categories: result.categories,
      reasoning: result.reasoning,
    });
  }

  return result;
}

export async function bulkScanIssues(repo: string): Promise<{
  scanned: number;
  deleted: number;
  flagged: number;
}> {
  const issuesJson = ghExec(
    `issue list --repo ${repo} --state open --limit 100 --json number`
  );
  const issues: Array<{ number: number }> = JSON.parse(issuesJson);

  let scanned = 0;
  let deleted = 0;
  let flagged = 0;

  for (const issue of issues) {
    const commentsJson = ghExec(
      `issue view ${issue.number} --repo ${repo} --json comments`
    );
    const { comments }: { comments: Comment[] } = JSON.parse(commentsJson);

    for (const comment of comments) {
      if (SKIP_ROLES.has(comment.author_association?.toUpperCase())) continue;
      scanned++;

      const result = await processComment(
        comment.id,
        comment.body,
        comment.user.login,
        comment.author_association,
        issue.number,
        repo
      );

      if (result.action === "delete") deleted++;
      if (result.action === "flag") flagged++;
      await sleep(200); // Rate limit
    }
  }

  return { scanned, deleted, flagged };
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const mode = process.env.MODE ?? "single";
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  if (!repo) {
    console.error("REPO environment variable required");
    process.exit(1);
  }

  if (mode === "bulk") {
    console.log("Running bulk spam scan...");
    const stats = await bulkScanIssues(repo);
    console.log(JSON.stringify(stats, null, 2));
    appendStepSummary(`## 🚨 Bulk Spam Scan
| Metric | Count |
|--------|-------|
| Scanned | ${stats.scanned} |
| Deleted | ${stats.deleted} |
| Flagged | ${stats.flagged} |
`);
  } else {
    const commentId = parseInt(process.env.COMMENT_ID ?? "0", 10);
    const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? "0", 10);
    if (!commentId || !issueNumber) {
      console.error("Usage: MODE=single COMMENT_ID=123 ISSUE_NUMBER=42 REPO=owner/repo bun run spam-detector.ts");
      process.exit(1);
    }

    const commentJson = ghExec(
      `api repos/${repo.replace("/", "/")}/issues/comments/${commentId}`
    );
    const comment: Comment & { body: string } = JSON.parse(commentJson);

    const result = await processComment(
      commentId,
      comment.body,
      comment.user.login,
      comment.author_association,
      issueNumber,
      repo
    );
    console.log(JSON.stringify(result, null, 2));
    appendStepSummary(`## 🚨 Spam Check — Comment ${commentId}
| Field | Value |
|-------|-------|
| Action | ${result.action} |
| Confidence | ${(result.confidence * 100).toFixed(0)}% |
| Categories | ${result.categories.join(", ") || "none"} |
`);
  }
}
