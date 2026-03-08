// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 05: Group Chat
// Creates a GroupChat with 3 agents (system-architect,
// react-specialist, ux-psychologist) using round-robin speaker
// selection. Each round calls Gemini via the wrapper.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

import {
  GroupChat,
  RoundRobinSelector,
  MaxRoundsTerminator,
} from "../../core/group-chat.ts";
import { SQLiteStore } from "../../core/storage/sqlite-store.ts";
import type { AgentDefinition, ConversationMessage } from "../../core/types.ts";
import {
  SYSTEM_ARCHITECT,
  REACT_SPECIALIST,
  UX_PSYCHOLOGIST,
} from "../helpers/agent-fixtures.ts";

export async function run(
  harness: TestHarness,
  gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.05",
    "Group Chat — 3 agents, round-robin, 3 rounds",
    async () => {
      try {
        // Set up store
        const tmpDir = `.aether/eval-phase5-05-${Date.now()}`;
        const store = new SQLiteStore(tmpDir);
        await store.init();

        const participants = [
          SYSTEM_ARCHITECT,
          REACT_SPECIALIST,
          UX_PSYCHOLOGIST,
        ];

        // Create group chat config
        const groupChat = new GroupChat(
          {
            id: "eval-group-chat-05",
            participants: participants.map((p) => p.id),
            maxRounds: 3,
            speakerSelection: "round-robin",
            topic:
              "Design a responsive navigation bar with accessibility features",
          },
          store,
          participants,
          {
            speakerSelector: new RoundRobinSelector(),
            terminationConditions: [new MaxRoundsTerminator(3)],
          },
        );

        // Track which agents spoke
        const speakerLog: Array<{
          agentId: string;
          chars: number;
          latencyMs: number;
        }> = [];

        // Execute round callback — calls Gemini for each agent turn
        const executeRound = async (
          agent: AgentDefinition,
          prompt: string,
          history: ConversationMessage[],
        ): Promise<string> => {
          // Build conversation context from history
          const historyContext = history
            .filter((m) => m.role !== "system")
            .slice(-6) // Keep last 6 messages for context window
            .map((m) => `[${m.agentId}]: ${m.content.slice(0, 300)}`)
            .join("\n\n");

          const fullPrompt =
            (historyContext
              ? `Previous discussion:\n${historyContext}\n\n---\n\n`
              : "") +
            prompt +
            "\n\nRespond concisely (under 200 words).";

          const start = Date.now();
          const response = await gemini.send(fullPrompt, {
            model: "gemini-2.5-flash",
            maxTokens: 400,
            systemPrompt:
              `You are ${agent.name}. Capabilities: ${agent.capabilities.join(", ")}. ` +
              `Contribute your expertise to the group discussion.`,
          });

          speakerLog.push({
            agentId: agent.id,
            chars: response.content.length,
            latencyMs: Date.now() - start,
          });

          return response.content;
        };

        // Run the group chat
        const result = await groupChat.run(executeRound);

        // Evaluate results
        let score = 0;
        const details: string[] = [];

        // Check that 3 rounds completed
        if (result.rounds === 3) {
          score += 3;
          details.push(
            `All 3 rounds completed. Termination: ${result.terminationReason}.`,
          );
        } else {
          details.push(
            `Only ${result.rounds}/3 rounds completed. Termination: ${result.terminationReason}.`,
          );
        }

        // Check that all 3 agents spoke
        const uniqueSpeakers = new Set(speakerLog.map((s) => s.agentId));
        if (uniqueSpeakers.size === 3) {
          score += 3;
          details.push(
            `All 3 agents spoke: ${[...uniqueSpeakers].join(", ")}.`,
          );
        } else {
          details.push(
            `Only ${uniqueSpeakers.size}/3 agents spoke: ${[...uniqueSpeakers].join(", ")}.`,
          );
        }

        // Check conversation history builds up (system message + 3 agent messages)
        const nonSystemMessages = result.history.filter(
          (m) => m.role !== "system",
        );
        if (nonSystemMessages.length >= 3) {
          score += 2;
          details.push(
            `Conversation history has ${result.history.length} total messages (${nonSystemMessages.length} non-system).`,
          );
        } else {
          details.push(
            `Conversation history too short: ${nonSystemMessages.length} non-system messages.`,
          );
        }

        // Check final output is non-trivial
        if (result.finalOutput && result.finalOutput.length > 30) {
          score += 2;
          details.push(
            `Final output: ${result.finalOutput.length} chars. Preview: "${result.finalOutput.slice(0, 100)}..."`,
          );
        } else {
          details.push(`Final output was empty or too short.`);
        }

        // Cap at 10
        score = Math.min(score, 10);

        const totalLatency = speakerLog.reduce(
          (sum, s) => sum + s.latencyMs,
          0,
        );

        // Clean up
        await store.close();

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            rounds: result.rounds,
            terminationReason: result.terminationReason,
            conversationId: result.conversationId,
            totalMessages: result.history.length,
            speakers: speakerLog,
            totalLatencyMs: totalLatency,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `Group chat test failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
