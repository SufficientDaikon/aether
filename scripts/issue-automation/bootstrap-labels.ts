/**
 * Bootstrap label definitions script
 * Reads .github/labels.json and creates/updates labels in the repo via gh CLI
 *
 * Usage:
 *   REPO=owner/repo bun run scripts/issue-automation/bootstrap-labels.ts
 *   REPO=owner/repo DRY_RUN=true bun run scripts/issue-automation/bootstrap-labels.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { LabelDefinition } from "./types.ts";
import { ghExec, appendStepSummary } from "./utils.ts";

function loadLabels(labelsJsonPath: string): LabelDefinition[] {
  const raw = readFileSync(labelsJsonPath, "utf-8");
  return JSON.parse(raw) as LabelDefinition[];
}

function getExistingLabels(repo: string): string[] {
  const json = ghExec(`label list --repo ${repo} --limit 200 --json name`);
  const labels: Array<{ name: string }> = JSON.parse(json);
  return labels.map((l) => l.name);
}

function createLabel(repo: string, label: LabelDefinition): void {
  ghExec(
    `label create "${label.name}" --repo ${repo} --color "${label.color}" --description "${label.description}" --force`
  );
}

export async function bootstrapLabels(
  repo: string,
  labelsJsonPath: string,
  dryRun: boolean = false
): Promise<{ created: string[]; skipped: string[] }> {
  const labels = loadLabels(labelsJsonPath);
  const existing = getExistingLabels(repo);
  const existingSet = new Set(existing);

  const created: string[] = [];
  const skipped: string[] = [];

  for (const label of labels) {
    if (!dryRun) {
      createLabel(repo, label);
      console.log(
        `${existingSet.has(label.name) ? "Updated" : "Created"} label: ${label.name}`
      );
      created.push(label.name);
    } else {
      console.log(
        `[DRY RUN] Would ${existingSet.has(label.name) ? "update" : "create"} label: ${label.name}`
      );
      skipped.push(label.name);
    }
  }

  return { created, skipped };
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.main) {
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  const dryRun = process.env.DRY_RUN === "true";

  if (!repo) {
    console.error("REPO environment variable required");
    process.exit(1);
  }

  // Look for labels.json relative to the repo root
  const labelsPath =
    process.env.LABELS_JSON_PATH ??
    join(process.cwd(), ".github", "labels.json");

  console.log(`Bootstrapping labels from ${labelsPath} to ${repo}...`);
  const result = await bootstrapLabels(repo, labelsPath, dryRun);

  appendStepSummary(`## 🏷️ Label Bootstrap
| Action | Count |
|--------|-------|
| Created/Updated | ${result.created.length} |
| Skipped (dry run) | ${result.skipped.length} |

${dryRun ? "> ⚠️ Dry run — no changes made" : ""}
`);
}
