// ─────────────────────────────────────────────────────────────
// FallbackChainManager Tests
// tests/fallback/chain-manager.test.ts
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "bun:test";
import { FallbackChainManager } from "../../core/fallback/chain-manager.ts";

describe("FallbackChainManager", () => {
  it("uses the primary model when it succeeds", async () => {
    const manager = new FallbackChainManager({
      chains: { master: ["claude-opus-4-6", "gpt-4o", "gemini-2.5-pro"] },
    });

    const usedModels: string[] = [];
    const result = await manager.executeWithFallback("master", async model => {
      usedModels.push(model);
      return `result from ${model}`;
    });

    expect(result).toBe("result from claude-opus-4-6");
    expect(usedModels).toEqual(["claude-opus-4-6"]);
  });

  it("falls back to the next model when the primary fails", async () => {
    const manager = new FallbackChainManager({
      chains: { worker: ["model-a", "model-b", "model-c"] },
    });

    const usedModels: string[] = [];
    const result = await manager.executeWithFallback("worker", async model => {
      usedModels.push(model);
      if (model === "model-a") throw new Error("model-a unavailable");
      return `ok from ${model}`;
    });

    expect(result).toBe("ok from model-b");
    expect(usedModels).toEqual(["model-a", "model-b"]);
  });

  it("traverses the entire chain before returning the last successful model", async () => {
    const manager = new FallbackChainManager({
      chains: { tier: ["m1", "m2", "m3"] },
    });

    const result = await manager.executeWithFallback("tier", async model => {
      if (model !== "m3") throw new Error(`${model} down`);
      return "m3-result";
    });

    expect(result).toBe("m3-result");
  });

  it("throws a descriptive error when ALL models fail", async () => {
    const manager = new FallbackChainManager({
      chains: { master: ["m1", "m2", "m3"] },
    });

    await expect(
      manager.executeWithFallback("master", async model => {
        throw new Error(`${model} failed`);
      })
    ).rejects.toThrow(/all models failed/i);
  });

  it("includes each model's individual error in the thrown message", async () => {
    const manager = new FallbackChainManager({
      chains: { master: ["alpha", "beta"] },
    });

    let caughtError: Error | undefined;
    try {
      await manager.executeWithFallback("master", async model => {
        throw new Error(`${model} is down`);
      });
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError?.message).toContain("alpha is down");
    expect(caughtError?.message).toContain("beta is down");
  });

  it("throws when no chain is configured for the requested tier", async () => {
    const manager = new FallbackChainManager({ chains: {} });

    await expect(
      manager.executeWithFallback("ghost-tier", async () => "ok")
    ).rejects.toThrow(/no chain configured/i);
  });

  it("wraps non-Error thrown values in an Error", async () => {
    const manager = new FallbackChainManager({ chains: { t: ["m1"] } });

    await expect(
      manager.executeWithFallback("t", async () => {
        throw "raw string";
      })
    ).rejects.toThrow(/all models failed/i);
  });

  // ── getChain ──────────────────────────────────────────────

  it("getChain returns a copy — mutations do not affect stored chain", () => {
    const manager = new FallbackChainManager({
      chains: { master: ["m1", "m2"] },
    });

    const chain = manager.getChain("master");
    expect(chain).toEqual(["m1", "m2"]);

    chain?.push("m3");
    expect(manager.getChain("master")).toEqual(["m1", "m2"]); // unchanged
  });

  it("getChain returns undefined for an unknown tier", () => {
    const manager = new FallbackChainManager({ chains: {} });
    expect(manager.getChain("unknown")).toBeUndefined();
  });

  // ── setChain ──────────────────────────────────────────────

  it("setChain replaces the chain for an existing tier", () => {
    const manager = new FallbackChainManager({
      chains: { worker: ["old-model"] },
    });

    manager.setChain("worker", ["new-a", "new-b"]);
    expect(manager.getChain("worker")).toEqual(["new-a", "new-b"]);
  });

  it("setChain adds a chain for a new tier", () => {
    const manager = new FallbackChainManager({ chains: {} });
    manager.setChain("brand-new", ["m1"]);
    expect(manager.getChain("brand-new")).toEqual(["m1"]);
  });

  it("setChain stores a copy — later mutations don't affect stored chain", () => {
    const manager = new FallbackChainManager({ chains: {} });
    const models = ["m1", "m2"];
    manager.setChain("t", models);
    models.push("m3");
    expect(manager.getChain("t")).toEqual(["m1", "m2"]);
  });

  // ── getTiers ──────────────────────────────────────────────

  it("getTiers lists all configured tier names", () => {
    const manager = new FallbackChainManager({
      chains: { master: ["m1"], manager: ["m2"], worker: ["m3"] },
    });

    expect(manager.getTiers().sort()).toEqual(["manager", "master", "worker"]);
  });

  it("getTiers returns empty array when no chains are configured", () => {
    const manager = new FallbackChainManager({ chains: {} });
    expect(manager.getTiers()).toEqual([]);
  });
});
