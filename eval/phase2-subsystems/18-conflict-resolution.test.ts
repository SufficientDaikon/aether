// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: ConflictResolver Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.18.1: Analyze conflicts from 3 agents ─────────────
  await harness.runTest(
    "2.18.1",
    "ConflictResolver — Analyze overlapping/contradicting outputs",
    async () => {
      let score = 0;
      const maxScore = 8;
      const details: string[] = [];

      try {
        const { ConflictResolver } =
          await import("../../core/conflict-resolution.ts");
        const resolver = new ConflictResolver();
        details.push("ConflictResolver created");
        score += 1;

        const outputs = [
          {
            agentId: "agent-a",
            tier: "worker" as const,
            output:
              "The application should use React for the frontend framework. We need TypeScript for type safety. The database should be PostgreSQL for relational data storage.",
            confidence: 0.8,
          },
          {
            agentId: "agent-b",
            tier: "manager" as const,
            output:
              "The application should use React for the frontend framework. TypeScript is essential for maintainability. However the database should be MongoDB for flexible document storage.",
            confidence: 0.9,
          },
          {
            agentId: "agent-c",
            tier: "worker" as const,
            output:
              "Vue.js would be a better choice for the frontend framework. The database should be PostgreSQL for relational data storage. We also need Redis for caching.",
            confidence: 0.7,
          },
        ];

        const report = resolver.analyze(outputs);
        details.push("Analysis complete");
        score += 2;

        if (report.agreements && Array.isArray(report.agreements)) {
          details.push(`Agreements found: ${report.agreements.length}`);
          score += 1;
        }

        if (report.contradictions && Array.isArray(report.contradictions)) {
          details.push(`Contradictions found: ${report.contradictions.length}`);
          score += 1;
        }

        if (
          report.uniqueContributions &&
          Array.isArray(report.uniqueContributions)
        ) {
          details.push(
            `Unique contributions: ${report.uniqueContributions.length}`,
          );
          score += 1;
        }

        // At least some analysis produced results
        const totalFindings =
          report.agreements.length +
          report.contradictions.length +
          report.uniqueContributions.length;
        if (totalFindings > 0) {
          details.push(`Total findings: ${totalFindings}`);
          score += 2;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.18.2: Resolution strategies ───────────────────────
  await harness.runTest(
    "2.18.2",
    "ConflictResolver — majority-vote, weighted-by-tier, merge strategies",
    async () => {
      let score = 0;
      const maxScore = 12;
      const details: string[] = [];

      try {
        const { ConflictResolver } =
          await import("../../core/conflict-resolution.ts");
        const resolver = new ConflictResolver();

        const outputs = [
          {
            agentId: "worker-1",
            tier: "worker" as const,
            output:
              "Use PostgreSQL for the database. It provides strong ACID guarantees and relational modeling.",
            confidence: 0.7,
          },
          {
            agentId: "worker-2",
            tier: "worker" as const,
            output:
              "Use PostgreSQL for the database. It has excellent support for complex queries and indexing.",
            confidence: 0.8,
          },
          {
            agentId: "manager-1",
            tier: "manager" as const,
            output:
              "Use MongoDB for the database. It provides flexible schema design and horizontal scaling.",
            confidence: 0.9,
          },
        ];

        // Test majority-vote
        const majorityResult = await resolver.resolve(outputs, "majority-vote");
        if (majorityResult.output && majorityResult.output.length > 0) {
          details.push("majority-vote produced output");
          score += 2;
        }
        if (majorityResult.strategy === "majority-vote") {
          details.push("Strategy correctly reported as majority-vote");
          score += 1;
        }
        if (majorityResult.participatingAgents.length === 3) {
          details.push("All 3 agents participated");
          score += 1;
        }

        // Test weighted-by-tier
        const tierResult = await resolver.resolve(outputs, "weighted-by-tier");
        if (tierResult.output && tierResult.output.length > 0) {
          details.push("weighted-by-tier produced output");
          score += 2;
        }
        // Manager tier (rank 2) should win over workers (rank 1)
        if (tierResult.output.includes("MongoDB")) {
          details.push(
            "weighted-by-tier selected manager's output (higher tier)",
          );
          score += 2;
        }

        // Test merge
        const mergeResult = await resolver.resolve(outputs, "merge");
        if (mergeResult.output && mergeResult.output.length > 0) {
          details.push("merge produced output");
          score += 2;
        }
        if (mergeResult.report) {
          details.push("merge includes conflict report");
          score += 2;
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
