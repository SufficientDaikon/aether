// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 03: Multi-Step Sequential Workflow
// Three sequential LLM calls via GeminiWrapper, each building
// on the previous output: plan -> implement -> review.
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
    "5.03",
    "Multi-Step Workflow — plan, implement, review",
    async () => {
      try {
        const steps: Array<{
          role: string;
          content: string;
          latencyMs: number;
          tokens: { input: number; output: number; total: number };
        }> = [];

        // Step 1: System Architect plans a Todo app
        const step1Start = Date.now();
        const step1 = await gemini.send(
          "You are a system architect. Plan the architecture for a Todo app " +
            "with React frontend and a REST API backend. List the main components, " +
            "data models, and API endpoints. Be concise (under 300 words).",
          {
            model: "gemini-2.5-flash",
            maxTokens: 500,
            systemPrompt:
              "You are a senior system architect. Respond with clear, structured plans.",
          },
        );
        steps.push({
          role: "system-architect",
          content: step1.content,
          latencyMs: Date.now() - step1Start,
          tokens: step1.tokensUsed,
        });

        // Step 2: React Specialist implements frontend based on step 1
        const step2Start = Date.now();
        const step2 = await gemini.send(
          "You are a React specialist. Based on the following architecture plan, " +
            "implement the main TodoList component with add/delete/toggle functionality. " +
            "Use TypeScript and React hooks.\n\n" +
            "Architecture Plan:\n" +
            step1.content.slice(0, 1500),
          {
            model: "gemini-2.5-flash",
            maxTokens: 800,
            systemPrompt:
              "You are a React specialist. Write clean TypeScript React code.",
          },
        );
        steps.push({
          role: "react-specialist",
          content: step2.content,
          latencyMs: Date.now() - step2Start,
          tokens: step2.tokensUsed,
        });

        // Step 3: UX Psychologist reviews the implementation
        const step3Start = Date.now();
        const step3 = await gemini.send(
          "You are a UX psychologist. Review the following React implementation " +
            "for usability, accessibility, and user experience. Provide specific, " +
            "actionable feedback.\n\n" +
            "Implementation:\n" +
            step2.content.slice(0, 1500),
          {
            model: "gemini-2.5-flash",
            maxTokens: 500,
            systemPrompt:
              "You are a UX psychologist. Focus on accessibility and user experience.",
          },
        );
        steps.push({
          role: "ux-psychologist",
          content: step3.content,
          latencyMs: Date.now() - step3Start,
          tokens: step3.tokensUsed,
        });

        // Validate: all 3 steps produced non-empty content
        let score = 0;
        const details: string[] = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (step.content && step.content.trim().length > 20) {
            score += 3;
            details.push(
              `Step ${i + 1} (${step.role}): OK — ${step.content.length} chars, ${step.latencyMs}ms`,
            );
          } else {
            details.push(
              `Step ${i + 1} (${step.role}): EMPTY or too short — "${(step.content ?? "").slice(0, 50)}"`,
            );
          }
        }

        // Bonus point: step 2 references something from step 1 output
        // (demonstrates context threading)
        if (
          steps.length >= 2 &&
          (step2.content.toLowerCase().includes("todo") ||
            step2.content.toLowerCase().includes("component"))
        ) {
          score += 1;
          details.push(
            "Bonus: Step 2 references Todo/component context from step 1.",
          );
        }

        // Cap at 10
        score = Math.min(score, 10);

        const totalLatency = steps.reduce((sum, s) => sum + s.latencyMs, 0);
        const totalTokens = steps.reduce((sum, s) => sum + s.tokens.total, 0);

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            totalLatencyMs: totalLatency,
            totalTokens,
            stepSummaries: steps.map((s) => ({
              role: s.role,
              chars: s.content.length,
              latencyMs: s.latencyMs,
              tokens: s.tokens.total,
            })),
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Multi-step workflow failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
