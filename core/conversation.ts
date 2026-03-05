// ─────────────────────────────────────────────────────────────
// AETHER Conversation Manager
//
// Tracks multi-turn conversations between agents. Each conversation
// has an ID, participants, message history, and serializable state.
// Supports checkpoint/resume for durable workflows and conversation
// cleaning for handoffs.
// ─────────────────────────────────────────────────────────────

import type {
  ConversationMessage,
  ConversationStatus,
  ConversationState,
  ConversationRole,
} from "./types.ts";
import type { AetherStore } from "./storage/store.ts";

// ─────────────────────────────────────────────────────────────
// Conversation Manager
// ─────────────────────────────────────────────────────────────

export class ConversationManager {
  private store: AetherStore;
  private maxMessagesPerConversation: number;

  constructor(store: AetherStore, maxMessages: number = 100) {
    this.store = store;
    this.maxMessagesPerConversation = maxMessages;
  }

  /** Create a new conversation between participants */
  create(
    participants: string[],
    initialState?: Record<string, unknown>,
  ): string {
    const id =
      "conv-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    this.store.createConversation(id, participants, initialState);
    return id;
  }

  /** Get full conversation state */
  get(id: string): ConversationState | null {
    const conv = this.store.getConversation(id);
    if (!conv) return null;

    const messages = this.store.getConversationMessages(id);

    return {
      id: conv.id,
      participants: conv.participants,
      messages,
      state: conv.state,
      status: conv.status,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  /** Add a message to a conversation */
  addMessage(
    conversationId: string,
    agentId: string,
    role: ConversationRole,
    content: string,
    metadata?: Record<string, unknown>,
  ): ConversationMessage {
    const msg: ConversationMessage = {
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      conversationId,
      agentId,
      role,
      content,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
    };

    this.store.addConversationMessage(msg);

    // Auto-trim if exceeding max
    const messages = this.store.getConversationMessages(conversationId);
    if (messages.length > this.maxMessagesPerConversation) {
      this.store.trimConversationMessages(
        conversationId,
        this.maxMessagesPerConversation,
      );
    }

    return msg;
  }

  /** Get conversation history, optionally limited */
  getHistory(conversationId: string, limit?: number): ConversationMessage[] {
    return this.store.getConversationMessages(conversationId, limit);
  }

  /**
   * Get cleaned history for a handoff — strips system messages
   * and messages irrelevant to the target agent.
   * Microsoft's "conversation cleaning" concept.
   */
  getCleanHistory(
    conversationId: string,
    _forAgent: string,
    maxMessages: number = 20,
  ): ConversationMessage[] {
    const messages = this.store.getConversationMessages(conversationId);

    const clean = messages.filter((msg) => {
      if (msg.metadata?.type === "handoff") return true;
      if (msg.role === "user" || msg.role === "assistant") return true;
      if (msg.role === "tool") return true;
      return false;
    });

    return clean.slice(-maxMessages);
  }

  /** Update conversation status */
  setStatus(conversationId: string, status: ConversationStatus): void {
    this.store.updateConversationStatus(conversationId, status);
  }

  /** Update conversation state (merge) */
  updateState(conversationId: string, patch: Record<string, unknown>): void {
    const conv = this.store.getConversation(conversationId);
    if (!conv) return;

    this.store.updateConversationState(conversationId, {
      ...conv.state,
      ...patch,
    });
  }

  /**
   * Serialize conversation to a checkpoint for durable resume.
   * Returns a JSON-serializable snapshot.
   */
  checkpoint(conversationId: string): Record<string, unknown> | null {
    const conv = this.store.getConversation(conversationId);
    if (!conv) return null;

    const messages = this.store.getConversationMessages(conversationId);

    return {
      id: conv.id,
      participants: conv.participants,
      state: conv.state,
      status: conv.status,
      messages: messages.map((m) => ({
        id: m.id,
        agentId: m.agentId,
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.createdAt,
      })),
      checkpointedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a conversation from a checkpoint snapshot.
   * Returns the restored conversation ID.
   */
  restore(snapshot: Record<string, unknown>): string {
    const id = snapshot.id as string;
    const participants = snapshot.participants as string[];
    const state = snapshot.state as Record<string, unknown>;
    const messages = snapshot.messages as Array<{
      id: string;
      agentId: string;
      role: ConversationRole;
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;

    this.store.createConversation(id, participants, state);

    for (const msg of messages) {
      this.store.addConversationMessage({
        id: msg.id,
        conversationId: id,
        agentId: msg.agentId,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
        createdAt: msg.createdAt,
      });
    }

    return id;
  }

  /** Get all active conversations */
  getActive(): Array<{
    id: string;
    participants: string[];
    status: ConversationStatus;
    updatedAt: string;
  }> {
    return this.store.getConversationsByStatus("active").map((c) => ({
      id: c.id,
      participants: c.participants,
      status: c.status,
      updatedAt: c.updatedAt,
    }));
  }

  /** Get conversations by status */
  getByStatus(status: ConversationStatus): Array<{
    id: string;
    participants: string[];
    status: ConversationStatus;
    updatedAt: string;
  }> {
    return this.store.getConversationsByStatus(status).map((c) => ({
      id: c.id,
      participants: c.participants,
      status: c.status,
      updatedAt: c.updatedAt,
    }));
  }

  /**
   * Format conversation history as context for prompt injection.
   * Returns a formatted string suitable for LLM system/user messages.
   */
  formatForPrompt(conversationId: string, maxMessages: number = 10): string {
    const messages = this.getHistory(conversationId, maxMessages);
    if (messages.length === 0) return "";

    const lines = messages.map((m) => {
      const prefix =
        m.role === "system"
          ? "[System]"
          : m.role === "tool"
            ? "[Tool]"
            : "[" + m.agentId + "]";
      return prefix + " " + m.content;
    });

    return (
      "--- Conversation History ---\n" +
      lines.join("\n") +
      "\n--- End History ---"
    );
  }
}
