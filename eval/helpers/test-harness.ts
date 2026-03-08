// ─────────────────────────────────────────────────────────────
// AETHER Eval — Test Harness
// Unified test runner, result collector, and report generator
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";

export type TestStatus = "pass" | "fail" | "skip" | "error";

export interface TestResult {
  id: string;
  name: string;
  phase: string;
  status: TestStatus;
  durationMs: number;
  score?: number;
  maxScore?: number;
  details: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface PhaseReport {
  phase: string;
  startedAt: string;
  completedAt: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  totalScore: number;
  maxPossibleScore: number;
  results: TestResult[];
}

export class TestHarness {
  private results: TestResult[] = [];
  private phase: string;
  private startTime = 0;

  constructor(phase: string) {
    this.phase = phase;
  }

  start(): void {
    this.startTime = Date.now();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  PHASE: ${this.phase}`);
    console.log(`${"=".repeat(60)}\n`);
  }

  async runTest(
    id: string,
    name: string,
    fn: () => Promise<{
      score?: number;
      maxScore?: number;
      details: string;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<TestResult> {
    const testStart = Date.now();
    let result: TestResult;

    try {
      const outcome = await fn();
      const durationMs = Date.now() - testStart;
      let status: TestStatus;
      if (outcome.score !== undefined && outcome.maxScore !== undefined) {
        status = outcome.score >= outcome.maxScore * 0.5 ? "pass" : "fail";
      } else {
        status = "pass";
      }

      result = {
        id,
        name,
        phase: this.phase,
        status,
        durationMs,
        score: outcome.score,
        maxScore: outcome.maxScore,
        details: outcome.details,
        metadata: outcome.metadata,
      };
    } catch (err) {
      result = {
        id,
        name,
        phase: this.phase,
        status: "error",
        durationMs: Date.now() - testStart,
        details: "Test threw an exception",
        error:
          err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
      };
    }

    this.results.push(result);

    const icon =
      result.status === "pass"
        ? "[PASS]"
        : result.status === "fail"
          ? "[FAIL]"
          : result.status === "skip"
            ? "[SKIP]"
            : "[ERR!]";
    const scoreStr =
      result.score !== undefined ? ` (${result.score}/${result.maxScore})` : "";
    console.log(
      `  ${icon} ${result.id}: ${result.name}${scoreStr} [${result.durationMs}ms]`,
    );
    if (result.error)
      console.log(`         Error: ${result.error.split("\n")[0]}`);

    return result;
  }

  skipTest(id: string, name: string, reason: string): void {
    this.results.push({
      id,
      name,
      phase: this.phase,
      status: "skip",
      durationMs: 0,
      details: reason,
    });
    console.log(`  [SKIP] ${id}: ${name} -- ${reason}`);
  }

  getReport(): PhaseReport {
    return {
      phase: this.phase,
      startedAt: new Date(this.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      totalTests: this.results.length,
      passed: this.results.filter((r) => r.status === "pass").length,
      failed: this.results.filter((r) => r.status === "fail").length,
      skipped: this.results.filter((r) => r.status === "skip").length,
      errors: this.results.filter((r) => r.status === "error").length,
      totalScore: this.results.reduce((sum, r) => sum + (r.score ?? 0), 0),
      maxPossibleScore: this.results.reduce(
        (sum, r) => sum + (r.maxScore ?? 0),
        0,
      ),
      results: this.results,
    };
  }

  generateMarkdown(report?: PhaseReport): string {
    const r = report ?? this.getReport();
    const lines: string[] = [];

    lines.push(`# ${r.phase} -- Evaluation Report`);
    lines.push("");
    lines.push(`**Run:** ${r.startedAt} to ${r.completedAt}`);
    lines.push(
      `**Results:** ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped, ${r.errors} errors out of ${r.totalTests} tests`,
    );
    if (r.maxPossibleScore > 0) {
      const pct = ((r.totalScore / r.maxPossibleScore) * 100).toFixed(1);
      lines.push(
        `**Score:** ${r.totalScore} / ${r.maxPossibleScore} (${pct}%)`,
      );
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## Results");
    lines.push("");
    lines.push("| # | Test | Status | Score | Duration | Details |");
    lines.push("|---|------|--------|-------|----------|---------|");

    for (const t of r.results) {
      const scoreStr =
        t.score !== undefined ? `${t.score}/${t.maxScore}` : "--";
      const statusLabel =
        t.status === "pass"
          ? "PASS"
          : t.status === "fail"
            ? "FAIL"
            : t.status === "skip"
              ? "SKIP"
              : "ERROR";
      const detail = (t.error ?? t.details)
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ")
        .slice(0, 120);
      lines.push(
        `| ${t.id} | ${t.name} | ${statusLabel} | ${scoreStr} | ${t.durationMs}ms | ${detail} |`,
      );
    }

    const errored = r.results.filter((t) => t.error);
    if (errored.length > 0) {
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push("## Error Details");
      for (const t of errored) {
        lines.push("");
        lines.push(`### ${t.id}: ${t.name}`);
        lines.push("```");
        lines.push(t.error!);
        lines.push("```");
      }
    }

    return lines.join("\n");
  }
}

export async function writeReport(
  dir: string,
  content: string,
  report?: PhaseReport,
): Promise<void> {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await Bun.write(`${dir}/REPORT.md`, content);
  if (report) {
    await Bun.write(`${dir}/report.json`, JSON.stringify(report, null, 2));
  }
}
