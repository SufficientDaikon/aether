// -----------------------------------------------------------------
// AETHER Group Chat Orchestration
//
// Multiple agents discuss a problem in rounds. A speaker selector
// picks who speaks next based on conversation history, capability
// relevance, or round-robin. Terminates on consensus, max rounds,
// or a termination condition.
// -----------------------------------------------------------------

import type {
  AgentDefinition,
  GroupChatConfig,
  SpeakerSelector,
  TerminationCondition,
  ConversationMessage,
} from "./types.ts";
import type { AetherStore } from "./storage/store.ts";
import { ConversationManager } from "./conversation.ts";

// -----------------------------------------------------------------
// Built-in Speaker Selectors
// -----------------------------------------------------------------

/** Round-robin through participants */
export class RoundRobinSelector implements SpeakerSelector {
  selectNext(
    _history: ConversationMessage[],
    participants: AgentDefinition[],
    round: number,
  ): AgentDefinition {
    return participants[round % participants.length];
  }
}

/**
 * Capability-based speaker selection.
 * Picks the agent whose capabilities best match the last message topic.
 */
export class CapabilitySelector implements SpeakerSelector {
  selectNext(
    history: ConversationMessage[],
    participants: AgentDefinition[],
    round: number,
  ): AgentDefinition {
    if (history.length === 0) {
      return participants[round % participants.length];
    }

    const lastMessage = history[history.length - 1].content.toLowerCase();
    const words = lastMessage.split(/\s+/);

    let bestAgent = participants[0];
    let bestScore = -1;

    for (const agent of participants) {
      let score = 0;
      for (const cap of agent.capabilities) {
        const capWords = cap.toLowerCase().split(/\s+/);
        for (const cw of capWords) {
          if (words.some((w) => w.includes(cw) || cw.includes(w))) {
            score++;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    // If no capability match, fall back to round-robin
    if (bestScore === 0) {
      return participants[round % participants.length];
    }

    return bestAgent;
  }
}

// -----------------------------------------------------------------
// Built-in Termination Conditions
// -----------------------------------------------------------------

/** Terminate after a fixed number of rounds */
export class MaxRoundsTerminator implements TerminationCondition {
  private maxRounds: number;

  constructor(maxRounds: number) {
    this.maxRounds = maxRounds;
  }

  shouldTerminate(_history: ConversationMessage[], round: number): boolean {
    return round >= this.maxRounds;
  }
}

/** Terminate when any output contains a keyword */
export class KeywordTerminator implements TerminationCondition {
  private keyword: string;

  constructor(keyword: string = "FINAL ANSWER") {
    this.keyword = keyword.toUpperCase();
  }

  shouldTerminate(history: ConversationMessage[], _round: number): boolean {
    if (history.length === 0) return false;
    const last = history[history.length - 1].content.toUpperCase();
    return last.includes(this.keyword);
  }
}

/**
 * Terminate when all participants have spoken in the last N messages
 * and their outputs are converging (no major disagreements).
 */
export class ConsensusTerminator implements TerminationCondition {
  private minRounds: number;

  constructor(minRounds: number = 2) {
    this.minRounds = minRounds;
  }

  shouldTerminate(history: ConversationMessage[], round: number): boolean {
    if (round < this.minRounds) return false;

    // Check if last round of messages are short confirmations
    const recentMessages = history.slice(-3);
    const shortConfirmations = recentMessages.filter(
      (m) =>
        m.content.length < 200 &&
        /(?:agree|confirmed|approved|looks good|lgtm|correct|yes)/i.test(
          m.content,
        ),
    );

    return shortConfirmations.length >= Math.min(recentMessages.length, 2);
  }
}

// -----------------------------------------------------------------
// Group Chat Engine
// -----------------------------------------------------------------

export interface GroupChatResult {
  conversationId: string;
  rounds: number;
  finalOutput: string;
  history: ConversationMessage[];
  terminationReason: string;
}

export class GroupChat {
  private config: GroupChatConfig;
  private store: AetherStore;
  private conversationManager: ConversationManager;
  private speakerSelector: SpeakerSelector;
  private terminationConditions: TerminationCondition[];
  private participants: AgentDefinition[];

  constructor(
    config: GroupChatConfig,
    store: AetherStore,
    participants: AgentDefinition[],
    options?: {
      speakerSelector?: SpeakerSelector;
      terminationConditions?: TerminationCondition[];
    },
  ) {
    this.config = config;
    this.store = store;
    this.participants = participants;
    this.conversationManager = new ConversationManager(store);

    // Set up speaker selector
    if (options?.speakerSelector) {
      this.speakerSelector = options.speakerSelector;
    } else {
      switch (config.speakerSelection) {
        case "capability":
          this.speakerSelector = new CapabilitySelector();
          break;
        case "round-robin":
        default:
          this.speakerSelector = new RoundRobinSelector();
          break;
      }
    }

    // Set up termination conditions
    this.terminationConditions = options?.terminationConditions ?? [
      new MaxRoundsTerminator(config.maxRounds),
    ];

    if (config.terminationKeyword) {
      this.terminationConditions.push(
        new KeywordTerminator(config.terminationKeyword),
      );
    }
  }

  /**
   * Run the group chat.
   * executeRound is the callback that the executor provides to actually
   * invoke an agent with a prompt and get a response.
   */
  async run(
    executeRound: (
      agent: AgentDefinition,
      prompt: string,
      history: ConversationMessage[],
    ) => Promise<string>,
  ): Promise<GroupChatResult> {
    // Create conversation
    const conversationId = this.conversationManager.create(
      this.participants.map((p) => p.id),
      { topic: this.config.topic, groupChatId: this.config.id },
    );

    // Add initial system message with topic
    this.conversationManager.addMessage(
      conversationId,
      "system",
      "system",
      "Group discussion topic: " +
        this.config.topic +
        "\nParticipants: " +
        this.participants.map((p) => p.name).join(", ") +
        "\nPlease discuss and work toward a solution.",
    );

    let round = 0;
    let terminationReason = "max-rounds";
    let finalOutput = "";

    while (round < this.config.maxRounds) {
      // Get history for context
      const history = this.conversationManager.getHistory(conversationId);

      // Check termination conditions
      let shouldStop = false;
      for (const condition of this.terminationConditions) {
        if (condition.shouldTerminate(history, round)) {
          shouldStop = true;
          if (condition instanceof MaxRoundsTerminator) {
            terminationReason = "max-rounds";
          } else if (condition instanceof KeywordTerminator) {
            terminationReason = "keyword";
          } else if (condition instanceof ConsensusTerminator) {
            terminationReason = "consensus";
          } else {
            terminationReason = "custom-condition";
          }
          break;
        }
      }
      if (shouldStop) break;

      // Select next speaker
      const speaker = this.speakerSelector.selectNext(
        history,
        this.participants,
        round,
      );

      // Build prompt for this speaker
      const prompt = this.buildRoundPrompt(speaker, round);

      // Execute the round
      const response = await executeRound(speaker, prompt, history);

      // Record the message
      this.conversationManager.addMessage(
        conversationId,
        speaker.id,
        "assistant",
        response,
        { round, speakerName: speaker.name },
      );

      finalOutput = response;
      round++;
    }

    // Get final history
    const fullHistory = this.conversationManager.getHistory(conversationId);

    // Mark conversation as completed
    this.store.updateConversationStatus(conversationId, "completed");

    return {
      conversationId,
      rounds: round,
      finalOutput,
      history: fullHistory,
      terminationReason,
    };
  }

  /** Get the conversation ID if chat has started */
  getParticipants(): AgentDefinition[] {
    return [...this.participants];
  }

  // -- Private helpers ------------------------------------------

  private buildRoundPrompt(speaker: AgentDefinition, round: number): string {
    return [
      "You are " + speaker.name + " participating in a group discussion.",
      "Topic: " + this.config.topic,
      "This is round " + (round + 1) + " of " + this.config.maxRounds + ".",
      "",
      "Your capabilities: " + speaker.capabilities.join(", "),
      "",
      "Review the conversation history above and contribute your perspective.",
      "Be specific and constructive. Build on what others have said.",
      "If you believe the discussion has reached a conclusion, include 'FINAL ANSWER' followed by the consolidated result.",
    ].join("\n");
  }
}
