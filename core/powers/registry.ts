// -----------------------------------------------------------------
// AETHER Powers — Registry
// -----------------------------------------------------------------

import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { PowerManifest, InstalledPower } from "./schema.ts";
import { validateManifest } from "./schema.ts";
import { DynamicActivator, type ConversationContext, type ActivationResult } from "./activator.ts";

// -----------------------------------------------------------------
// PowerRegistry
// -----------------------------------------------------------------

export class PowerRegistry {
  private installed: InstalledPower[] = [];
  private active: InstalledPower[] = [];
  private activator = new DynamicActivator();

  /** Scan a powers directory and load all valid installed power manifests */
  async loadInstalled(powersDir: string): Promise<void> {
    this.installed = [];
    this.active = [];

    if (!existsSync(powersDir)) return;

    let entries: string[];
    try {
      entries = await readdir(powersDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === "registry.json") continue;

      const manifestPath = join(powersDir, entry, "power.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = await readFile(manifestPath, "utf-8");
        const parsed = JSON.parse(raw);
        const validation = validateManifest(parsed);
        if (!validation.valid) continue;

        const manifest = parsed as PowerManifest;

        // Read installedAt from registry.json if available
        let installedAt = new Date().toISOString();
        const regPath = join(powersDir, "registry.json");
        if (existsSync(regPath)) {
          try {
            const regRaw = await readFile(regPath, "utf-8");
            const regData = JSON.parse(regRaw);
            if (regData.powers?.[manifest.name]?.installedAt) {
              installedAt = regData.powers[manifest.name].installedAt;
            }
          } catch {
            // use default
          }
        }

        this.installed.push({
          manifest,
          installPath: join(powersDir, entry),
          installedAt,
        });
      } catch {
        // skip invalid entries
      }
    }
  }

  /** Get all installed powers */
  getInstalled(): InstalledPower[] {
    return [...this.installed];
  }

  /** Get currently active powers */
  getActive(): InstalledPower[] {
    return [...this.active];
  }

  /**
   * Search installed powers by query string.
   * Matches against name, description, and activation keywords (substring, case-insensitive).
   */
  search(query: string): InstalledPower[] {
    const q = query.toLowerCase();
    return this.installed.filter((p) => {
      const m = p.manifest;
      if (m.name.toLowerCase().includes(q)) return true;
      if (m.description.toLowerCase().includes(q)) return true;
      if (m.activation.keywords.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  /**
   * Evaluate conversation context and activate matching powers.
   * Returns the activation result and updates the internal active list.
   */
  activateForContext(context: ConversationContext): ActivationResult {
    const result = this.activator.evaluate(this.installed, context);
    this.active = result.activated;
    return result;
  }
}
