// -----------------------------------------------------------------
// AETHER Conflict Resolution Engine
//
// Detects and resolves conflicts between multiple agent outputs.
// Supports multiple resolution strategies: majority vote, weighted
// by tier/confidence, LLM mediation, and merge.
// -----------------------------------------------------------------

import type { ConflictStrategy, ConflictReport, AgentTier } from "./types.ts";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

/** An agent's output with metadata for conflict analysis */
export interface AgentOutput {
  agentId: string;
  tier: AgentTier;
  output: string;
  confidence?: number;
}

/** Resolved output after conflict resolution */
export interface ResolvedOutput {
  output: string;
  strategy: ConflictStrategy;
  report: ConflictReport;
  participatingAgents: string[];
}

/** Callback for LLM-mediated resolution */
export type LLMMediatorFn = (
  conflictSummary: string,
  outputs: AgentOutput[],
) => Promise<string>;

// -----------------------------------------------------------------
// Conflict Resolver
// -----------------------------------------------------------------

export class ConflictResolver {
  private llmMediator: LLMMediatorFn | null = null;

  /**
   * Set the LLM mediator function for "llm-mediator" strategy.
   */
  setLLMMediator(fn: LLMMediatorFn): void {
    this.llmMediator = fn;
  }

  /**
   * Analyze multiple agent outputs for conflicts.
   * Identifies agreements, contradictions, and unique contributions.
   */
  analyze(outputs: AgentOutput[]): ConflictReport {
    if (outputs.length === 0) {
      return { agreements: [], contradictions: [], uniqueContributions: [] };
    }

    if (outputs.length === 1) {
      return {
        agreements: [],
        contradictions: [],
        uniqueContributions: [
          { agentId: outputs[0].agentId, content: outputs[0].output },
        ],
      };
    }

    const agreements: string[] = [];
    const contradictions: ConflictReport["contradictions"] = [];
    const uniqueContributions: ConflictReport["uniqueContributions"] = [];

    // Extract key sentences from each output
    const agentSentences = outputs.map((o) => ({
      agentId: o.agentId,
      sentences: this.extractSentences(o.output),
    }));

    // Find agreements: sentences that appear (similar) in multiple outputs
    const sentenceSeen = new Map<string, Set<string>>(); // normalized sentence → set of agent IDs

    for (const { agentId, sentences } of agentSentences) {
      for (const sentence of sentences) {
        const normalized = this.normalizeSentence(sentence);
        if (normalized.length < 10) continue; // skip very short

        let matched = false;
        for (const [existing, agents] of sentenceSeen) {
          if (this.sentenceSimilarity(normalized, existing) > 0.7) {
            agents.add(agentId);
            matched = true;
            break;
          }
        }
        if (!matched) {
          sentenceSeen.set(normalized, new Set([agentId]));
        }
      }
    }

    // Sentences agreed upon by 2+ agents
    for (const [sentence, agents] of sentenceSeen) {
      if (agents.size >= 2) {
        agreements.push(sentence);
      }
    }

    // Find contradictions: look for opposing sentiment or conflicting statements
    // Simple heuristic: if agents produce outputs with very different key terms
    // while discussing the same topic
    const topicGroups = this.groupByTopic(outputs);
    for (const [topic, topicOutputs] of topicGroups) {
      if (topicOutputs.length < 2) continue;

      // Check if outputs have low similarity (potential contradiction)
      for (let i = 0; i < topicOutputs.length; i++) {
        for (let j = i + 1; j < topicOutputs.length; j++) {
          const sim = this.textSimilarity(
            topicOutputs[i].output,
            topicOutputs[j].output,
          );
          if (sim < 0.3) {
            // Low similarity on same topic = potential contradiction
            contradictions.push({
              topic,
              positions: [
                {
                  agentId: topicOutputs[i].agentId,
                  output: topicOutputs[i].output.slice(0, 300),
                },
                {
                  agentId: topicOutputs[j].agentId,
                  output: topicOutputs[j].output.slice(0, 300),
                },
              ],
            });
          }
        }
      }
    }

    // Unique contributions: content from an agent not found in any other output
    for (const { agentId, sentences } of agentSentences) {
      const uniqueSentences: string[] = [];
      for (const sentence of sentences) {
        const normalized = this.normalizeSentence(sentence);
        if (normalized.length < 10) continue;
        const agents = sentenceSeen.get(normalized);
        if (agents && agents.size === 1) {
          uniqueSentences.push(sentence);
        }
      }
      if (uniqueSentences.length > 0) {
        uniqueContributions.push({
          agentId,
          content: uniqueSentences.join(" "),
        });
      }
    }

    return { agreements, contradictions, uniqueContributions };
  }

  /**
   * Resolve conflicts using the specified strategy.
   * Returns a unified output string.
   */
  async resolve(
    outputs: AgentOutput[],
    strategy: ConflictStrategy,
  ): Promise<ResolvedOutput> {
    const report = this.analyze(outputs);

    let resolvedOutput: string;

    switch (strategy) {
      case "majority-vote":
        resolvedOutput = this.resolveMajorityVote(outputs, report);
        break;
      case "weighted-by-tier":
        resolvedOutput = this.resolveWeightedByTier(outputs);
        break;
      case "weighted-by-confidence":
        resolvedOutput = this.resolveWeightedByConfidence(outputs);
        break;
      case "llm-mediator":
        resolvedOutput = await this.resolveLLMMediator(outputs, report);
        break;
      case "merge":
        resolvedOutput = this.resolveMerge(outputs, report);
        break;
      default:
        resolvedOutput = this.resolveMerge(outputs, report);
    }

    return {
      output: resolvedOutput,
      strategy,
      report,
      participatingAgents: outputs.map((o) => o.agentId),
    };
  }

  // -- Resolution strategies ------------------------------------

  /**
   * Majority vote: pick the output most similar to the consensus.
   */
  private resolveMajorityVote(
    outputs: AgentOutput[],
    report: ConflictReport,
  ): string {
    if (outputs.length === 0) return "";
    if (outputs.length === 1) return outputs[0].output;

    // Calculate centroid: average similarity to all other outputs
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < outputs.length; i++) {
      let totalSim = 0;
      for (let j = 0; j < outputs.length; j++) {
        if (i === j) continue;
        totalSim += this.textSimilarity(outputs[i].output, outputs[j].output);
      }
      const avgSim = totalSim / (outputs.length - 1);
      if (avgSim > bestScore) {
        bestScore = avgSim;
        bestIdx = i;
      }
    }

    return outputs[bestIdx].output;
  }

  /**
   * Weighted by tier: master > manager > worker.
   */
  private resolveWeightedByTier(outputs: AgentOutput[]): string {
    const tierWeights: Record<string, number> = {
      sentinel: 5,
      forge: 4,
      master: 3,
      manager: 2,
      worker: 1,
    };

    let bestOutput = outputs[0];
    let bestWeight = tierWeights[outputs[0].tier] ?? 1;

    for (const output of outputs) {
      const weight = tierWeights[output.tier] ?? 1;
      if (weight > bestWeight) {
        bestWeight = weight;
        bestOutput = output;
      }
    }

    return bestOutput.output;
  }

  /**
   * Weighted by confidence: pick highest confidence output.
   */
  private resolveWeightedByConfidence(outputs: AgentOutput[]): string {
    let bestOutput = outputs[0];
    let bestConf = outputs[0].confidence ?? 0.5;

    for (const output of outputs) {
      const conf = output.confidence ?? 0.5;
      if (conf > bestConf) {
        bestConf = conf;
        bestOutput = output;
      }
    }

    return bestOutput.output;
  }

  /**
   * LLM mediator: send conflicts to an LLM for resolution.
   */
  private async resolveLLMMediator(
    outputs: AgentOutput[],
    report: ConflictReport,
  ): Promise<string> {
    if (!this.llmMediator) {
      // Fall back to merge if no mediator configured
      return this.resolveMerge(outputs, report);
    }

    const summary = this.formatConflictSummary(report);
    return this.llmMediator(summary, outputs);
  }

  /**
   * Merge: combine unique contributions, flag contradictions inline.
   */
  private resolveMerge(outputs: AgentOutput[], report: ConflictReport): string {
    const parts: string[] = [];

    // Add agreements
    if (report.agreements.length > 0) {
      parts.push("## Agreed Points");
      for (const agreement of report.agreements) {
        parts.push("- " + agreement);
      }
      parts.push("");
    }

    // Add unique contributions
    if (report.uniqueContributions.length > 0) {
      parts.push("## Contributions");
      for (const contrib of report.uniqueContributions) {
        parts.push("### From " + contrib.agentId);
        parts.push(contrib.content);
        parts.push("");
      }
    }

    // Flag contradictions
    if (report.contradictions.length > 0) {
      parts.push("## Unresolved Contradictions");
      for (const contradiction of report.contradictions) {
        parts.push("### Topic: " + contradiction.topic);
        for (const pos of contradiction.positions) {
          parts.push("- **" + pos.agentId + "**: " + pos.output);
        }
        parts.push("");
      }
    }

    // If nothing structured, fall back to concatenation
    if (parts.length === 0) {
      return outputs.map((o) => o.output).join("\n\n---\n\n");
    }

    return parts.join("\n");
  }

  // -- Helpers --------------------------------------------------

  private extractSentences(text: string): string[] {
    return text
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
  }

  private normalizeSentence(sentence: string): string {
    return sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim();
  }

  /**
   * Simple word-overlap similarity between two texts.
   * Returns 0-1.
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(
      a
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
    const wordsB = new Set(
      b
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    return (2 * overlap) / (wordsA.size + wordsB.size);
  }

  private sentenceSimilarity(a: string, b: string): number {
    return this.textSimilarity(a, b);
  }

  /**
   * Group outputs by detected topic.
   * Simple heuristic: extract top keywords from each output.
   */
  private groupByTopic(outputs: AgentOutput[]): Map<string, AgentOutput[]> {
    // Extract top 3 keywords from each output as topic key
    const groups = new Map<string, AgentOutput[]>();

    for (const output of outputs) {
      const keywords = this.extractKeywords(output.output, 3);
      const topic = keywords.join("+") || "general";

      // Find if there's a similar topic already
      let matched = false;
      for (const [existingTopic, group] of groups) {
        const existingKw = existingTopic.split("+");
        const overlap = keywords.filter((k) => existingKw.includes(k));
        if (overlap.length >= 1) {
          group.push(output);
          matched = true;
          break;
        }
      }

      if (!matched) {
        groups.set(topic, [output]);
      }
    }

    return groups;
  }

  private extractKeywords(text: string, count: number): string[] {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "shall",
      "can",
      "need",
      "dare",
      "ought",
      "used",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "and",
      "but",
      "or",
      "nor",
      "not",
      "so",
      "yet",
      "both",
      "either",
      "neither",
      "each",
      "every",
      "all",
      "any",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "only",
      "same",
      "than",
      "too",
      "very",
      "just",
      "because",
      "this",
      "that",
      "these",
      "those",
      "it",
      "its",
      "they",
      "them",
      "their",
      "we",
      "our",
      "you",
      "your",
      "he",
      "she",
      "his",
      "her",
      "i",
      "me",
      "my",
    ]);

    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    // Count frequency
    const freq = new Map<string, number>();
    for (const word of words) {
      const clean = word.replace(/[^a-z0-9]/g, "");
      if (clean.length > 3) {
        freq.set(clean, (freq.get(clean) ?? 0) + 1);
      }
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([word]) => word);
  }

  private formatConflictSummary(report: ConflictReport): string {
    const parts: string[] = ["Conflict Analysis:"];

    if (report.agreements.length > 0) {
      parts.push("Agreements: " + report.agreements.join("; "));
    }

    if (report.contradictions.length > 0) {
      parts.push("Contradictions:");
      for (const c of report.contradictions) {
        parts.push(
          "  Topic '" +
            c.topic +
            "': " +
            c.positions
              .map((p) => p.agentId + " says: " + p.output.slice(0, 100))
              .join(" vs. "),
        );
      }
    }

    return parts.join("\n");
  }
}
