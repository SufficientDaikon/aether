import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PowerRegistry } from "../../core/powers/registry.ts";

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

let tempDir: string;
let powersDir: string;

const MANIFESTS = [
  {
    name: "react-power",
    version: "1.0.0",
    description: "React component tools",
    provider: "aether-team",
    activation: { keywords: ["react", "component"] },
  },
  {
    name: "postgres-power",
    version: "2.0.0",
    description: "PostgreSQL database tools",
    provider: "aether-team",
    activation: { keywords: ["postgres", "database"], filePatterns: ["**/*.sql"] },
  },
  {
    name: "manual-power",
    version: "0.1.0",
    description: "A manual-only power",
    provider: "test",
    activation: { keywords: ["manual-trigger"], manual: true },
  },
];

async function setupPowers() {
  for (const manifest of MANIFESTS) {
    const dir = join(powersDir, manifest.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "power.json"), JSON.stringify(manifest, null, 2));
  }
  // Also add a registry.json
  const reg = {
    powers: {
      "react-power": { version: "1.0.0", installedAt: "2025-01-01T00:00:00.000Z" },
      "postgres-power": { version: "2.0.0", installedAt: "2025-02-01T00:00:00.000Z" },
      "manual-power": { version: "0.1.0", installedAt: "2025-03-01T00:00:00.000Z" },
    },
  };
  await writeFile(join(powersDir, "registry.json"), JSON.stringify(reg));
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe("Powers › Registry", () => {
  let registry: PowerRegistry;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aether-reg-test-"));
    powersDir = join(tempDir, "powers");
    await mkdir(powersDir, { recursive: true });
    registry = new PowerRegistry();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // loadInstalled -----------------------------------------------------

  it("loads installed powers from directory", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const installed = registry.getInstalled();
    expect(installed).toHaveLength(3);
    expect(installed.map((p) => p.manifest.name).sort()).toEqual([
      "manual-power",
      "postgres-power",
      "react-power",
    ]);
  });

  it("reads installedAt from registry.json", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const react = registry.getInstalled().find((p) => p.manifest.name === "react-power");
    expect(react?.installedAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("handles empty powers directory", async () => {
    await registry.loadInstalled(powersDir);
    expect(registry.getInstalled()).toHaveLength(0);
  });

  it("handles non-existent powers directory", async () => {
    await registry.loadInstalled(join(tempDir, "nonexistent"));
    expect(registry.getInstalled()).toHaveLength(0);
  });

  it("skips entries without power.json", async () => {
    await mkdir(join(powersDir, "no-manifest"), { recursive: true });
    await writeFile(join(powersDir, "no-manifest", "readme.md"), "nothing here");
    await registry.loadInstalled(powersDir);
    expect(registry.getInstalled()).toHaveLength(0);
  });

  it("skips entries with invalid manifest", async () => {
    await mkdir(join(powersDir, "bad-power"), { recursive: true });
    await writeFile(join(powersDir, "bad-power", "power.json"), "not json");
    await registry.loadInstalled(powersDir);
    expect(registry.getInstalled()).toHaveLength(0);
  });

  // search ------------------------------------------------------------

  it("searches by name substring", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const results = registry.search("react");
    expect(results).toHaveLength(1);
    expect(results[0].manifest.name).toBe("react-power");
  });

  it("searches by description substring", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const results = registry.search("database");
    expect(results).toHaveLength(1);
    expect(results[0].manifest.name).toBe("postgres-power");
  });

  it("searches by keyword substring", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const results = registry.search("component");
    expect(results).toHaveLength(1);
    expect(results[0].manifest.name).toBe("react-power");
  });

  it("search is case-insensitive", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const results = registry.search("REACT");
    expect(results).toHaveLength(1);
  });

  it("returns empty for no match", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const results = registry.search("zzz-nonexistent");
    expect(results).toHaveLength(0);
  });

  // activateForContext -------------------------------------------------

  it("activates powers based on conversation context", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const result = registry.activateForContext({
      messages: ["I need to build a react component"],
      openFiles: [],
    });

    expect(result.activated).toHaveLength(1);
    expect(result.activated[0].manifest.name).toBe("react-power");
  });

  it("updates active list after activation", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    expect(registry.getActive()).toHaveLength(0);

    registry.activateForContext({
      messages: ["use postgres for the database"],
      openFiles: [],
    });

    expect(registry.getActive()).toHaveLength(1);
    expect(registry.getActive()[0].manifest.name).toBe("postgres-power");
  });

  it("activates multiple powers when context matches", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const result = registry.activateForContext({
      messages: ["build a react component with postgres database"],
      openFiles: [],
    });

    expect(result.activated).toHaveLength(2);
  });

  it("does not auto-activate manual powers", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const result = registry.activateForContext({
      messages: ["manual-trigger this"],
      openFiles: [],
    });

    // manual-power should NOT be activated even though keyword matches
    const names = result.activated.map((p) => p.manifest.name);
    expect(names).not.toContain("manual-power");
  });

  it("activates manual powers via explicitPowers", async () => {
    await setupPowers();
    await registry.loadInstalled(powersDir);

    const result = registry.activateForContext({
      messages: [],
      openFiles: [],
      explicitPowers: ["manual-power"],
    });

    expect(result.activated).toHaveLength(1);
    expect(result.activated[0].manifest.name).toBe("manual-power");
  });
});
