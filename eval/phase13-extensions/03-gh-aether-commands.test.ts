// Phase 13.03: gh-aether CLI Extension Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("13.03.1", "gh-aether — script exists and is executable", async () => {
    const scriptPath = join(ROOT, "gh-aether/gh-aether");
    const exists = existsSync(scriptPath);
    let content = "";
    if (exists) content = readFileSync(scriptPath, "utf-8");
    const hasBash = content.includes("#!/usr/bin/env bash");
    return {
      score: exists && hasBash ? 10 : exists ? 7 : 0,
      maxScore: 10,
      details: `exists=${exists} hasBash=${hasBash}`,
    };
  });

  await harness.runTest("13.03.2", "gh-aether — manifest.yml exists with required fields", async () => {
    const manifestPath = join(ROOT, "gh-aether/manifest.yml");
    const exists = existsSync(manifestPath);
    let content = "";
    if (exists) content = readFileSync(manifestPath, "utf-8");
    const hasName = content.includes("name:");
    const hasDesc = content.includes("description:");
    return {
      score: exists && hasName && hasDesc ? 10 : exists ? 5 : 0,
      maxScore: 10,
      details: `exists=${exists} hasName=${hasName} hasDesc=${hasDesc}`,
    };
  });

  await harness.runTest("13.03.3", "gh-aether — script has pr-review command", async () => {
    const scriptPath = join(ROOT, "gh-aether/gh-aether");
    const content = existsSync(scriptPath) ? readFileSync(scriptPath, "utf-8") : "";
    const hasPrReview = content.includes("pr-review") || content.includes("pr_review");
    const usesGhPr = content.includes("gh pr");
    return {
      score: hasPrReview && usesGhPr ? 10 : hasPrReview ? 7 : 0,
      maxScore: 10,
      details: `hasPrReview=${hasPrReview} usesGhPr=${usesGhPr}`,
    };
  });

  await harness.runTest("13.03.4", "gh-aether — script has issue-plan command", async () => {
    const scriptPath = join(ROOT, "gh-aether/gh-aether");
    const content = existsSync(scriptPath) ? readFileSync(scriptPath, "utf-8") : "";
    const hasIssuePlan = content.includes("issue-plan") || content.includes("issue_plan");
    const usesArchitect = content.includes("system-architect") || content.includes("architect");
    return {
      score: hasIssuePlan && usesArchitect ? 10 : hasIssuePlan ? 7 : 0,
      maxScore: 10,
      details: `hasIssuePlan=${hasIssuePlan} usesArchitect=${usesArchitect}`,
    };
  });
}
