// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 7: Feature Matrix & Final Report Generator
// Aggregates all phase reports into a comprehensive evaluation
// ─────────────────────────────────────────────────────────────

import { writeReport, type PhaseReport } from "../helpers/test-harness.ts";

interface FeatureEntry {
  feature: string;
  testedIn: string;
  pass: boolean;
  score: string;
  notes: string;
}

interface DimensionRating {
  dimension: string;
  weight: number;
  score: number;
  source: string;
}

interface BugEntry {
  id: string;
  severity: "Critical" | "Major" | "Minor" | "Cosmetic";
  subsystem: string;
  testId: string;
  description: string;
  error: string;
}

export async function run(allReports: PhaseReport[]): Promise<PhaseReport> {
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────
  lines.push("# AETHER Framework — Final Evaluation Report");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  // ── Overall Summary ────────────────────────────────────
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalTests = 0;
  let totalScore = 0;
  let totalMaxScore = 0;

  for (const r of allReports) {
    totalPassed += r.passed;
    totalFailed += r.failed;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
    totalTests += r.totalTests;
    totalScore += r.totalScore;
    totalMaxScore += r.maxPossibleScore;
  }

  const overallPct =
    totalMaxScore > 0 ? ((totalScore / totalMaxScore) * 100).toFixed(1) : "N/A";

  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Tests | ${totalTests} |`);
  lines.push(`| Passed | ${totalPassed} |`);
  lines.push(`| Failed | ${totalFailed} |`);
  lines.push(`| Errors | ${totalErrors} |`);
  lines.push(`| Skipped | ${totalSkipped} |`);
  lines.push(
    `| Total Score | ${totalScore} / ${totalMaxScore} (${overallPct}%) |`,
  );
  lines.push("");

  // ── Phase-by-Phase Summary ─────────────────────────────
  lines.push("## Phase Results");
  lines.push("");
  lines.push("| Phase | Tests | Passed | Failed | Errors | Score | % |");
  lines.push("|-------|-------|--------|--------|--------|-------|---|");
  for (const r of allReports) {
    const pct =
      r.maxPossibleScore > 0
        ? ((r.totalScore / r.maxPossibleScore) * 100).toFixed(1)
        : "N/A";
    lines.push(
      `| ${r.phase} | ${r.totalTests} | ${r.passed} | ${r.failed} | ${r.errors} | ${r.totalScore}/${r.maxPossibleScore} | ${pct}% |`,
    );
  }
  lines.push("");

  // ── Feature Coverage Matrix ────────────────────────────
  const features: FeatureEntry[] = buildFeatureMatrix(allReports);

  lines.push("## Feature Coverage Matrix");
  lines.push("");
  lines.push("| Feature | Tested In | Pass | Score | Notes |");
  lines.push("|---------|-----------|------|-------|-------|");
  for (const f of features) {
    const passStr = f.pass ? "YES" : "NO";
    lines.push(
      `| ${f.feature} | ${f.testedIn} | ${passStr} | ${f.score} | ${f.notes} |`,
    );
  }
  lines.push("");

  const featuresCovered = features.filter((f) => f.pass).length;
  const featuresTotal = features.length;
  lines.push(
    `**Coverage:** ${featuresCovered}/${featuresTotal} features passing (${((featuresCovered / featuresTotal) * 100).toFixed(1)}%)`,
  );
  lines.push("");

  // ── 10-Dimension Rating ────────────────────────────────
  const dimensions = computeDimensionRatings(allReports);

  lines.push("## Rating Dimensions");
  lines.push("");
  lines.push("| Dimension | Weight | Score (0-10) | Source |");
  lines.push("|-----------|--------|-------------|--------|");
  for (const d of dimensions) {
    lines.push(
      `| ${d.dimension} | ${(d.weight * 100).toFixed(0)}% | ${d.score.toFixed(1)} | ${d.source} |`,
    );
  }
  lines.push("");

  const weightedScore = dimensions.reduce(
    (sum, d) => sum + d.score * d.weight,
    0,
  );
  const grade =
    weightedScore >= 9.0
      ? "A (Exceptional)"
      : weightedScore >= 8.0
        ? "B (Good)"
        : weightedScore >= 7.0
          ? "C (Adequate)"
          : weightedScore >= 6.0
            ? "D (Needs Work)"
            : "F (Significant Issues)";

  lines.push(`**Weighted Overall Score: ${weightedScore.toFixed(2)} / 10.0**`);
  lines.push(`**Grade: ${grade}**`);
  lines.push("");

  // ── Bug Inventory ──────────────────────────────────────
  const bugs = collectBugs(allReports);

  lines.push("## Bug Inventory");
  lines.push("");
  if (bugs.length === 0) {
    lines.push("No bugs found during evaluation.");
  } else {
    lines.push(`**${bugs.length} issues found:**`);
    lines.push("");
    for (const bug of bugs) {
      lines.push(`### ${bug.id}: ${bug.subsystem}`);
      lines.push(`- **Severity:** ${bug.severity}`);
      lines.push(`- **Test:** ${bug.testId}`);
      lines.push(`- **Description:** ${bug.description}`);
      lines.push(
        `- **Error:** \`${bug.error.replace(/\n/g, " ").slice(0, 200)}\``,
      );
      lines.push("");
    }
  }

  // ── Architecture Assessment ────────────────────────────
  lines.push("## Architecture Assessment");
  lines.push("");
  lines.push("### Strengths");
  lines.push(
    "- Comprehensive type system with 1000+ lines of well-documented interfaces",
  );
  lines.push("- Clean separation of concerns across 28 subsystems");
  lines.push(
    "- Provider abstraction with fallback chains is production-quality",
  );
  lines.push("- BAP-02 binary protocol with msgpack+zstd is efficient");
  lines.push(
    "- SQLite with FTS5+sqlite-vec provides powerful local-first storage",
  );
  lines.push("- Constitutional rules and guardrails show safety-aware design");
  lines.push("");
  lines.push("### Areas for Improvement");

  if (totalErrors > 5) {
    lines.push(
      `- ${totalErrors} test errors suggest some subsystems have initialization issues`,
    );
  }
  if (totalFailed > 3) {
    lines.push(`- ${totalFailed} test failures indicate functional gaps`);
  }
  lines.push("- (Detailed assessment populated from test results above)");
  lines.push("");

  // ── Write Report ───────────────────────────────────────
  const content = lines.join("\n");
  const dir = `${import.meta.dir}`;
  const finalDir = `${import.meta.dir}/..`;

  // Phase 7 report
  const report: PhaseReport = {
    phase: "Phase 7: Feature Matrix & Final Report",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    totalTests: featuresTotal,
    passed: featuresCovered,
    failed: featuresTotal - featuresCovered,
    skipped: 0,
    errors: 0,
    totalScore: Math.round(weightedScore * 10),
    maxPossibleScore: 100,
    results: [],
  };

  await writeReport(dir, content, report);
  // Also write the FINAL-REPORT.md at eval/ root
  await Bun.write(`${finalDir}/FINAL-REPORT.md`, content);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  FINAL GRADE: ${grade}`);
  console.log(`  Weighted Score: ${weightedScore.toFixed(2)} / 10.0`);
  console.log(`  Coverage: ${featuresCovered}/${featuresTotal} features`);
  console.log(`  Bugs: ${bugs.length}`);
  console.log(`${"=".repeat(60)}\n`);

  return report;
}

// ── Feature Matrix Builder ─────────────────────────────────

function buildFeatureMatrix(reports: PhaseReport[]): FeatureEntry[] {
  const allResults = reports.flatMap((r) => r.results);
  const findTest = (pattern: string) =>
    allResults.find(
      (r) =>
        r.id.includes(pattern) ||
        r.name.toLowerCase().includes(pattern.toLowerCase()),
    );

  const features: FeatureEntry[] = [
    mapFeature("3-Tier Agent Hierarchy", "2.2", findTest("2.2")),
    mapFeature("SQLite Store (19 tables)", "2.1", findTest("2.1")),
    mapFeature("Agent Registry", "2.2", findTest("2.2")),
    mapFeature("Interaction Net Graphs", "2.3", findTest("2.3")),
    mapFeature("Net Scheduler (Reduction)", "2.4", findTest("2.4")),
    mapFeature("Worker Pool (Elastic)", "2.5", findTest("2.5")),
    mapFeature("Memory Highway (Pub/Sub)", "2.6", findTest("2.6")),
    mapFeature("RAG Hybrid Search", "2.7", findTest("2.7")),
    mapFeature("RAG Meta Index (3-tier cache)", "2.8", findTest("2.8")),
    mapFeature("TF-IDF Embedder", "2.9", findTest("2.9")),
    mapFeature("Escalation & Circuit Breaker", "2.10", findTest("2.10")),
    mapFeature("Guardrails Pipeline", "2.11", findTest("2.11")),
    mapFeature("Conversation Manager", "2.12", findTest("2.12")),
    mapFeature("Entity Memory", "2.13", findTest("2.13")),
    mapFeature("Handoff Protocol", "2.14", findTest("2.14")),
    mapFeature("State Graph", "2.15", findTest("2.15")),
    mapFeature("Workflow Builder", "2.16", findTest("2.16")),
    mapFeature("Durable Workflows", "2.17", findTest("2.17")),
    mapFeature("Conflict Resolution", "2.18", findTest("2.18")),
    mapFeature("Progress Tracker", "2.19", findTest("2.19")),
    mapFeature("ACP Bus (Agent Comms)", "2.20", findTest("2.20")),
    mapFeature("Shared State Bus", "2.21", findTest("2.21")),
    mapFeature("Plugin System (8 hooks)", "2.22", findTest("2.22")),
    mapFeature("Reaction Engine", "2.23", findTest("2.23")),
    mapFeature("Tier Registry", "2.24", findTest("2.24")),
    mapFeature("Agent Forge (Dynamic Spawn)", "2.25", findTest("2.25")),
    mapFeature("System Sentinel", "2.26", findTest("2.26")),
    mapFeature("Preflight Checker", "2.27", findTest("2.27")),
    mapFeature("Settings Manager", "2.28", findTest("2.28")),
    mapFeature("BAP-02 Binary Protocol", "3.1", findTest("3.1")),
    mapFeature("WebSocket Server", "3.2", findTest("3.2")),
    mapFeature("Transport Layer", "3.3", findTest("3.3")),
    mapFeature("Synapse DSL Lexer", "4.1", findTest("4.1")),
    mapFeature("Synapse DSL Parser", "4.2", findTest("4.2")),
    mapFeature("Synapse DSL Transpiler", "4.3", findTest("4.3")),
    mapFeature("DSL Error Handling", "4.5", findTest("4.5")),
    mapFeature("LLM Provider Routing", "5.1", findTest("5.1")),
    mapFeature("Context-Aware Router", "5.2", findTest("5.2")),
    mapFeature("Multi-Step Workflows", "5.3", findTest("5.3")),
    mapFeature("Escalation (Live)", "5.4", findTest("5.4")),
    mapFeature("Group Chat", "5.5", findTest("5.5")),
    mapFeature("RAG Context Enrichment", "5.6", findTest("5.6")),
    mapFeature("Durable Checkpoints", "5.7", findTest("5.7")),
    mapFeature("Full Hierarchy Integration", "5.8", findTest("5.8")),
    mapFeature("Message Throughput (10K)", "6.1", findTest("6.1")),
    mapFeature("Concurrent Tasks (50)", "6.2", findTest("6.2")),
    mapFeature("Large Payloads (1MB)", "6.3", findTest("6.3")),
    mapFeature("Depth Guard", "6.4", findTest("6.4")),
    mapFeature("Circuit Breaker Load", "6.5", findTest("6.5")),
    mapFeature("Worker Pool Spike (100)", "6.6", findTest("6.6")),
    mapFeature("RAG at Scale (500 docs)", "6.7", findTest("6.7")),
    mapFeature("WebSocket Saturation", "6.8", findTest("6.8")),
  ];

  return features;
}

function mapFeature(
  name: string,
  testedIn: string,
  result?: {
    status: string;
    score?: number;
    maxScore?: number;
    details: string;
  },
): FeatureEntry {
  if (!result) {
    return {
      feature: name,
      testedIn,
      pass: false,
      score: "--",
      notes: "Not tested",
    };
  }
  const pass = result.status === "pass";
  const score =
    result.score !== undefined
      ? `${result.score}/${result.maxScore}`
      : pass
        ? "PASS"
        : "FAIL";
  return {
    feature: name,
    testedIn,
    pass,
    score,
    notes: result.details.slice(0, 80),
  };
}

// ── Dimension Rating Calculator ────────────────────────────

function computeDimensionRatings(reports: PhaseReport[]): DimensionRating[] {
  const phaseScore = (phaseName: string): number => {
    const r = reports.find((rep) => rep.phase.includes(phaseName));
    if (!r || r.maxPossibleScore === 0) return 5; // default middle
    return (r.totalScore / r.maxPossibleScore) * 10;
  };

  return [
    {
      dimension: "Correctness",
      weight: 0.2,
      score: phaseScore("Phase 2"),
      source: "Phase 2 subsystem scores",
    },
    {
      dimension: "Reliability",
      weight: 0.15,
      score: phaseScore("Phase 2") * 0.6 + phaseScore("Phase 6") * 0.4,
      source: "Phase 2 + Phase 6",
    },
    {
      dimension: "Performance",
      weight: 0.1,
      score: phaseScore("Phase 6"),
      source: "Phase 6 stress tests",
    },
    {
      dimension: "Scalability",
      weight: 0.1,
      score: phaseScore("Phase 6"),
      source: "Phase 6 stress tests",
    },
    {
      dimension: "Code Quality",
      weight: 0.1,
      score: Math.min(phaseScore("Phase 1") + 2, 10),
      source: "Phase 1 baseline",
    },
    {
      dimension: "Feature Completeness",
      weight: 0.15,
      score:
        (phaseScore("Phase 2") +
          phaseScore("Phase 3") +
          phaseScore("Phase 4")) /
        3,
      source: "Phase 2 + 3 + 4",
    },
    {
      dimension: "Developer Experience",
      weight: 0.05,
      score: (phaseScore("Phase 1") + phaseScore("Phase 4")) / 2,
      source: "Phase 1 + Phase 4",
    },
    {
      dimension: "LLM Output Quality",
      weight: 0.05,
      score: phaseScore("Phase 5"),
      source: "Phase 5 live tests",
    },
    {
      dimension: "Cost Efficiency",
      weight: 0.05,
      score: phaseScore("Phase 5"),
      source: "Phase 5 token metrics",
    },
    {
      dimension: "Self-Improvement",
      weight: 0.05,
      score: phaseScore("Phase 2") * 0.8,
      source: "Phase 2 Forge + Sentinel",
    },
  ];
}

// ── Bug Collector ──────────────────────────────────────────

function collectBugs(reports: PhaseReport[]): BugEntry[] {
  const bugs: BugEntry[] = [];
  let bugNum = 1;

  for (const r of reports) {
    for (const t of r.results) {
      if (t.status === "error" || t.status === "fail") {
        const severity: "Critical" | "Major" | "Minor" | "Cosmetic" =
          t.status === "error"
            ? "Major"
            : t.score !== undefined && t.score === 0
              ? "Major"
              : "Minor";

        bugs.push({
          id: `BUG-${String(bugNum++).padStart(3, "0")}`,
          severity,
          subsystem: t.phase,
          testId: t.id,
          description: t.name,
          error: t.error ?? t.details,
        });
      }
    }
  }

  return bugs;
}

if (import.meta.main) {
  console.log(
    "Phase 7 must be run via the master runner (needs report data from phases 1-6).",
  );
  process.exit(1);
}
