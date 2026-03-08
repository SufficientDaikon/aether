// ─────────────────────────────────────────────────────────────
// Phase 8.02: CLI Command Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const CLI = join(ROOT, "bin/aether.ts");

async function runCli(
  args: string[],
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  clearTimeout(timer);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("8.02.1", "CLI — version", async () => {
    const { stdout, exitCode } = await runCli(["version"]);
    const ok = /\d+\.\d+/.test(stdout) || stdout.includes("AETHER");
    return {
      score: ok ? 10 : 0,
      maxScore: 10,
      details: `exit=${exitCode} out=${stdout.trim().slice(0, 80)}`,
    };
  });

  await harness.runTest("8.02.2", "CLI — help", async () => {
    const { stdout } = await runCli(["help"]);
    const ok =
      stdout.toLowerCase().includes("usage") ||
      stdout.toLowerCase().includes("command") ||
      stdout.includes("aether");
    return {
      score: ok ? 10 : 0,
      maxScore: 10,
      details: `len=${stdout.length} hasUsage=${ok}`,
    };
  });

  await harness.runTest("8.02.3", "CLI — status", async () => {
    const { stdout, exitCode } = await runCli(["status"]);
    return {
      score: stdout.length > 10 ? 10 : 0,
      maxScore: 10,
      details: `exit=${exitCode} out=${stdout.trim().slice(0, 120)}`,
    };
  });

  await harness.runTest("8.02.4", "CLI — registry", async () => {
    const { stdout } = await runCli(["registry"]);
    const ok =
      stdout.includes("cortex") ||
      stdout.includes("agent") ||
      stdout.includes("master");
    return {
      score: ok ? 10 : 0,
      maxScore: 10,
      details: `hasAgents=${ok} len=${stdout.length}`,
    };
  });

  await harness.runTest("8.02.5", "CLI — scan", async () => {
    const { stdout } = await runCli(["scan"]);
    return {
      score: stdout.length > 5 ? 10 : 0,
      maxScore: 10,
      details: `out=${stdout.trim().slice(0, 120)}`,
    };
  });

  await harness.runTest("8.02.6", "CLI — config get", async () => {
    const { stdout } = await runCli(["config", "get", "execution.maxDepth"]);
    return {
      score: stdout.trim().length > 0 ? 10 : 0,
      maxScore: 10,
      details: `val=${stdout.trim().slice(0, 80)}`,
    };
  });

  await harness.runTest("8.02.7", "CLI — unknown command", async () => {
    const { stdout, stderr, exitCode } = await runCli(["nonexistent-xyz"]);
    const out = stdout + stderr;
    const ok =
      exitCode !== 0 ||
      out.toLowerCase().includes("unknown") ||
      out.toLowerCase().includes("error");
    return { score: ok ? 10 : 5, maxScore: 10, details: `exit=${exitCode}` };
  });
}
