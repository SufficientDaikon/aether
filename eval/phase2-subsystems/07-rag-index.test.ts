// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: RAGIndex Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.7.1: Initialize, index, and query ──────────────
  await harness.runTest(
    "2.7.1",
    "RAGIndex — Initialize, index a document, query, verify results",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 15;
      const details: string[] = [];

      try {
        const { RAGIndex } = await import("../../core/rag-index.ts");
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const logger = new SynapseLogger(tempDir, "debug");
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
          });
          const ragIndex = new RAGIndex(embedder, logger, {}, store);

          // Initialize
          await ragIndex.initialize();
          details.push("RAGIndex initialized");
          score += 3;

          // Index documents
          const id1 = await ragIndex.index(
            "docs",
            "React component architecture and best practices for building scalable UIs",
            {
              sourceId: "doc-react",
              contentType: "text",
            },
          );
          details.push(`Indexed doc 1: ${id1}`);
          score += 2;

          const id2 = await ragIndex.index(
            "docs",
            "PostgreSQL performance tuning and query optimization techniques",
            {
              sourceId: "doc-postgres",
              contentType: "text",
            },
          );
          details.push(`Indexed doc 2: ${id2}`);
          score += 2;

          // Add to corpus for better TF-IDF
          embedder.addToCorpus(
            "React component architecture and best practices",
          );
          embedder.addToCorpus(
            "PostgreSQL performance tuning and query optimization",
          );

          // Query for React-related content
          const results = await ragIndex.query(
            "React component UI architecture",
          );
          if (Array.isArray(results) && results.length >= 1) {
            details.push(`Query returned ${results.length} result(s)`);
            score += 4;

            // Verify the top result is about React
            const topResult = results[0];
            if (
              topResult.text &&
              topResult.text.toLowerCase().includes("react")
            ) {
              details.push("Top result contains 'react'");
              score += 2;
            }

            if (typeof topResult.score === "number" && topResult.score > 0) {
              details.push(`Top result score: ${topResult.score.toFixed(3)}`);
              score += 2;
            }
          } else {
            details.push("Query returned no results");
          }

          await ragIndex.shutdown();
          await store.close();
          await logger.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.7.2: Namespace Isolation ───────────────────────
  await harness.runTest("2.7.2", "RAGIndex — Namespace isolation", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 15;
    const details: string[] = [];

    try {
      const { RAGIndex } = await import("../../core/rag-index.ts");
      const { Embedder } = await import("../../core/embedder.ts");
      const { SynapseLogger } = await import("../../core/logger.ts");
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");

      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const logger = new SynapseLogger(tempDir, "debug");
      const store = new SQLiteStore(tempDir);
      await store.init();

      try {
        const embedder = new Embedder(logger, {
          defaultMode: "tfidf",
          tfidfDimension: 384,
        });
        const ragIndex = new RAGIndex(embedder, logger, {}, store);
        await ragIndex.initialize();

        // Index in different namespaces
        await ragIndex.index(
          "agents",
          "React specialist agent for frontend development",
          {
            sourceId: "agent-react",
            contentType: "agent",
          },
        );
        details.push("Indexed in 'agents' namespace");
        score += 3;

        await ragIndex.index(
          "code",
          "function renderComponent() { return <div>Hello</div>; }",
          {
            sourceId: "file-component.tsx",
            contentType: "code",
          },
        );
        details.push("Indexed in 'code' namespace");
        score += 3;

        // Add to corpus
        embedder.addToCorpus("React specialist agent for frontend development");
        embedder.addToCorpus("function renderComponent return div Hello");

        // Query agents namespace only
        const agentResults = await ragIndex.query("React frontend", {
          namespace: "agents",
        });
        if (Array.isArray(agentResults)) {
          const agentOnly = agentResults.every((r) => r.namespace === "agents");
          if (agentOnly) {
            details.push(
              `Agents namespace query returned ${agentResults.length} result(s), all from 'agents'`,
            );
            score += 5;
          } else {
            details.push(
              "Agents namespace query leaked results from other namespaces",
            );
            score += 2;
          }
        }

        // Query code namespace only
        const codeResults = await ragIndex.query("renderComponent function", {
          namespace: "code",
        });
        if (Array.isArray(codeResults)) {
          const codeOnly = codeResults.every((r) => r.namespace === "code");
          if (codeOnly) {
            details.push(
              `Code namespace query returned ${codeResults.length} result(s), all from 'code'`,
            );
            score += 4;
          } else {
            details.push(
              "Code namespace query leaked results from other namespaces",
            );
            score += 2;
          }
        }

        await ragIndex.shutdown();
        await store.close();
        await logger.close();
      } catch (err) {
        details.push(
          `Inner error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      details.push(
        `Import error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (tempDir)
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    return { score, maxScore, details: details.join("; ") };
  });
}
