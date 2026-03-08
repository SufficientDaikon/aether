// Phase 16.04: Plugin Lifecycle Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("16.04.1", "Plugin — register and list", async () => {
    const { PluginRegistry } = await import(join(ROOT, "core/plugin.ts"));
    const registry = new PluginRegistry(ROOT);
    const plugin = {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      slots: ["pre-execution" as const, "post-execution" as const],
      init: async () => {},
      destroy: async () => {},
      execute: async (slot: any, ctx: any) => ({ pluginId: "test-plugin", slot, data: {} }),
    };
    await registry.register(plugin);
    const ids = registry.getPluginIds();
    return {
      score: ids.length === 1 && ids[0] === "test-plugin" ? 10 : 0,
      maxScore: 10,
      details: `plugins registered: ${ids.length}`,
    };
  });

  await harness.runTest("16.04.2", "Plugin — executeHooks fires in order", async () => {
    const { PluginRegistry } = await import(join(ROOT, "core/plugin.ts"));
    const registry = new PluginRegistry(ROOT);
    const order: string[] = [];

    const plugin1 = {
      id: "plugin-1", name: "P1", version: "1.0", slots: ["pre-execution" as const],
      init: async () => {}, destroy: async () => {},
      execute: async (slot: any, ctx: any) => { order.push("p1"); return { pluginId: "plugin-1", slot, data: {} }; },
    };
    const plugin2 = {
      id: "plugin-2", name: "P2", version: "1.0", slots: ["pre-execution" as const],
      init: async () => {}, destroy: async () => {},
      execute: async (slot: any, ctx: any) => { order.push("p2"); return { pluginId: "plugin-2", slot, data: {} }; },
    };
    await registry.register(plugin1);
    await registry.register(plugin2);
    await registry.executeHooks("pre-execution", { taskId: "t1", agentId: "a1" } as any);
    return {
      score: order[0] === "p1" && order[1] === "p2" ? 10 : 0,
      maxScore: 10,
      details: `execution order: [${order.join(", ")}]`,
    };
  });

  await harness.runTest("16.04.3", "Plugin — abort stops chain", async () => {
    const { PluginRegistry } = await import(join(ROOT, "core/plugin.ts"));
    const registry = new PluginRegistry(ROOT);
    const executed: string[] = [];

    const abortPlugin = {
      id: "abort-p", name: "Abort", version: "1.0", slots: ["pre-execution" as const],
      init: async () => {}, destroy: async () => {},
      execute: async (slot: any, ctx: any) => { executed.push("abort"); return { pluginId: "abort-p", slot, data: {}, abort: true }; },
    };
    const neverPlugin = {
      id: "never-p", name: "Never", version: "1.0", slots: ["pre-execution" as const],
      init: async () => {}, destroy: async () => {},
      execute: async (slot: any, ctx: any) => { executed.push("never"); return { pluginId: "never-p", slot, data: {} }; },
    };
    await registry.register(abortPlugin);
    await registry.register(neverPlugin);
    await registry.executeHooks("pre-execution", { taskId: "t1", agentId: "a1" } as any);
    return {
      score: executed.length === 1 && executed[0] === "abort" ? 10 : 0,
      maxScore: 10,
      details: `executed=[${executed.join(", ")}] (expected only abort)`,
    };
  });

  await harness.runTest("16.04.4", "Plugin — destroyAll cleans up", async () => {
    const { PluginRegistry } = await import(join(ROOT, "core/plugin.ts"));
    const registry = new PluginRegistry(ROOT);
    let destroyed = false;
    const plugin = {
      id: "cleanup-p", name: "Cleanup", version: "1.0", slots: ["on-startup" as const],
      init: async () => {}, destroy: async () => { destroyed = true; },
      execute: async (slot: any, ctx: any) => ({ pluginId: "cleanup-p", slot, data: {} }),
    };
    await registry.register(plugin);
    await registry.destroyAll();
    return {
      score: destroyed ? 10 : 0,
      maxScore: 10,
      details: `destroy called: ${destroyed}`,
    };
  });
}
