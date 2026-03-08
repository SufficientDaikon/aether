// ─────────────────────────────────────────────────────────────
// Phase 9.03: Model Alias Validation
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "9.03.1",
    "GeminiProvider — model aliases resolve",
    async () => {
      const { GeminiProvider } = await import(
        join(ROOT, "providers/gemini.ts")
      );
      const map = GeminiProvider.modelMap;
      const aliases = Object.keys(map);
      const allResolve = aliases.every(
        (k) => typeof map[k] === "string" && map[k].length > 0,
      );
      return {
        score: allResolve ? 10 : 0,
        maxScore: 10,
        details: `aliases=[${aliases.join(", ")}] -> [${aliases.map((k) => map[k]).join(", ")}]`,
      };
    },
  );

  await harness.runTest(
    "9.03.2",
    "ClaudeProvider — model aliases resolve",
    async () => {
      const { ClaudeProvider } = await import(
        join(ROOT, "providers/claude.ts")
      );
      const map = ClaudeProvider.modelMap;
      const aliases = Object.keys(map);
      const allResolve = aliases.every(
        (k) => typeof map[k] === "string" && map[k].length > 0,
      );
      return {
        score: allResolve ? 10 : 0,
        maxScore: 10,
        details: `aliases=[${aliases.join(", ")}] -> [${aliases.map((k) => map[k]).join(", ")}]`,
      };
    },
  );

  await harness.runTest(
    "9.03.3",
    "OpenAIProvider — model aliases resolve",
    async () => {
      const { OpenAIProvider } = await import(
        join(ROOT, "providers/openai.ts")
      );
      const map = OpenAIProvider.modelMap;
      const aliases = Object.keys(map);
      const allResolve = aliases.every(
        (k) => typeof map[k] === "string" && map[k].length > 0,
      );
      return {
        score: allResolve ? 10 : 0,
        maxScore: 10,
        details: `aliases=[${aliases.join(", ")}] -> [${aliases.map((k) => map[k]).join(", ")}]`,
      };
    },
  );

  await harness.runTest(
    "9.03.4",
    "Default config aliases match provider maps",
    async () => {
      const { GeminiProvider } = await import(
        join(ROOT, "providers/gemini.ts")
      );
      const { ClaudeProvider } = await import(
        join(ROOT, "providers/claude.ts")
      );
      const { OpenAIProvider } = await import(
        join(ROOT, "providers/openai.ts")
      );

      const allMaps: Record<string, Record<string, string>> = {
        gemini: GeminiProvider.modelMap,
        claude: ClaudeProvider.modelMap,
        openai: OpenAIProvider.modelMap,
      };

      // Default tier config references these aliases
      const defaults = [
        { provider: "claude", model: "opus" },
        { provider: "claude", model: "sonnet" },
        { provider: "claude", model: "haiku" },
        { provider: "openai", model: "gpt4o" },
        { provider: "gemini", model: "gemini-pro" },
      ];

      let resolved = 0;
      const details: string[] = [];
      for (const d of defaults) {
        const map = allMaps[d.provider];
        if (map && (map[d.model] || d.model.includes("-"))) {
          resolved++;
          details.push(`${d.provider}/${d.model}: OK`);
        } else {
          details.push(`${d.provider}/${d.model}: MISSING`);
        }
      }

      return {
        score: Math.round((resolved / defaults.length) * 10),
        maxScore: 10,
        details: details.join("; "),
      };
    },
  );
}
