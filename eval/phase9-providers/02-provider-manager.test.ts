// ─────────────────────────────────────────────────────────────
// Phase 9.02: Provider Manager Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "9.02.1",
    "ProviderManager — construction with defaults",
    async () => {
      const { ProviderManager } = await import(
        join(ROOT, "providers/manager.ts")
      );
      const pm = new ProviderManager();
      return {
        score: pm ? 10 : 0,
        maxScore: 10,
        details: "ProviderManager constructed with defaults",
      };
    },
  );

  await harness.runTest(
    "9.02.2",
    "ProviderManager — construction with custom config",
    async () => {
      const { ProviderManager } = await import(
        join(ROOT, "providers/manager.ts")
      );
      const pm = new ProviderManager({
        tiers: {
          master: { provider: "gemini", model: "gemini-2.5-pro" },
          manager: { provider: "gemini", model: "gemini-2.5-pro" },
          worker: { provider: "gemini", model: "gemini-2.5-flash" },
        },
        fallbackChain: [{ provider: "ollama", model: "local" }],
      });
      return {
        score: pm ? 10 : 0,
        maxScore: 10,
        details: "Custom config accepted",
      };
    },
  );

  await harness.runTest(
    "9.02.3",
    "ProviderManager — getProvider returns instances",
    async () => {
      const { ProviderManager } = await import(
        join(ROOT, "providers/manager.ts")
      );
      const pm = new ProviderManager();
      let count = 0;
      for (const name of ["claude", "openai", "gemini", "ollama"]) {
        const p = (pm as any).providers?.get(name);
        if (p) count++;
      }
      return {
        score: count >= 3 ? 10 : count * 2,
        maxScore: 10,
        details: `${count}/4 providers initialized`,
      };
    },
  );

  await harness.runTest(
    "9.02.4",
    "ProviderManager — sendForTier rejects with no configured provider",
    async () => {
      const { ProviderManager } = await import(
        join(ROOT, "providers/manager.ts")
      );
      // Create manager where no provider has valid keys
      const origKeys = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        GOOGLE_AI_KEY: process.env.GOOGLE_AI_KEY,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_KEY;

      const pm = new ProviderManager({
        tiers: {
          master: { provider: "claude", model: "opus" },
          manager: { provider: "claude", model: "sonnet" },
          worker: { provider: "claude", model: "haiku" },
        },
        fallbackChain: [],
      });

      let threw = false;
      try {
        await pm.sendForTier("worker", "test prompt");
      } catch {
        threw = true;
      }

      // Restore keys
      for (const [k, v] of Object.entries(origKeys)) {
        if (v) process.env[k] = v;
      }

      return {
        score: threw ? 10 : 0,
        maxScore: 10,
        details: `threw=${threw} (expected true when unconfigured)`,
      };
    },
  );
}
