// ─────────────────────────────────────────────────────────────
// Phase 9.01: Provider Construction Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  // Gemini
  await harness.runTest("9.01.1", "GeminiProvider — construction", async () => {
    const { GeminiProvider } = await import(join(ROOT, "providers/gemini.ts"));
    const p = new GeminiProvider("test-key");
    return {
      score: p.isConfigured() ? 10 : 0,
      maxScore: 10,
      details: `configured=${p.isConfigured()}`,
    };
  });

  await harness.runTest(
    "9.01.2",
    "GeminiProvider — unconfigured without key",
    async () => {
      const { GeminiProvider } = await import(
        join(ROOT, "providers/gemini.ts")
      );
      const origKey = process.env.GOOGLE_AI_KEY;
      delete process.env.GOOGLE_AI_KEY;
      const p = new GeminiProvider("");
      const notConfigured = !p.isConfigured();
      if (origKey) process.env.GOOGLE_AI_KEY = origKey;
      return {
        score: notConfigured ? 10 : 0,
        maxScore: 10,
        details: `configured=${!notConfigured} (expected false)`,
      };
    },
  );

  // Claude
  await harness.runTest("9.01.3", "ClaudeProvider — construction", async () => {
    const { ClaudeProvider } = await import(join(ROOT, "providers/claude.ts"));
    const p = new ClaudeProvider("test-key");
    return {
      score: p.isConfigured() ? 10 : 0,
      maxScore: 10,
      details: `configured=${p.isConfigured()}`,
    };
  });

  await harness.runTest(
    "9.01.4",
    "ClaudeProvider — unconfigured without key",
    async () => {
      const { ClaudeProvider } = await import(
        join(ROOT, "providers/claude.ts")
      );
      const origKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      const p = new ClaudeProvider("");
      const notConfigured = !p.isConfigured();
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      return {
        score: notConfigured ? 10 : 0,
        maxScore: 10,
        details: `configured=${!notConfigured} (expected false)`,
      };
    },
  );

  // OpenAI
  await harness.runTest("9.01.5", "OpenAIProvider — construction", async () => {
    const { OpenAIProvider } = await import(join(ROOT, "providers/openai.ts"));
    const p = new OpenAIProvider("test-key");
    return {
      score: p.isConfigured() ? 10 : 0,
      maxScore: 10,
      details: `configured=${p.isConfigured()}`,
    };
  });

  // Ollama
  await harness.runTest("9.01.6", "OllamaProvider — construction", async () => {
    const { OllamaProvider } = await import(join(ROOT, "providers/ollama.ts"));
    const p = new OllamaProvider();
    // Ollama doesn't need an API key, it just needs a running server
    return { score: 10, maxScore: 10, details: `OllamaProvider constructed` };
  });
}
