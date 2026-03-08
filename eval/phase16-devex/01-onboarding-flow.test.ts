// Phase 16.01: Onboarding Flow Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");
const CLI = join(ROOT, "bin/aether.ts");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("16.01.1", "Onboarding — aether init creates .aether/", async () => {
    const tmpDir = join(import.meta.dir, ".onboard-tmp");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const proc = Bun.spawn(["bun", "run", CLI, "init"], { cwd: tmpDir, stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      const aetherDir = join(tmpDir, ".aether");
      const created = existsSync(aetherDir);
      return {
        score: created ? 10 : 0,
        maxScore: 10,
        details: `.aether/ created: ${created}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("16.01.2", "Onboarding — aether scan returns workspace profile", async () => {
    const proc = Bun.spawn(["bun", "run", CLI, "scan"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const output = await new Response(proc.stdout).text();
    const hasBun = output.toLowerCase().includes("bun");
    const hasTs = output.toLowerCase().includes("typescript") || output.toLowerCase().includes("ts");
    return {
      score: hasBun || hasTs ? 10 : output.length > 10 ? 7 : 0,
      maxScore: 10,
      details: `scan output length=${output.length} hasBun=${hasBun} hasTs=${hasTs}`,
    };
  });

  await harness.runTest("16.01.3", "Onboarding — aether status shows info", async () => {
    const proc = Bun.spawn(["bun", "run", CLI, "status"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const output = await new Response(proc.stdout).text();
    const hasInfo = output.toLowerCase().includes("agent") || output.toLowerCase().includes("runtime") || output.toLowerCase().includes("status");
    return {
      score: hasInfo ? 10 : output.length > 5 ? 7 : 0,
      maxScore: 10,
      details: `status output relevant: ${hasInfo}`,
    };
  });
}
