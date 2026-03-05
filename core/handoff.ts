// ─────────────────────────────────────────────────────────────
// AETHER Handoff Protocol
//
// Horizontal agent-to-agent control transfer. Unlike escalation
// (vertical, failure-driven), handoff is intentional and peer-based.
// Conversation state carries forward. Cycle detection prevents
// infinite handoff loops.
// ─────────────────────────────────────────────────────────────

import type {
  AgentDefinition,
  HandoffRequest,
  HandoffResult,
} from "./types.ts";
import type { AetherStore } from "./storage/store.ts";

// ─────────────────────────────────────────────────────────────
// Handoff Manager
// ─────────────────────────────────────────────────────────────

export class HandoffManager {
  private store: AetherStore;
  private maxChainLength: number;

  constructor(store: AetherStore, maxChainLength: number = 5) {
    this.store = store;
    this.maxChainLength = maxChainLength;
  }

  /**
   * Execute a handoff from one agent to another.
   * Validates target exists, is available, and no cycle would form.
   */
  handoff(
    request: HandoffRequest,
    resolveAgent: (id: string) => AgentDefinition | null,
  ): HandoffResult {
    const { fromAgent, toAgent, reason, conversationId, preserveHistory } =
      request;

    // Validate target agent exists
    const targetAgent = resolveAgent(toAgent);
    if (!targetAgent) {
      return {
        success: false,
        fromAgent,
        toAgent,
        conversationId: conversationId ?? "",
        reason: `Target agent "${toAgent}" not found`,
      };
    }

    // Check target is not offline or error
    if (targetAgent.status === "offline" || targetAgent.status === "error") {
      return {
        success: false,
        fromAgent,
        toAgent,
        conversationId: conversationId ?? "",
        reason: `Target agent "${toAgent}" is ${targetAgent.status}`,
      };
    }

    // Detect cycles — check if we already have a conversation and if the
    // handoff chain would loop back
    if (conversationId) {
      const cycleDetected = this.detectCycle(
        conversationId,
        fromAgent,
        toAgent,
      );
      if (cycleDetected) {
        return {
          success: false,
          fromAgent,
          toAgent,
          conversationId,
          reason: `Handoff cycle detected: ${toAgent} already handled this conversation`,
        };
      }
    }

    // Create or continue conversation
    const convId = conversationId ?? this.generateConversationId();

    if (!conversationId) {
      // New conversation
      this.store.createConversation(convId, [fromAgent, toAgent], {
        handoffChain: [fromAgent],
        taskContext: request.taskContext,
      });
    } else {
      // Existing conversation — update participants and state
      const existing = this.store.getConversation(convId);
      if (existing) {
        const participants = existing.participants.includes(toAgent)
          ? existing.participants
          : [...existing.participants, toAgent];
        const chain = (existing.state.handoffChain as string[]) || [];
        chain.push(fromAgent);

        this.store.updateConversationState(convId, {
          ...existing.state,
          handoffChain: chain,
          taskContext: request.taskContext,
        });

        // Update participants by recreating (store doesn't have updateParticipants)
        this.store.createConversation(convId, participants, {
          ...existing.state,
          handoffChain: chain,
          taskContext: request.taskContext,
        });
      }
    }

    // Record the handoff event as a conversation message
    this.store.addConversationMessage({
      id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: convId,
      agentId: fromAgent,
      role: "system",
      content: `Handoff from ${fromAgent} to ${toAgent}: ${reason}`,
      metadata: { type: "handoff", preserveHistory },
      createdAt: new Date().toISOString(),
    });

    // If not preserving history, trim old messages
    if (!preserveHistory && conversationId) {
      this.store.trimConversationMessages(convId, 5);
    }

    return {
      success: true,
      fromAgent,
      toAgent,
      conversationId: convId,
      reason,
    };
  }

  /**
   * Get the conversation context for a handoff target agent.
   * Returns recent messages and accumulated task context.
   */
  getHandoffContext(conversationId: string): {
    messages: Array<{ agentId: string; role: string; content: string }>;
    taskContext: Record<string, unknown>;
    handoffChain: string[];
  } {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      return { messages: [], taskContext: {}, handoffChain: [] };
    }

    const messages = this.store.getConversationMessages(conversationId, 20);
    return {
      messages: messages.map((m) => ({
        agentId: m.agentId,
        role: m.role,
        content: m.content,
      })),
      taskContext:
        (conversation.state.taskContext as Record<string, unknown>) ?? {},
      handoffChain: (conversation.state.handoffChain as string[]) ?? [],
    };
  }

  /**
   * Parse a handoff request from an LLM response.
   * Looks for ```handoff {...}``` blocks.
   */
  static parseHandoffFromResponse(response: string): {
    toAgent: string;
    reason: string;
  } | null {
    const match = response.match(/```handoff\s*\n?\s*\{([^}]+)\}\s*\n?\s*```/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(`{${match[1]}}`);
      if (parsed.toAgent && parsed.reason) {
        return { toAgent: parsed.toAgent, reason: parsed.reason };
      }
    } catch {
      // Try line-based parsing for simpler format
      const lines = match[1].trim().split("\n");
      const obj: Record<string, string> = {};
      for (const line of lines) {
        const [key, ...rest] = line.split(":");
        if (key && rest.length) {
          obj[key.trim().replace(/['"]/g, "")] = rest
            .join(":")
            .trim()
            .replace(/^['"]|['"],?$/g, "");
        }
      }
      if (obj.toAgent && obj.reason) {
        return { toAgent: obj.toAgent, reason: obj.reason };
      }
    }
    return null;
  }

  // ── Private ────────────────────────────────────────────────

  private detectCycle(
    conversationId: string,
    fromAgent: string,
    toAgent: string,
  ): boolean {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) return false;

    const chain = (conversation.state.handoffChain as string[]) || [];

    // If the chain is too long, treat as cycle
    if (chain.length >= this.maxChainLength) return true;

    // If toAgent already appears in chain, it's a cycle
    return chain.includes(toAgent);
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
