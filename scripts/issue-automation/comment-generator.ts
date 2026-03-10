/**
 * Comment generator — posts friendly acknowledgment on new issues
 *
 * Usage (standalone):
 *   ISSUE_NUMBER=42 REPO=owner/repo bun run scripts/issue-automation/comment-generator.ts
 */

import type { ClassificationResult } from "./types.ts";
import { LLMClient } from "./llm-client.ts";
import { sanitizeAndDelimit, sanitizeIssueText } from "./sanitizer.ts";
import { withRetry, postComment, ghExec, appendStepSummary } from "./utils.ts";

const FALLBACK_COMMENT = `👋 Thanks for opening this issue!

We've received your report and it has been added to our triage queue. A maintainer will review it soon.

**While you wait:**
- Check the [docs](../../docs) for existing workarounds
- Search [existing issues](../../issues) for similar reports
- Review the [ARCHITECTURE.md](../../ARCHITECTURE.md) for system context

_This comment was generated automatically by the AETHER issue automation system._`;

export async function generateComment(
  issueNumber: number,
  title: string,
  body: string,
  classification: ClassificationResult,
  repo: string
): Promise<string> {
  const cleanTitle = sanitizeIssueText(title, 500);
  const cleanBody = sanitizeIssueText(body, 2000);

  let comment: string;

  try {
    const llm = new LLMClient({ temperature: 0.7, maxTokens: 400 });

    const systemPrompt = `You are a friendly GitHub bot for the AETHER multi-agent orchestration framework.
Write a brief, helpful acknowledgment comment for a new issue.
- Be warm and concise (3-5 sentences max)
- Mention what type of issue it seems to be (bug/enhancement/question)
- Suggest checking the docs or existing issues if relevant
- End with a note that maintainers will review soon
- Do NOT make promises about fix timelines
- Use markdown formatting`;

    const userMessage = `New issue received:

${sanitizeAndDelimit(cleanTitle, "issue_title")}
${sanitizeAndDelimit(cleanBody, "issue_body", 2000)}

Classification: ${classification.labels.join(", ")} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`;

    comment = await withRetry(() =>
      llm.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ])
    );

    // Append automation footer
    comment +=
      "\n\n_This comment was generated automatically by the AETHER issue automation system._";
  } catch (err) {
    console.warn("LLM comment generation failed, using fallback:", err);
    comment = FALLBACK_COMMENT;
  }

  postComment(repo, issueNumber, comment);
  console.log(`Comment posted on issue #${issueNumber}`);
  return comment;
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? "0", 10);
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  const labelsEnv = process.env.LABELS ?? "pending-triage,bug";
  if (!issueNumber || !repo) {
    console.error(
      "Usage: ISSUE_NUMBER=42 REPO=owner/repo LABELS=bug,core bun run comment-generator.ts"
    );
    process.exit(1);
  }

  const issueJson = ghExec(
    `issue view ${issueNumber} --repo ${repo} --json title,body`
  );
  const { title, body } = JSON.parse(issueJson);

  const fakeClassification: ClassificationResult = {
    labels: labelsEnv.split(","),
    confidence: 0.9,
    reasoning: "Provided via environment variable",
  };

  const comment = await generateComment(
    issueNumber,
    title,
    body ?? "",
    fakeClassification,
    repo
  );

  appendStepSummary(`## 💬 Comment Posted — #${issueNumber}
${comment.slice(0, 500)}
`);
}
