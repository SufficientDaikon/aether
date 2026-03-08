// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 08: Full Hierarchy Integration
// Bootstraps the full AETHER stack: Registry, Escalation,
// Logger, ProviderManager (mock that delegates to real Gemini).
// Registers all fixture agents, submits a complex task, and
// verifies routing picks the right agent and produces code.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

import { AgentRegistry } from "../../core/registry.ts";
import { EscalationManager } from "../../core/escalation.ts";
import { AgentRouter } from "../../core/router.ts";
import { SynapseLogger } from "../../core/logger.ts";
import { SQLiteStore } from "../../core/storage/sqlite-store.ts";
import {
  ALL_AGENTS,
  registerFullHierarchy,
} from "../helpers/agent-fixtures.ts";

export async function run(
  harness: TestHarness,
  gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.08",
    "Full Hierarchy — end-to-end task routing and execution",
    async () => {
      try {
        // Bootstrap all subsystems
        const tmpDir = `.aether/eval-phase5-08-${Date.now()}`;
        const store = new SQLiteStore(tmpDir);
        await store.init();

        const logger = new SynapseLogger(tmpDir, "warn");
        const registry = new AgentRegistry(store);
        registerFullHierarchy(registry);

        const escalation = new EscalationManager(registry, {
          threshold: 5,
          windowMs: 300_000,
          store,
        });

        const router = new AgentRouter(store, 0.1);

        let score = 0;
        const details: string[] = [];

        // Step 1: Verify all agents registered
        const allAgents = registry.getAll();
        if (allAgents.length >= ALL_AGENTS.length) {
          score += 1;
          details.push(
            `Registry has ${allAgents.length} agents (expected ${ALL_AGENTS.length}).`,
          );
        } else {
          details.push(
            `Registry only has ${allAgents.length}/${ALL_AGENTS.length} agents.`,
          );
        }

        // Step 2: Route the task
        const taskDescription =
          "Build a landing page with a hero section, features grid, and contact form";

        const routingDecision = await router.resolve(
          taskDescription,
          allAgents.filter((a) => a.status !== "offline"),
        );

        if (routingDecision) {
          // The task mentions frontend concepts (landing page, hero, features, form)
          // so it should route to a frontend agent
          const isFrontendAgent =
            routingDecision.agent.sections.includes("FRONTEND") ||
            routingDecision.agent.capabilities.some(
              (c) =>
                c.includes("react") ||
                c.includes("frontend") ||
                c.includes("component") ||
                c.includes("ui") ||
                c.includes("css"),
            );

          if (isFrontendAgent) {
            score += 3;
            details.push(
              `Routing picked frontend agent "${routingDecision.agent.id}" ` +
                `(confidence: ${routingDecision.confidence.toFixed(2)}, strategy: ${routingDecision.strategy}) -- CORRECT.`,
            );
          } else {
            score += 1; // Partial credit for successful routing even if not ideal
            details.push(
              `Routing picked "${routingDecision.agent.id}" (${routingDecision.agent.tier}, ` +
                `sections: ${routingDecision.agent.sections.join(",")}) -- expected a FRONTEND agent.`,
            );
          }
        } else {
          details.push("Router returned null -- no agent matched the task.");
        }

        // Step 3: Call Gemini as the selected agent
        const selectedAgent =
          routingDecision?.agent ??
          allAgents.find((a) => a.sections.includes("FRONTEND"));
        const agentName = selectedAgent?.name ?? "React Specialist";
        const agentCaps =
          selectedAgent?.capabilities?.join(", ") ?? "frontend, react";

        const geminiStart = Date.now();
        const response = await gemini.send(
          `You are ${agentName} with capabilities: ${agentCaps}.\n\n` +
            `Task: ${taskDescription}\n\n` +
            "Generate the React TypeScript code for this landing page. Include:\n" +
            "1. A HeroSection component with a headline and CTA button\n" +
            "2. A FeaturesGrid component displaying 3 feature cards\n" +
            "3. A ContactForm component with name, email, and message fields\n" +
            "4. A main LandingPage component that composes all three\n\n" +
            "Use modern React with TypeScript and Tailwind CSS classes.",
          {
            model: "gemini-2.5-flash",
            maxTokens: 1500,
            systemPrompt:
              `You are ${agentName}, a specialized agent in the AETHER framework. ` +
              `Generate clean, production-quality code.`,
          },
        );
        const geminiLatency = Date.now() - geminiStart;

        // Verify response contains meaningful code
        const content = response.content;
        const codeIndicators = [
          content.includes("function") ||
            content.includes("const") ||
            content.includes("export"),
          content.includes("Hero") || content.includes("hero"),
          content.includes("Feature") || content.includes("feature"),
          content.includes("Contact") ||
            content.includes("Form") ||
            content.includes("form"),
          content.includes("return") || content.includes("<"),
        ];
        const codeScore = codeIndicators.filter(Boolean).length;

        if (codeScore >= 4) {
          score += 4;
          details.push(
            `Gemini generated comprehensive code: ${content.length} chars, ${codeScore}/5 code indicators present.`,
          );
        } else if (codeScore >= 2) {
          score += 2;
          details.push(
            `Gemini generated partial code: ${content.length} chars, ${codeScore}/5 code indicators present.`,
          );
        } else {
          details.push(
            `Gemini response lacks code: ${content.length} chars, ${codeScore}/5 code indicators.`,
          );
        }

        // Step 4: Verify escalation chain is intact
        if (selectedAgent) {
          const chain = registry.getEscalationChain(selectedAgent.id);
          if (chain.length > 0) {
            score += 2;
            details.push(
              `Escalation chain from "${selectedAgent.id}": ${chain.map((a) => a.id).join(" -> ")}.`,
            );
          } else {
            details.push(
              `No escalation chain found for "${selectedAgent.id}".`,
            );
          }
        } else {
          details.push("No agent selected, skipping escalation chain check.");
        }

        // Cap at 10
        score = Math.min(score, 10);

        // Clean up
        await store.close();

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            registeredAgents: allAgents.length,
            routedTo: routingDecision
              ? {
                  agentId: routingDecision.agent.id,
                  confidence: routingDecision.confidence,
                  strategy: routingDecision.strategy,
                }
              : null,
            geminiLatencyMs: geminiLatency,
            geminiTokens: response.tokensUsed,
            responseLength: response.content.length,
            responsePreview: response.content.slice(0, 500),
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Full hierarchy test failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
