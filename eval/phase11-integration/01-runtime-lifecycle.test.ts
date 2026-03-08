// Phase 11.01: AetherRuntime Lifecycle Integration Test
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  const tmpDir = join(import.meta.dir, ".integration-tmp");

  function setup() {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
  }
  function cleanup() {
    try { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true }); } catch {}
  }

  await harness.runTest("11.01.1", "Runtime — constructor and init", async () => {
    setup();
    const { AetherRuntime } = await import(join(ROOT, "core/runtime.ts"));
    const runtime = new AetherRuntime(tmpDir);
    await runtime.init();
    const hasRegistry = !!runtime.registry;
    const hasLogger = !!runtime.logger;
    const hasConfig = !!runtime.config;
    await runtime.shutdown();
    cleanup();
    return {
      score: hasRegistry && hasLogger && hasConfig ? 10 : 0,
      maxScore: 10,
      details: `registry=${hasRegistry} logger=${hasLogger} config=${hasConfig}`,
    };
  });

  await harness.runTest("11.01.2", "Runtime — subsystems initialized", async () => {
    setup();
    const { AetherRuntime } = await import(join(ROOT, "core/runtime.ts"));
    const runtime = new AetherRuntime(tmpDir);
    await runtime.init();
    const subsystems = [
      runtime.guardrails != null,
      runtime.schemaValidator != null,
      runtime.pluginRegistry != null,
      runtime.tierRegistry != null,
    ];
    const count = subsystems.filter(Boolean).length;
    await runtime.shutdown();
    cleanup();
    return {
      score: count >= 3 ? 10 : count >= 2 ? 7 : count >= 1 ? 4 : 0,
      maxScore: 10,
      details: `${count}/4 non-store subsystems initialized`,
    };
  });

  await harness.runTest("11.01.3", "Runtime — store-backed subsystems", async () => {
    setup();
    const { AetherRuntime } = await import(join(ROOT, "core/runtime.ts"));
    const runtime = new AetherRuntime(tmpDir);
    await runtime.init();
    const storeSubsystems = [
      runtime.store != null,
      runtime.agentRouter != null,
      runtime.entityMemory != null,
      runtime.conversationManager != null,
      runtime.progressTracker != null,
    ];
    const count = storeSubsystems.filter(Boolean).length;
    await runtime.shutdown();
    cleanup();
    return {
      score: count >= 4 ? 10 : count >= 3 ? 7 : count >= 2 ? 4 : 0,
      maxScore: 10,
      details: `${count}/5 store-backed subsystems initialized`,
    };
  });

  await harness.runTest("11.01.4", "Runtime — clean shutdown", async () => {
    setup();
    const { AetherRuntime } = await import(join(ROOT, "core/runtime.ts"));
    const runtime = new AetherRuntime(tmpDir);
    await runtime.init();
    await runtime.shutdown();
    // After shutdown, server should be null
    const serverCleared = runtime.server === null;
    cleanup();
    return {
      score: serverCleared ? 10 : 0,
      maxScore: 10,
      details: `server cleared after shutdown: ${serverCleared}`,
    };
  });
}
