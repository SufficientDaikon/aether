// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: RAG Index at Scale Stress Test
// Index 500 synthetic documents, run 20 queries,
// measure latency p50/p95/p99
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.7",
    "RAGIndex -- 500 documents indexed, 20 queries with latency percentiles",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      const TIMEOUT_MS = 60_000;

      try {
        const { RAGIndex } = await import("../../core/rag-index.ts");
        const { Embedder } = await import("../../core/embedder.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-stress-rag-"));
        const logger = new SynapseLogger(tempDir, "warn");

        try {
          const embedder = new Embedder(logger, {
            defaultMode: "tfidf",
            tfidfDimension: 384,
            enableCache: true,
            cacheMaxSize: 10_000,
          });

          // RAGIndex without store (in-memory only via embedder)
          const ragIndex = new RAGIndex(embedder, logger, {
            defaultTopK: 5,
            minScore: 0.1,
            enableBM25: false,
          });

          await ragIndex.initialize();
          details.push("RAGIndex initialized with TF-IDF embedder");
          score += 1;

          // Generate 500 synthetic documents
          const DOC_COUNT = 500;
          const topics = [
            "machine learning",
            "web development",
            "database optimization",
            "security audit",
            "user experience",
            "API design",
            "testing strategy",
            "deployment pipeline",
            "performance tuning",
            "code review",
            "error handling",
            "authentication",
            "data modeling",
            "frontend architecture",
            "backend services",
            "microservices",
            "containerization",
            "monitoring",
            "logging",
            "caching",
          ];

          const adjectives = [
            "advanced",
            "basic",
            "comprehensive",
            "detailed",
            "efficient",
            "flexible",
            "global",
            "high-performance",
            "innovative",
            "just-in-time",
          ];

          const verbs = [
            "implementing",
            "optimizing",
            "designing",
            "building",
            "testing",
            "deploying",
            "monitoring",
            "scaling",
            "debugging",
            "refactoring",
          ];

          const generateDoc = (i: number): string => {
            const topic = topics[i % topics.length];
            const adj = adjectives[i % adjectives.length];
            const verb = verbs[i % verbs.length];
            return (
              `Document ${i}: ${adj} ${topic} guide. ` +
              `This document covers ${verb} ${topic} in production environments. ` +
              `Key considerations include scalability, maintainability, and reliability. ` +
              `Section ${Math.floor(i / 50) + 1} focuses on practical implementation patterns ` +
              `for ${topic} using modern tooling and best practices. ` +
              `Performance benchmarks show improvements of ${10 + (i % 30)}% when applying these techniques.`
            );
          };

          // Index all 500 documents
          const indexStart = performance.now();

          const indexPromise = (async () => {
            for (let i = 0; i < DOC_COUNT; i++) {
              const text = generateDoc(i);
              // Add to embedder corpus for better TF-IDF scores
              embedder.addToCorpus(text);
              await ragIndex.index("docs", text, {
                sourceId: `doc-${i}`,
                contentType: "text",
                boost: 1.0,
              });
            }
          })();

          await Promise.race([
            indexPromise,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Indexing timed out")),
                TIMEOUT_MS,
              ),
            ),
          ]);

          const indexElapsed = performance.now() - indexStart;
          details.push(
            `Indexed ${DOC_COUNT} documents in ${indexElapsed.toFixed(0)}ms (${(indexElapsed / DOC_COUNT).toFixed(1)}ms/doc)`,
          );
          score += 2;

          // Run 20 queries and collect latencies
          const QUERY_COUNT = 20;
          const queries = [
            "machine learning optimization",
            "web development testing",
            "database performance tuning",
            "security vulnerability scanning",
            "user experience design patterns",
            "REST API design best practices",
            "automated testing strategy",
            "CI/CD deployment pipeline",
            "application performance monitoring",
            "code review checklist",
            "error handling patterns",
            "OAuth authentication flow",
            "data modeling techniques",
            "React frontend architecture",
            "Node.js backend services",
            "microservices communication",
            "Docker containerization",
            "Prometheus monitoring setup",
            "structured logging implementation",
            "Redis caching strategy",
          ];

          const latencies: number[] = [];
          let totalResults = 0;

          const queryPromise = (async () => {
            for (let i = 0; i < QUERY_COUNT; i++) {
              const qStart = performance.now();
              const results = await ragIndex.query(queries[i], {
                topK: 5,
              });
              const qElapsed = performance.now() - qStart;
              latencies.push(qElapsed);
              totalResults += results.length;
            }
          })();

          await Promise.race([
            queryPromise,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Queries timed out")),
                TIMEOUT_MS,
              ),
            ),
          ]);

          // Calculate percentiles
          latencies.sort((a, b) => a - b);
          const p50 = latencies[Math.floor(latencies.length * 0.5)];
          const p95 = latencies[Math.floor(latencies.length * 0.95)];
          const p99 = latencies[Math.floor(latencies.length * 0.99)];
          const avgLatency =
            latencies.reduce((s, l) => s + l, 0) / latencies.length;

          details.push(
            `Query latencies: p50=${p50.toFixed(1)}ms, p95=${p95.toFixed(1)}ms, p99=${p99.toFixed(1)}ms, avg=${avgLatency.toFixed(1)}ms`,
          );
          details.push(
            `Total results across ${QUERY_COUNT} queries: ${totalResults} (avg ${(totalResults / QUERY_COUNT).toFixed(1)}/query)`,
          );

          // Score based on query performance
          if (p95 < 100) {
            score += 3;
            details.push("Excellent query performance (p95 < 100ms)");
          } else if (p95 < 500) {
            score += 2;
            details.push("Good query performance (p95 < 500ms)");
          } else if (p95 < 2000) {
            score += 1;
            details.push("Acceptable query performance (p95 < 2s)");
          } else {
            details.push("Slow query performance (p95 >= 2s)");
          }

          // Verify results were returned
          if (totalResults > 0) {
            score += 2;
            details.push("Queries returned results");
          } else {
            details.push("WARNING: no results returned from any query");
          }

          // Check RAG metrics
          const ragMetrics = ragIndex.getMetrics();
          details.push(
            `RAG metrics: totalItems=${ragMetrics.totalItems}, totalQueries=${ragMetrics.totalQueries}, avgQueryMs=${ragMetrics.averageQueryMs.toFixed(1)}`,
          );

          if (ragMetrics.totalItems >= DOC_COUNT * 0.9) {
            score += 2;
            details.push(`Index contains ${ragMetrics.totalItems} items`);
          }

          // Cleanup embedder
          embedder.shutdown();
          await ragIndex.shutdown();
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
        if (tempDir) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
        }
      }

      return {
        score,
        maxScore,
        details: details.join("; "),
        metadata: { test: "rag-at-scale" },
      };
    },
  );
}
