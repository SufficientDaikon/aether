// -----------------------------------------------------------------
// AETHER Powers — Installer (install / remove)
// -----------------------------------------------------------------

import { join } from "node:path";
import { readdir, readFile, writeFile, rm, cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { validateManifest, type PowerManifest, type InstalledPower } from "./schema.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/** Pending actions for the integration layer to apply */
export interface PendingActions {
  mcpRegistration?: {
    name: string;
    server: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    config?: Record<string, unknown>;
  };
  steeringFiles: string[];
  hookFiles: string[];
}

export interface InstallResult {
  success: boolean;
  power: InstalledPower;
  pendingActions: PendingActions;
}

export interface RemoveResult {
  success: boolean;
  pendingActions: PendingActions;
  warnings: string[];
}

/** Minimal registry.json format */
export interface RegistryData {
  powers: Record<string, { version: string; installedAt: string }>;
}

// -----------------------------------------------------------------
// PowerInstaller
// -----------------------------------------------------------------

export class PowerInstaller {
  /**
   * Install a power from a local source directory.
   * Copies to powersDir/{name}/, validates manifest, and returns pending actions.
   */
  async install(source: string, powersDir: string): Promise<InstallResult> {
    // 1. Read and validate manifest from source
    const manifestPath = join(source, "power.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`No power.json found at ${source}`);
    }

    const raw = await readFile(manifestPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in power.json at ${source}`);
    }

    const validation = validateManifest(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid power manifest:\n  - ${validation.errors.join("\n  - ")}`);
    }

    const manifest = parsed as PowerManifest;
    const targetDir = join(powersDir, manifest.name);
    let copied = false;

    try {
      // 2. Copy power to target directory
      await mkdir(powersDir, { recursive: true });
      if (existsSync(targetDir)) {
        throw new Error(`Power "${manifest.name}" is already installed at ${targetDir}`);
      }
      await cp(source, targetDir, { recursive: true });
      copied = true;

      // 3. Build pending actions
      const pendingActions = this.buildPendingActions(manifest, targetDir);

      // 4. Update registry.json
      const installedAt = new Date().toISOString();
      await this.updateRegistry(powersDir, manifest.name, manifest.version, installedAt);

      const power: InstalledPower = {
        manifest,
        installPath: targetDir,
        installedAt,
      };

      return { success: true, power, pendingActions };
    } catch (err) {
      // Rollback: remove copied directory
      if (copied && existsSync(targetDir)) {
        await rm(targetDir, { recursive: true, force: true }).catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Remove an installed power.
   */
  async remove(name: string, powersDir: string): Promise<RemoveResult> {
    const warnings: string[] = [];
    const targetDir = join(powersDir, name);

    if (!existsSync(targetDir)) {
      throw new Error(`Power "${name}" is not installed`);
    }

    // Read manifest for deregistration info
    const manifestPath = join(targetDir, "power.json");
    let manifest: PowerManifest | null = null;
    try {
      const raw = await readFile(manifestPath, "utf-8");
      manifest = JSON.parse(raw) as PowerManifest;
    } catch {
      warnings.push(`Could not read manifest for "${name}", deregistration may be incomplete`);
    }

    // Check for dependents
    const dependents = await this.findDependents(name, powersDir);
    if (dependents.length > 0) {
      warnings.push(`The following powers depend on "${name}": ${dependents.join(", ")}`);
    }

    // Build pending deregistration actions
    const pendingActions: PendingActions = { steeringFiles: [], hookFiles: [] };
    if (manifest) {
      if (manifest.mcp) {
        pendingActions.mcpRegistration = {
          name: manifest.name,
          server: manifest.mcp.server,
        };
      }
      if (manifest.steering) {
        pendingActions.steeringFiles = manifest.steering.map((s) => join(targetDir, s));
      }
      if (manifest.hooks) {
        pendingActions.hookFiles = manifest.hooks.map((h) => join(targetDir, h));
      }
    }

    // Delete the power directory
    await rm(targetDir, { recursive: true, force: true });

    // Update registry.json
    await this.removeFromRegistry(powersDir, name);

    return { success: true, pendingActions, warnings };
  }

  // -----------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------

  private buildPendingActions(manifest: PowerManifest, installPath: string): PendingActions {
    const actions: PendingActions = { steeringFiles: [], hookFiles: [] };

    if (manifest.mcp) {
      actions.mcpRegistration = {
        name: manifest.name,
        server: manifest.mcp.server,
        command: manifest.mcp.command,
        args: manifest.mcp.args,
        env: manifest.mcp.env,
        config: manifest.mcp.config,
      };
    }

    if (manifest.steering) {
      actions.steeringFiles = manifest.steering.map((s) => join(installPath, s));
    }

    if (manifest.hooks) {
      actions.hookFiles = manifest.hooks.map((h) => join(installPath, h));
    }

    return actions;
  }

  private async loadRegistryData(powersDir: string): Promise<RegistryData> {
    const regPath = join(powersDir, "registry.json");
    if (!existsSync(regPath)) {
      return { powers: {} };
    }
    try {
      const raw = await readFile(regPath, "utf-8");
      return JSON.parse(raw) as RegistryData;
    } catch {
      return { powers: {} };
    }
  }

  private async saveRegistryData(powersDir: string, data: RegistryData): Promise<void> {
    const regPath = join(powersDir, "registry.json");
    await writeFile(regPath, JSON.stringify(data, null, 2), "utf-8");
  }

  private async updateRegistry(
    powersDir: string,
    name: string,
    version: string,
    installedAt: string,
  ): Promise<void> {
    const data = await this.loadRegistryData(powersDir);
    data.powers[name] = { version, installedAt };
    await this.saveRegistryData(powersDir, data);
  }

  private async removeFromRegistry(powersDir: string, name: string): Promise<void> {
    const data = await this.loadRegistryData(powersDir);
    delete data.powers[name];
    await this.saveRegistryData(powersDir, data);
  }

  private async findDependents(name: string, powersDir: string): Promise<string[]> {
    const dependents: string[] = [];
    if (!existsSync(powersDir)) return dependents;

    let entries: string[];
    try {
      entries = await readdir(powersDir);
    } catch {
      return dependents;
    }

    for (const entry of entries) {
      if (entry === name || entry === "registry.json") continue;
      const mp = join(powersDir, entry, "power.json");
      if (!existsSync(mp)) continue;
      try {
        const raw = await readFile(mp, "utf-8");
        const m = JSON.parse(raw) as PowerManifest;
        if (m.dependencies?.powers?.includes(name)) {
          dependents.push(m.name);
        }
      } catch {
        // skip unreadable manifests
      }
    }
    return dependents;
  }
}
