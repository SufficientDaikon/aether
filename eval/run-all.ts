#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// AETHER Eval — Master Runner
// Runs all 17 evaluation phases sequentially
// Config backup → Phase 1-17 → Config restore → Final report
// ─────────────────────────────────────────────────────────────

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { RateLimiter } from "./helpers/rate-limiter.ts";
import { CostTracker } from "./helpers/cost-tracker.ts";
import { GeminiWrapper } from "./helpers/gemini-wrapper.ts";
import type { PhaseReport } from "./helpers/test-harness.ts";

const ROOT = join(import.meta.dir, "..");
const EVAL_DIR = import.meta.dir;

// ── API Keys ─────────────────────────────────────────────
const GEMMA_KEY = "AIzaSyBIGzJRnPT18pDn-KrKYtLLg5ij2mxsAI4";
const BUN_KEY = "AIzaSyDSEX3B27CNlWHaMOvu2U4ZQ1Ro-tYE2u8";

// ── Step 0: Config Backup & Update ───────────────────────
const configPath = join(ROOT, ".aether", "config.json");
const providersPath = join(ROOT, ".aether", "providers.json");
const backupDir = join(EVAL_DIR, ".config-backup");

function backupConfig(): void {
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  if (existsSync(configPath))
    copyFileSync(configPath, join(backupDir, "config.json"));
  if (existsSync(providersPath))
    copyFileSync(providersPath, join(backupDir, "providers.json"));
  console.log("[Setup] Config backed up to eval/.config-backup/");
}

function updateConfig(): void {
  const geminiProviders = {
    master: { provider: "gemini", model: "gemini-2.5-pro" },
    manager: { provider: "gemini", model: "gemini-2.5-pro" },
    worker: { provider: "gemini", model: "gemini-2.5-flash" },
    fallbackChain: [{ provider: "gemini", model: "gemini-2.5-flash" }],
  };

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.providers = geminiProviders;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch {
      console.warn(
        "[Setup] Could not update config.json, creating minimal version",
      );
      writeFileSync(
        configPath,
        JSON.stringify(
          { version: "0.1.0", providers: geminiProviders },
          null,
          2,
        ),
      );
    }
  }
  writeFileSync(providersPath, JSON.stringify(geminiProviders, null, 2));
  console.log("[Setup] Config updated to use Gemini for all tiers");
}

function restoreConfig(): void {
  const backupConfig = join(backupDir, "config.json");
  const backupProviders = join(backupDir, "providers.json");
  if (existsSync(backupConfig)) copyFileSync(backupConfig, configPath);
  if (existsSync(backupProviders)) copyFileSync(backupProviders, providersPath);
  console.log("[Cleanup] Config restored from backup");
}

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  AETHER COMPREHENSIVE EVALUATION SUITE");
  console.log("  " + new Date().toISOString());
  console.log("=".repeat(60) + "\n");

  // Setup
  backupConfig();
  updateConfig();
  process.env.GOOGLE_AI_KEY = GEMMA_KEY;

  // Initialize shared helpers for API phases
  const rateLimiter = new RateLimiter({
    maxRequestsPerMinute: 8,
    minIntervalMs: 7_500,
  });
  const costTracker = new CostTracker({
    gemmaKey: GEMMA_KEY,
    bunKey: BUN_KEY,
    budgetLimit: 70,
    switchThreshold: 0.9,
  });
  const gemini = new GeminiWrapper(rateLimiter, costTracker);

  const allReports: PhaseReport[] = [];
  const phaseTimings: Array<{ phase: string; durationMs: number }> = [];

  try {
    // ── Phase 1: Baseline ────────────────────────────────
    {
      console.log("\n>>> Starting Phase 1: Baseline...\n");
      const start = Date.now();
      try {
        const phase1 = await import("./phase1-baseline/run.ts");
        allReports.push(await phase1.run());
      } catch (err) {
        console.error("Phase 1 failed:", err);
        allReports.push(makeEmptyReport("Phase 1: Baseline", err));
      }
      phaseTimings.push({ phase: "Phase 1", durationMs: Date.now() - start });
    }

    // ── Phase 2: Subsystem Unit Tests ────────────────────
    {
      console.log("\n>>> Starting Phase 2: Subsystem Tests...\n");
      const start = Date.now();
      try {
        const phase2 = await import("./phase2-subsystems/run-all.ts");
        allReports.push(await phase2.run());
      } catch (err) {
        console.error("Phase 2 failed:", err);
        allReports.push(makeEmptyReport("Phase 2: Subsystem Unit Tests", err));
      }
      phaseTimings.push({ phase: "Phase 2", durationMs: Date.now() - start });
    }

    // ── Phase 3: Protocol & Transport ────────────────────
    {
      console.log("\n>>> Starting Phase 3: Protocol...\n");
      const start = Date.now();
      try {
        const phase3 = await import("./phase3-protocol/run-all.ts");
        allReports.push(await phase3.run());
      } catch (err) {
        console.error("Phase 3 failed:", err);
        allReports.push(makeEmptyReport("Phase 3: Protocol & Transport", err));
      }
      phaseTimings.push({ phase: "Phase 3", durationMs: Date.now() - start });
    }

    // ── Phase 4: DSL Compilation ─────────────────────────
    {
      console.log("\n>>> Starting Phase 4: DSL...\n");
      const start = Date.now();
      try {
        const phase4 = await import("./phase4-dsl/run-all.ts");
        allReports.push(await phase4.run());
      } catch (err) {
        console.error("Phase 4 failed:", err);
        allReports.push(makeEmptyReport("Phase 4: DSL Compilation", err));
      }
      phaseTimings.push({ phase: "Phase 4", durationMs: Date.now() - start });
    }

    // ── Phase 5: Functional (Live Gemini) ────────────────
    {
      console.log("\n>>> Starting Phase 5: Functional (Live Gemini API)...\n");

      // Update env key in case cost tracker switched keys
      process.env.GOOGLE_AI_KEY = costTracker.getActiveKey();

      const start = Date.now();
      try {
        const phase5 = await import("./phase5-functional/run-all.ts");
        allReports.push(await phase5.run(gemini, costTracker));
      } catch (err) {
        console.error("Phase 5 failed:", err);
        allReports.push(
          makeEmptyReport("Phase 5: Functional (Live Gemini)", err),
        );
      }
      phaseTimings.push({ phase: "Phase 5", durationMs: Date.now() - start });
    }

    // ── Phase 6: Stress Tests ────────────────────────────
    {
      console.log("\n>>> Starting Phase 6: Stress Tests...\n");
      const start = Date.now();
      try {
        const phase6 = await import("./phase6-stress/run-all.ts");
        allReports.push(await phase6.run());
      } catch (err) {
        console.error("Phase 6 failed:", err);
        allReports.push(makeEmptyReport("Phase 6: Stress Tests", err));
      }
      phaseTimings.push({ phase: "Phase 6", durationMs: Date.now() - start });
    }

    // ── Phase 7: Feature Matrix & Final Report ───────────
    {
      console.log("\n>>> Generating Phase 7: Final Report...\n");
      const start = Date.now();
      try {
        const phase7 = await import("./phase7-feature-matrix/generate.ts");
        allReports.push(await phase7.run(allReports));
      } catch (err) {
        console.error("Phase 7 failed:", err);
      }
      phaseTimings.push({ phase: "Phase 7", durationMs: Date.now() - start });
    }

    // ── Phase 8: Extended Coverage ─────────────────────────
    {
      console.log("\n>>> Starting Phase 8: Extended Coverage...\n");
      const start = Date.now();
      try {
        const phase8 = await import("./phase8-extended-coverage/run-all.ts");
        allReports.push(await phase8.run());
      } catch (err) {
        console.error("Phase 8 failed:", err);
        allReports.push(makeEmptyReport("Phase 8: Extended Coverage", err));
      }
      phaseTimings.push({ phase: "Phase 8", durationMs: Date.now() - start });
    }

    // ── Phase 9: Multi-Provider Support ────────────────────
    {
      console.log("\n>>> Starting Phase 9: Multi-Provider Support...\n");
      const start = Date.now();
      try {
        const phase9 = await import("./phase9-providers/run-all.ts");
        allReports.push(await phase9.run());
      } catch (err) {
        console.error("Phase 9 failed:", err);
        allReports.push(makeEmptyReport("Phase 9: Multi-Provider Support", err));
      }
      phaseTimings.push({ phase: "Phase 9", durationMs: Date.now() - start });
    }

    // ── Phase 10: Performance Profiling ────────────────────
    {
      console.log("\n>>> Starting Phase 10: Performance Profiling...\n");
      const start = Date.now();
      try {
        const phase10 = await import("./phase10-performance/run-all.ts");
        allReports.push(await phase10.run());
      } catch (err) {
        console.error("Phase 10 failed:", err);
        allReports.push(makeEmptyReport("Phase 10: Performance Profiling", err));
      }
      phaseTimings.push({ phase: "Phase 10", durationMs: Date.now() - start });
    }

    // ── Phase 11: Integration Testing ─────────────────────
    {
      console.log("\n>>> Starting Phase 11: Integration Testing...\n");
      const start = Date.now();
      try {
        const phase11 = await import("./phase11-integration/run-all.ts");
        allReports.push(await phase11.run());
      } catch (err) {
        console.error("Phase 11 failed:", err);
        allReports.push(makeEmptyReport("Phase 11: Integration Testing", err));
      }
      phaseTimings.push({ phase: "Phase 11", durationMs: Date.now() - start });
    }

    // ── Phase 12: Quality Benchmarks ──────────────────────
    {
      console.log("\n>>> Starting Phase 12: Quality Benchmarks...\n");
      const start = Date.now();
      try {
        const phase12 = await import("./phase12-quality/run-all.ts");
        allReports.push(await phase12.run());
      } catch (err) {
        console.error("Phase 12 failed:", err);
        allReports.push(makeEmptyReport("Phase 12: Quality Benchmarks", err));
      }
      phaseTimings.push({ phase: "Phase 12", durationMs: Date.now() - start });
    }

    // ── Phase 13: Extension Validation ────────────────────
    {
      console.log("\n>>> Starting Phase 13: Extension Validation...\n");
      const start = Date.now();
      try {
        const phase13 = await import("./phase13-extensions/run-all.ts");
        allReports.push(await phase13.run());
      } catch (err) {
        console.error("Phase 13 failed:", err);
        allReports.push(makeEmptyReport("Phase 13: Extension Validation", err));
      }
      phaseTimings.push({ phase: "Phase 13", durationMs: Date.now() - start });
    }

    // ── Phase 14: Security & Adversarial ──────────────────
    {
      console.log("\n>>> Starting Phase 14: Security & Adversarial...\n");
      const start = Date.now();
      try {
        const phase14 = await import("./phase14-security/run-all.ts");
        allReports.push(await phase14.run());
      } catch (err) {
        console.error("Phase 14 failed:", err);
        allReports.push(makeEmptyReport("Phase 14: Security & Adversarial", err));
      }
      phaseTimings.push({ phase: "Phase 14", durationMs: Date.now() - start });
    }

    // ── Phase 15: Federation & Distributed ────────────────
    {
      console.log("\n>>> Starting Phase 15: Federation & Distributed...\n");
      const start = Date.now();
      try {
        const phase15 = await import("./phase15-federation/run-all.ts");
        allReports.push(await phase15.run());
      } catch (err) {
        console.error("Phase 15 failed:", err);
        allReports.push(makeEmptyReport("Phase 15: Federation & Distributed", err));
      }
      phaseTimings.push({ phase: "Phase 15", durationMs: Date.now() - start });
    }

    // ── Phase 16: Developer Experience ────────────────────
    {
      console.log("\n>>> Starting Phase 16: Developer Experience...\n");
      const start = Date.now();
      try {
        const phase16 = await import("./phase16-devex/run-all.ts");
        allReports.push(await phase16.run());
      } catch (err) {
        console.error("Phase 16 failed:", err);
        allReports.push(makeEmptyReport("Phase 16: Developer Experience", err));
      }
      phaseTimings.push({ phase: "Phase 16", durationMs: Date.now() - start });
    }

    // ── Phase 17: Production Readiness ────────────────────
    {
      console.log("\n>>> Starting Phase 17: Production Readiness...\n");
      const start = Date.now();
      try {
        const phase17 = await import("./phase17-production/run-all.ts");
        allReports.push(await phase17.run());
      } catch (err) {
        console.error("Phase 17 failed:", err);
        allReports.push(makeEmptyReport("Phase 17: Production Readiness", err));
      }
      phaseTimings.push({ phase: "Phase 17", durationMs: Date.now() - start });
    }
  } finally {
    // ── Restore Config ───────────────────────────────────
    restoreConfig();
  }

  // ── Print Summary ──────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  EVALUATION COMPLETE");
  console.log("=".repeat(60));
  console.log("");

  console.log("  Phase Timings:");
  for (const pt of phaseTimings) {
    const secs = (pt.durationMs / 1000).toFixed(1);
    console.log(`    ${pt.phase}: ${secs}s`);
  }
  const totalTime = phaseTimings.reduce((s, p) => s + p.durationMs, 0);
  console.log(`    TOTAL: ${(totalTime / 1000).toFixed(1)}s`);
  console.log("");

  // Cost summary
  const costSummary = costTracker.getSummary();
  console.log("  Cost Summary:");
  console.log(`    Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(
    `    Remaining budget: $${costSummary.remainingBudget.toFixed(2)}`,
  );
  console.log(`    Total API calls: ${costSummary.totalCalls}`);
  console.log(
    `    Total tokens: ${costSummary.totalInputTokens + costSummary.totalOutputTokens}`,
  );
  console.log(`    Active key: ${costSummary.activeKey}`);
  if (Object.keys(costSummary.byModel).length > 0) {
    console.log("    By model:");
    for (const [model, stats] of Object.entries(costSummary.byModel)) {
      console.log(
        `      ${model}: ${stats.calls} calls, ${stats.tokens} tokens, $${stats.cost.toFixed(4)}`,
      );
    }
  }
  console.log("");

  // Test summary
  let tp = 0,
    tf = 0,
    te = 0,
    ts = 0;
  for (const r of allReports) {
    tp += r.passed;
    tf += r.failed;
    te += r.errors;
    ts += r.skipped;
  }
  console.log(
    `  Test Results: ${tp} passed, ${tf} failed, ${te} errors, ${ts} skipped`,
  );
  console.log(`  Reports written to: eval/FINAL-REPORT.md`);
  console.log("\n" + "=".repeat(60) + "\n");
}

function makeEmptyReport(phase: string, err: unknown): PhaseReport {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    phase,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    totalTests: 1,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: 1,
    totalScore: 0,
    maxPossibleScore: 0,
    results: [
      {
        id: "0.0",
        name: `${phase} (fatal)`,
        phase,
        status: "error",
        durationMs: 0,
        details: "Phase failed to execute",
        error: msg,
      },
    ],
  };
}

// ── Entry Point ──────────────────────────────────────────
main().catch((err) => {
  console.error("Fatal error in eval runner:", err);
  restoreConfig();
  process.exit(2);
});
