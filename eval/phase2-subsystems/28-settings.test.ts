// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: SettingsManager Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.28.1: Load defaults and save/load round-trip ──────
  await harness.runTest(
    "2.28.1",
    "SettingsManager — Defaults and save/load round-trip",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { SettingsManager } = await import("../../core/settings.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const aetherDir = join(tempDir, ".aether");

        try {
          const mgr = new SettingsManager(aetherDir);
          details.push("SettingsManager created");
          score += 1;

          // Before save, file should not exist
          if (!mgr.exists()) {
            details.push("Settings file does not exist initially");
            score += 1;
          }

          // Load defaults
          const defaults = mgr.load();
          if (defaults.methodology.mode === "tdd") {
            details.push("Default methodology.mode: tdd");
            score += 1;
          }

          if (defaults.execution.maxDepth === 3) {
            details.push("Default execution.maxDepth: 3");
            score += 1;
          }

          if (defaults.server.port === 9999) {
            details.push("Default server.port: 9999");
            score += 1;
          }

          // Save and reload
          mgr.save(defaults);
          if (mgr.exists()) {
            details.push("Settings file saved");
            score += 1;
          }

          // Create a new manager to test loading from file
          const mgr2 = new SettingsManager(aetherDir);
          const loaded = mgr2.load();

          if (
            loaded.methodology.mode === defaults.methodology.mode &&
            loaded.execution.maxDepth === defaults.execution.maxDepth &&
            loaded.server.port === defaults.server.port
          ) {
            details.push("Round-trip save/load matches");
            score += 2;
          }

          // Modify, save, reload
          loaded.execution.maxDepth = 5;
          mgr2.save(loaded);

          const mgr3 = new SettingsManager(aetherDir);
          const reloaded = mgr3.load();
          if (reloaded.execution.maxDepth === 5) {
            details.push("Modified setting persisted: maxDepth=5");
            score += 2;
          }
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
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

  // ── Test 2.28.2: Dot-path get/set ────────────────────────────
  await harness.runTest(
    "2.28.2",
    "SettingsManager — Dot-path get and set",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { SettingsManager } = await import("../../core/settings.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const aetherDir = join(tempDir, ".aether");

        try {
          const mgr = new SettingsManager(aetherDir);
          mgr.load();

          // get() dot-path
          const maxDepth = mgr.get<number>("execution.maxDepth");
          if (maxDepth === 3) {
            details.push("get('execution.maxDepth'): 3");
            score += 1;
          }

          const mode = mgr.get<string>("methodology.mode");
          if (mode === "tdd") {
            details.push("get('methodology.mode'): tdd");
            score += 1;
          }

          // set() dot-path
          mgr.set("execution.temperature", 0.5);
          const temp = mgr.get<number>("execution.temperature");
          if (temp === 0.5) {
            details.push("set/get('execution.temperature'): 0.5");
            score += 1;
          }

          // set() persists to file (reload)
          const mgr2 = new SettingsManager(aetherDir);
          const loaded = mgr2.load();
          if (loaded.execution.temperature === 0.5) {
            details.push("set() persisted and reloaded correctly");
            score += 2;
          }
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
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

  // ── Test 2.28.3: Validate settings ───────────────────────────
  await harness.runTest(
    "2.28.3",
    "SettingsManager — Validate settings",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { SettingsManager } = await import("../../core/settings.ts");

        const defaults = SettingsManager.defaults();
        const mgr = new SettingsManager("/tmp/fake-aether-dir");

        // Defaults should be valid
        const validResult = mgr.validate(defaults);
        if (validResult.valid && validResult.errors.length === 0) {
          details.push("Defaults validate successfully");
          score += 2;
        }

        // Invalid settings should produce errors
        const invalid = {
          methodology: { mode: "invalid-mode" as any },
          execution: { maxDepth: 999 },
          server: { port: -1 },
        };

        const invalidResult = mgr.validate(invalid as any);
        if (!invalidResult.valid) {
          details.push("Invalid settings correctly rejected");
          score += 1;
        }

        if (invalidResult.errors.length >= 2) {
          details.push(`Validation errors: ${invalidResult.errors.length}`);
          score += 1;

          // Check that specific errors are meaningful
          const hasMethodologyError = invalidResult.errors.some((e) =>
            e.includes("methodology.mode"),
          );
          const hasDepthError = invalidResult.errors.some((e) =>
            e.includes("maxDepth"),
          );
          if (hasMethodologyError || hasDepthError) {
            details.push("Errors reference specific fields");
            score += 1;
          }
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
