// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: PluginRegistry Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type {
  PluginSlot,
  PluginContext,
  PluginResult,
} from "../../core/types.ts";
import type { AetherPlugin } from "../../core/plugin.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.22.1: Register plugin with hooks and execute ──────
  await harness.runTest(
    "2.22.1",
    "PluginRegistry — Register and execute hooks",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { PluginRegistry } = await import("../../core/plugin.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));

        const registry = new PluginRegistry(tempDir);
        details.push("PluginRegistry created");
        score += 1;

        const executionLog: string[] = [];

        const testPlugin: AetherPlugin = {
          id: "test-plugin-1",
          name: "Test Plugin",
          version: "1.0.0",
          slots: ["pre-execution", "post-execution"] as PluginSlot[],
          async init(ctx) {
            executionLog.push("init");
          },
          async execute(
            slot: PluginSlot,
            context: PluginContext,
          ): Promise<PluginResult> {
            executionLog.push(`execute:${slot}`);
            return {
              handled: true,
              abort: false,
              reason: `Handled by test-plugin at ${slot}`,
            };
          },
          async destroy() {
            executionLog.push("destroy");
          },
        };

        await registry.register(testPlugin);
        details.push("Plugin registered");
        score += 2;

        if (executionLog.includes("init")) {
          details.push("init() was called during registration");
          score += 1;
        }

        if (registry.size === 1) {
          details.push("Registry size: 1");
          score += 1;
        }

        // Execute pre-execution hooks
        const results = await registry.executeHooks("pre-execution", {
          slot: "pre-execution",
          metadata: {},
        });

        if (results.length === 1 && results[0].handled === true) {
          details.push("pre-execution hook executed and returned handled=true");
          score += 2;
        }

        if (executionLog.includes("execute:pre-execution")) {
          details.push("execute log includes pre-execution");
          score += 1;
        }

        // Execute post-execution hooks
        await registry.executeHooks("post-execution", {
          slot: "post-execution",
          metadata: {},
        });

        if (executionLog.includes("execute:post-execution")) {
          details.push("post-execution hook also executed");
          score += 1;
        }

        // No hooks registered for on-error
        const noResults = await registry.executeHooks("on-error", {
          slot: "on-error",
          metadata: {},
        });

        if (noResults.length === 0) {
          details.push("No results for unregistered slot");
          score += 1;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.22.2: Hook execution order and abort propagation ──
  await harness.runTest(
    "2.22.2",
    "PluginRegistry — Execution order and abort propagation",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { PluginRegistry } = await import("../../core/plugin.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const registry = new PluginRegistry(tempDir);

        const order: string[] = [];

        // Plugin A: runs first, does not abort
        const pluginA: AetherPlugin = {
          id: "plugin-a",
          name: "Plugin A",
          version: "1.0.0",
          slots: ["pre-execution"] as PluginSlot[],
          async init() {},
          async execute(
            slot: PluginSlot,
            ctx: PluginContext,
          ): Promise<PluginResult> {
            order.push("A");
            return { handled: true, abort: false };
          },
          async destroy() {},
        };

        // Plugin B: aborts
        const pluginB: AetherPlugin = {
          id: "plugin-b",
          name: "Plugin B",
          version: "1.0.0",
          slots: ["pre-execution"] as PluginSlot[],
          async init() {},
          async execute(
            slot: PluginSlot,
            ctx: PluginContext,
          ): Promise<PluginResult> {
            order.push("B");
            return {
              handled: true,
              abort: true,
              reason: "Security violation detected",
            };
          },
          async destroy() {},
        };

        // Plugin C: should NOT execute because B aborted
        const pluginC: AetherPlugin = {
          id: "plugin-c",
          name: "Plugin C",
          version: "1.0.0",
          slots: ["pre-execution"] as PluginSlot[],
          async init() {},
          async execute(
            slot: PluginSlot,
            ctx: PluginContext,
          ): Promise<PluginResult> {
            order.push("C");
            return { handled: true, abort: false };
          },
          async destroy() {},
        };

        await registry.register(pluginA);
        await registry.register(pluginB);
        await registry.register(pluginC);

        details.push(`Registered ${registry.size} plugins`);
        score += 2;

        const results = await registry.executeHooks("pre-execution", {
          slot: "pre-execution",
          metadata: {},
        });

        // A and B should run, C should not (B aborted)
        if (order.includes("A") && order.includes("B")) {
          details.push("Plugins A and B executed");
          score += 2;
        }

        if (!order.includes("C")) {
          details.push("Plugin C correctly skipped after abort");
          score += 3;
        } else {
          details.push("Plugin C ran even though B aborted");
        }

        // shouldAbort helper
        const abortCheck = await registry.shouldAbort("pre-execution", {
          slot: "pre-execution",
          metadata: {},
        });

        if (abortCheck.abort === true) {
          details.push("shouldAbort returns abort=true");
          score += 1;
        }

        if (
          abortCheck.reason &&
          abortCheck.reason.includes("Security violation")
        ) {
          details.push("Abort reason preserved");
          score += 1;
        }

        // Unregister and destroy
        await registry.unregister("plugin-b");
        if (registry.size === 2) {
          details.push("Plugin B unregistered");
          score += 1;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
