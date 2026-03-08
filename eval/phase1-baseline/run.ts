// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 1: Baseline Environment Checks
//
// Validates that the runtime, dependencies, configuration,
// storage layer, agent registry, and existing test suites
// are all healthy before deeper evaluation phases run.
// ─────────────────────────────────────────────────────────────

import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TestHarness, writeReport } from "../helpers/test-harness.ts";
import type { PhaseReport } from "../helpers/test-harness.ts";

const ROOT = join(import.meta.dir, "../..");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Recursively collect all files matching a predicate under `dir`. */
function walkDir(dir: string, predicate: (name: string) => boolean): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, predicate));
    } else if (predicate(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Spawn a subprocess via Bun.spawn, capture its stdout/stderr,
 * and resolve with exit code + output. Rejects on timeout.
 */
async function spawnWithTimeout(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { cwd = ROOT, timeoutMs = 60_000 } = opts;

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  // Race the process against a timeout
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      proc.kill();
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Allow the timer to be cleaned up if the process exits first
    proc.exited.then(() => clearTimeout(id));
  });

  const [exitCode, stdoutBuf, stderrBuf] = await Promise.race([
    Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]),
    timeout.then(() => {
      // This branch only runs if timeout fires first
      throw new Error(`Process timed out after ${timeoutMs}ms`);
    }),
  ]);

  return {
    exitCode,
    stdout: stdoutBuf,
    stderr: stderrBuf,
  };
}

/**
 * Compare two semver strings (major.minor.patch).
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function semverCompare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// Phase 1 runner
// ─────────────────────────────────────────────────────────────

export async function run(): Promise<PhaseReport> {
  const harness = new TestHarness("Phase 1 — Baseline Environment");
  harness.start();

  // ── 1.1  Bun version ────────────────────────────────────────
  await harness.runTest("1.1", "Bun version >= 1.1.0", async () => {
    const version = Bun.version; // e.g. "1.1.38"
    const ok = semverCompare(version, "1.1.0") >= 0;
    if (!ok) {
      throw new Error(
        `Bun version ${version} is below the minimum required 1.1.0`,
      );
    }
    return {
      details: `Bun ${version} detected`,
      metadata: { version },
    };
  });

  // ── 1.2  Critical dependencies ──────────────────────────────
  await harness.runTest("1.2", "Critical dependencies present", async () => {
    const deps = ["msgpackr", "sqlite-vec"];
    const missing: string[] = [];
    const found: string[] = [];

    for (const dep of deps) {
      const depPath = join(ROOT, "node_modules", dep);
      if (existsSync(depPath)) {
        found.push(dep);
      } else {
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing dependencies: ${missing.join(", ")}`);
    }

    return {
      details: `All critical dependencies found: ${found.join(", ")}`,
      metadata: { found, missing },
    };
  });

  // ── 1.3  Config exists ──────────────────────────────────────
  await harness.runTest("1.3", "Config file exists", async () => {
    const configPath = join(ROOT, ".aether", "config.json");
    if (!existsSync(configPath)) {
      throw new Error(`Config not found at ${configPath}`);
    }
    return {
      details: `Found .aether/config.json`,
      metadata: { path: configPath },
    };
  });

  // ── 1.4  SQLiteStore boot ───────────────────────────────────
  await harness.runTest("1.4", "SQLiteStore boots in-memory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
    try {
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");
      const store = new SQLiteStore(tempDir);
      await store.init();
      await store.close();
      return {
        details:
          "SQLiteStore constructed, initialized, and closed without error",
        metadata: { tempDir },
      };
    } finally {
      // Clean up temp directory regardless of outcome
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  });

  // ── 1.5  Agent discovery ────────────────────────────────────
  await harness.runTest("1.5", "Agent definition discovery", async () => {
    const agentsDir = join(ROOT, "agents");
    const agentFiles = walkDir(agentsDir, (name) => name.endsWith(".agent.md"));
    const count = agentFiles.length;

    if (count === 0) {
      throw new Error(`No .agent.md files found under ${agentsDir}`);
    }

    return {
      score: count,
      maxScore: count, // All discovered agents count as the full score
      details: `Discovered ${count} agent definition(s) under agents/`,
      metadata: {
        count,
        files: agentFiles.map((f) => f.replace(ROOT + "/", "")),
      },
    };
  });

  // ── 1.6  Existing unit tests ────────────────────────────────
  await harness.runTest("1.6", "Existing unit tests pass", async () => {
    const { exitCode, stdout, stderr } = await spawnWithTimeout(
      ["bun", "test"],
      { timeoutMs: 120_000 },
    );

    const combined = stdout + "\n" + stderr;

    // Parse bun test output for pass/fail counts
    // Bun test output typically includes lines like: "42 pass", "0 fail"
    const passMatch = combined.match(/(\d+)\s+pass/i);
    const failMatch = combined.match(/(\d+)\s+fail/i);

    const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failCount = failMatch ? parseInt(failMatch[1], 10) : 0;

    if (exitCode !== 0) {
      throw new Error(
        `bun test exited with code ${exitCode}. ` +
          `Parsed: ${passCount} pass, ${failCount} fail.\n` +
          `Output (last 500 chars): ${combined.slice(-500)}`,
      );
    }

    return {
      score: passCount,
      maxScore: passCount + failCount || passCount || 1,
      details: `bun test passed (exit 0). ${passCount} pass, ${failCount} fail.`,
      metadata: { exitCode, passCount, failCount },
    };
  });

  // ── 1.7  Simulation test ────────────────────────────────────
  await harness.runTest("1.7", "Simulation test passes", async () => {
    const scriptPath = join(ROOT, "tests", "simulation.ts");
    if (!existsSync(scriptPath)) {
      throw new Error(`Simulation script not found at ${scriptPath}`);
    }

    const { exitCode, stdout, stderr } = await spawnWithTimeout(
      ["bun", "run", scriptPath],
      { timeoutMs: 120_000 },
    );

    if (exitCode !== 0) {
      const output = (stdout + "\n" + stderr).trim();
      throw new Error(
        `Simulation exited with code ${exitCode}.\n` +
          `Output (last 500 chars): ${output.slice(-500)}`,
      );
    }

    return {
      details: `Simulation completed successfully (exit 0)`,
      metadata: { exitCode },
    };
  });

  // ── 1.8  E2E executor ──────────────────────────────────────
  await harness.runTest("1.8", "E2E executor test passes", async () => {
    const scriptPath = join(ROOT, "tests", "e2e-executor.ts");
    if (!existsSync(scriptPath)) {
      throw new Error(`E2E executor script not found at ${scriptPath}`);
    }

    const { exitCode, stdout, stderr } = await spawnWithTimeout(
      ["bun", "run", scriptPath],
      { timeoutMs: 120_000 },
    );

    if (exitCode !== 0) {
      const output = (stdout + "\n" + stderr).trim();
      throw new Error(
        `E2E executor exited with code ${exitCode}.\n` +
          `Output (last 500 chars): ${output.slice(-500)}`,
      );
    }

    return {
      details: `E2E executor completed successfully (exit 0)`,
      metadata: { exitCode },
    };
  });

  // ── Generate report ────────────────────────────────────────
  const report = harness.getReport();
  const markdown = harness.generateMarkdown(report);
  const reportDir = join(ROOT, "eval", "phase1-baseline");
  await writeReport(reportDir, markdown, report);

  console.log(`\nReport written to ${reportDir}/REPORT.md`);

  return report;
}

// ─────────────────────────────────────────────────────────────
// Allow direct execution:  bun run eval/phase1-baseline/run.ts
// ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  run()
    .then((r) => {
      const ok = r.failed === 0 && r.errors === 0;
      console.log(
        `\nPhase 1 complete: ${r.passed}/${r.totalTests} passed` +
          (ok ? "" : ` (${r.failed} failed, ${r.errors} errors)`),
      );
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal error running Phase 1:", err);
      process.exit(2);
    });
}
