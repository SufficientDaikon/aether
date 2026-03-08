// ─────────────────────────────────────────────────────────────
// Phase 5 — Test 06: RAG Context Enrichment
// Indexes 5 sample documents about AETHER into a RAGIndex,
// queries for relevant context, prepends it to a Gemini prompt,
// and verifies the response references the indexed content.
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import type { GeminiWrapper } from "../helpers/gemini-wrapper.ts";
import type { CostTracker } from "../helpers/cost-tracker.ts";

import { RAGIndex } from "../../core/rag-index.ts";
import { Embedder } from "../../core/embedder.ts";
import { SynapseLogger } from "../../core/logger.ts";
import { SQLiteStore } from "../../core/storage/sqlite-store.ts";

export async function run(
  harness: TestHarness,
  gemini: GeminiWrapper,
  _costTracker: CostTracker,
): Promise<void> {
  await harness.runTest(
    "5.06",
    "RAG Enriched — context-aware Gemini response",
    async () => {
      try {
        // Set up infrastructure
        const tmpDir = `.aether/eval-phase5-06-${Date.now()}`;
        const store = new SQLiteStore(tmpDir);
        await store.init();

        const logger = new SynapseLogger(tmpDir, "warn");
        const embedder = new Embedder(logger, { defaultMode: "tfidf" }, store);
        const ragIndex = new RAGIndex(
          embedder,
          logger,
          { defaultTopK: 3, minScore: 0.05 },
          store,
        );
        await ragIndex.initialize();

        // Index 5 sample documents about AETHER
        const documents = [
          {
            text:
              "AETHER uses a tiered agent hierarchy: sentinel, forge, master, manager, and worker. " +
              "Each tier has different authority levels and LLM model requirements. Workers use gemini-flash, " +
              "managers use gemini-pro, and master/sentinel use gemini-ultra.",
            sourceId: "aether-hierarchy-doc",
          },
          {
            text:
              "The AgentRouter in AETHER uses multi-strategy resolution: direct ID matching, " +
              "file ownership routing, capability token scoring, historical success analysis, " +
              "section-based fallback, and load balancing. It includes an LRU routing cache.",
            sourceId: "aether-routing-doc",
          },
          {
            text:
              "AETHER's MemoryHighway provides pub/sub messaging between agents with persistent " +
              "history stored in SQLite. It supports deduplication, priority filtering, and " +
              "automatic RAG indexing of high-priority messages.",
            sourceId: "aether-memory-doc",
          },
          {
            text:
              "The DurableWorkflow engine in AETHER checkpoints state to SQLite after each step. " +
              "On crash or restart, workflows resume from the last checkpoint. It supports " +
              "human-in-the-loop approval gates and abort functionality.",
            sourceId: "aether-durable-doc",
          },
          {
            text:
              "AETHER's InteractionNet provides deadlock-free parallel execution using interaction " +
              "combinator graph reduction. Tasks are modeled as nodes connected by wires, and the " +
              "NetScheduler reduces the graph to normal form for optimal parallelism.",
            sourceId: "aether-inet-doc",
          },
        ];

        // Index all documents
        const indexedIds: string[] = [];
        for (const doc of documents) {
          const id = await ragIndex.index("docs", doc.text, {
            sourceId: doc.sourceId,
            contentType: "documentation",
          });
          indexedIds.push(id);
        }

        let score = 0;
        const details: string[] = [];

        // Verify indexing worked
        const metrics = ragIndex.getMetrics();
        if (metrics.totalItems >= 5) {
          score += 2;
          details.push(`Successfully indexed ${metrics.totalItems} documents.`);
        } else {
          details.push(`Only indexed ${metrics.totalItems}/5 documents.`);
        }

        // Query for relevant context about agent routing
        const queryResults = await ragIndex.query(
          "How does AETHER route tasks to agents?",
          { topK: 3 },
        );

        if (queryResults.length > 0) {
          score += 2;
          details.push(
            `RAG query returned ${queryResults.length} results. Top score: ${queryResults[0].score.toFixed(3)}.`,
          );
        } else {
          details.push("RAG query returned 0 results.");
        }

        // Build enriched prompt with RAG context
        const ragContext = queryResults
          .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(2)})\n${r.text}`)
          .join("\n\n");

        const enrichedPrompt =
          "You have access to the following documentation about the AETHER framework:\n\n" +
          ragContext +
          "\n\n---\n\n" +
          "Based on the documentation above, explain how AETHER routes tasks to the appropriate agent. " +
          "Reference specific strategies mentioned in the docs. Be concise (under 200 words).";

        // Call Gemini with enriched prompt
        const geminiStart = Date.now();
        const response = await gemini.send(enrichedPrompt, {
          model: "gemini-2.5-flash",
          maxTokens: 400,
        });
        const geminiLatency = Date.now() - geminiStart;

        // Verify the response references content from the indexed documents
        const responseText = response.content.toLowerCase();
        const referencesRouting =
          responseText.includes("routing") ||
          responseText.includes("router") ||
          responseText.includes("capability") ||
          responseText.includes("resolution");
        const referencesSpecificStrategy =
          responseText.includes("token") ||
          responseText.includes("file ownership") ||
          responseText.includes("section") ||
          responseText.includes("load balanc") ||
          responseText.includes("direct id") ||
          responseText.includes("historical") ||
          responseText.includes("cache");

        if (referencesRouting) {
          score += 3;
          details.push(
            "Gemini response references routing concepts from indexed docs.",
          );
        } else {
          details.push(
            "Gemini response does not reference routing from indexed docs.",
          );
        }

        if (referencesSpecificStrategy) {
          score += 3;
          details.push(
            "Gemini response mentions specific routing strategies from the docs.",
          );
        } else {
          details.push(
            "Gemini response does not mention specific routing strategies.",
          );
        }

        // Cap at 10
        score = Math.min(score, 10);

        // Clean up
        await ragIndex.shutdown();
        await store.close();

        return {
          score,
          maxScore: 10,
          details: details.join("\n"),
          metadata: {
            indexedDocuments: indexedIds.length,
            ragQueryResults: queryResults.length,
            topRagScore: queryResults[0]?.score ?? 0,
            geminiLatencyMs: geminiLatency,
            geminiTokens: response.tokensUsed,
            responsePreview: response.content.slice(0, 400),
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          score: 0,
          maxScore: 10,
          details: `RAG enrichment test failed: ${msg}`,
          metadata: { error: msg },
        };
      }
    },
  );
}
