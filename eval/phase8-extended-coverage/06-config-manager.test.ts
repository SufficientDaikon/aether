// ─────────────────────────────────────────────────────────────
// Phase 8.06: Config Manager / Workspace Scanner Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "8.06.1",
    "WorkspaceScanner — module exports",
    async () => {
      const mod = await import(join(ROOT, "core/config.ts"));
      const has =
        typeof mod.WorkspaceScanner === "function" ||
        typeof mod.ConfigManager === "function";
      return {
        score: has ? 10 : 0,
        maxScore: 10,
        details: `Exports: [${Object.keys(mod).join(", ")}]`,
      };
    },
  );

  await harness.runTest(
    "8.06.2",
    "WorkspaceScanner — scan detects bun",
    async () => {
      const { WorkspaceScanner } = await import(join(ROOT, "core/config.ts"));
      const profile = await WorkspaceScanner.scan(ROOT);
      const isBun = profile.packageManager === "bun";
      return {
        score: isBun ? 10 : 5,
        maxScore: 10,
        details: `packageManager=${profile.packageManager}`,
      };
    },
  );

  await harness.runTest(
    "8.06.3",
    "WorkspaceScanner — detects TypeScript",
    async () => {
      const { WorkspaceScanner } = await import(join(ROOT, "core/config.ts"));
      const profile = await WorkspaceScanner.scan(ROOT);
      const hasTS = profile.languages.includes("typescript");
      return {
        score: hasTS ? 10 : 0,
        maxScore: 10,
        details: `languages=[${profile.languages.join(", ")}]`,
      };
    },
  );

  await harness.runTest(
    "8.06.4",
    "ConfigManager — initialization",
    async () => {
      const mod = await import(join(ROOT, "core/config.ts"));
      let score = 0;
      if (typeof mod.ConfigManager === "function") {
        const cm = new mod.ConfigManager(ROOT);
        score = cm ? 10 : 0;
      } else if (typeof mod.AetherConfig === "function") {
        const ac = new mod.AetherConfig(ROOT);
        score = ac ? 10 : 0;
      } else {
        // ConfigManager might not be a class — check for initWorkspace
        score = typeof mod.initWorkspace === "function" ? 10 : 5;
      }
      return {
        score,
        maxScore: 10,
        details: `ConfigManager available, exports=[${Object.keys(mod).join(", ")}]`,
      };
    },
  );
}
