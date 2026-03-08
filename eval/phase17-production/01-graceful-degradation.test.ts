// Phase 17.01: Graceful Degradation Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("17.01.1", "Degradation — runtime init without API keys", async () => {
    const tmpDir = join(import.meta.dir, ".degrade-tmp1");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { AetherRuntime } = await import(join(ROOT, "core/runtime.ts"));
      const runtime = new AetherRuntime(tmpDir);
      await runtime.init();
      // Should boot even without API keys — providers report unconfigured
      const booted = runtime.registry != null;
      await runtime.shutdown();
      return {
        score: booted ? 10 : 0,
        maxScore: 10,
        details: `runtime booted without API keys: ${booted}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("17.01.2", "Degradation — guardrails work without store", async () => {
    const { createDefaultGuardrails } = await import(join(ROOT, "core/guardrails.ts"));
    const pipeline = createDefaultGuardrails();
    const agent = { id: "test", name: "Test", tier: "worker" } as any;
    const result = pipeline.runPre("normal request", agent);
    return {
      score: result.allowed ? 10 : 0,
      maxScore: 10,
      details: `standalone guardrails work: ${result.allowed}`,
    };
  });

  await harness.runTest("17.01.3", "Degradation — registry works without store", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const registry = new AgentRegistry(); // no store
    registry.register({ id: "deg-test", name: "Test", tier: "worker", capabilities: ["test"], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
    const agent = registry.get("deg-test");
    return {
      score: agent?.id === "deg-test" ? 10 : 0,
      maxScore: 10,
      details: `registry works without store: ${agent?.id}`,
    };
  });

  await harness.runTest("17.01.4", "Degradation — settings manager defaults on missing dir", async () => {
    const tmpDir = join(import.meta.dir, ".degrade-tmp4");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { SettingsManager } = await import(join(ROOT, "core/settings.ts"));
      const mgr = new SettingsManager(tmpDir);
      const settings = mgr.load();
      return {
        score: settings.logging != null ? 10 : 0,
        maxScore: 10,
        details: `defaults loaded from missing path: ${settings.logging != null}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
