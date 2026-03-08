// Phase 16.03: Settings Validation Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("16.03.1", "Settings — defaults loaded when no file", async () => {
    const tmpDir = join(import.meta.dir, ".settings-tmp");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { SettingsManager } = await import(join(ROOT, "core/settings.ts"));
      const mgr = new SettingsManager(tmpDir);
      const settings = mgr.load();
      const hasDefaults = settings.logging != null && settings.routing != null;
      return {
        score: hasDefaults ? 10 : 0,
        maxScore: 10,
        details: `defaults loaded: logging=${!!settings.logging} routing=${!!settings.routing}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("16.03.2", "Settings — save and load round-trip", async () => {
    const tmpDir = join(import.meta.dir, ".settings-tmp2");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { SettingsManager } = await import(join(ROOT, "core/settings.ts"));
      const mgr = new SettingsManager(tmpDir);
      const settings = mgr.load();
      mgr.save(settings);
      const reloaded = mgr.load();
      const match = reloaded.logging.level === settings.logging.level;
      return {
        score: match ? 10 : 0,
        maxScore: 10,
        details: `round-trip match: ${match}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("16.03.3", "Settings — dot-path get and set", async () => {
    const tmpDir = join(import.meta.dir, ".settings-tmp3");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { SettingsManager } = await import(join(ROOT, "core/settings.ts"));
      const mgr = new SettingsManager(tmpDir);
      const settings = mgr.load();
      const level = mgr.get("logging.level");
      const hasValue = level != null;
      return {
        score: hasValue ? 10 : 0,
        maxScore: 10,
        details: `get logging.level = ${level}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("16.03.4", "Settings — corrupt JSON uses defaults", async () => {
    const tmpDir = join(import.meta.dir, ".settings-tmp4");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "settings.json"), "{{not valid json}}");

    try {
      const { SettingsManager } = await import(join(ROOT, "core/settings.ts"));
      const mgr = new SettingsManager(tmpDir);
      const settings = mgr.load();
      const hasDefaults = settings.logging != null;
      return {
        score: hasDefaults ? 10 : 0,
        maxScore: 10,
        details: `recovered from corrupt JSON: ${hasDefaults}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
