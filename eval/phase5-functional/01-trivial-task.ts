// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 01: Trivial Task
// Send "What is 2+2?" to Gemini via GeminiWrapper, verify "4"
// in the response. Measures basic round-trip latency and tokens.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

export async function run(
  harness: TestHarness,
  gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.01",
    "Trivial Task — Gemini answers 2+2",
    async () => {
      try {
        const startMs = Date.now();

        const response = await gemini.send("What is 2+2?", {
          model: "gemini-2.5-flash",
          maxTokens: 100,
        });

        const latencyMs = Date.now() - startMs;
        const content = response.content ?? "";
        const containsFour = content.includes("4");
        const score = containsFour ? 10 : 0;

        return {
          score,
          maxScore: 10,
          details: containsFour
            ? `Gemini correctly answered with "4". Response length: ${content.length} chars.`
            : `Gemini response did not contain "4". Got: "${content.slice(0, 200)}"`,
          metadata: {
            latencyMs,
            tokensUsed: response.tokensUsed,
            model: response.model,
            responsePreview: content.slice(0, 300),
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Gemini API call failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
