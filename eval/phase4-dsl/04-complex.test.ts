// -----------------------------------------------------------------
// AETHER Eval -- Phase 4: Complex Pipeline Tests
// Full pipeline: Lexer -> Parser -> Transpiler on a complex
// multi-construct .syn string with agents, workflows, pipelines
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 4.4.1: Full pipeline on multi-construct source --------------
  await harness.runTest(
    "4.4.1",
    "Complex -- Full Lexer->Parser->Transpiler on multi-construct .syn",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");
        const { Transpiler } = await import("../../dsl/transpiler.ts");

        // A complex multi-construct Synapse source
        const src = `// AETHER Agent Definitions
// Full system definition for integration test

agent system-architect {
  name "System Architect"
  tier orchestrator
  sections [TOOLS, CONTEXT, REASONING]
  capabilities [architecture, planning, delegation]
  dependencies [react-specialist, code-reviewer]
  llm opus
  format markdown
  escalates-to system-architect

  prompt {
    You are the System Architect for AETHER.
    You coordinate all sub-agents and manage complex tasks.
    Use structured reasoning to break down problems.
  }

  tools [file_io, terminal, browser, code_analysis]

  when task_overflow {
    request react-specialist
    notify admin
  }

  when critical_error {
    notify admin
  }
}

agent react-specialist {
  name "React Specialist"
  tier worker
  sections [TOOLS]
  capabilities [react, typescript, css]
  llm sonnet
  format markdown
  escalates-to system-architect

  prompt {
    You are a React specialist.
    Focus on building high-quality components.
  }

  tools [file_io, terminal]
}

agent code-reviewer {
  name "Code Reviewer"
  tier worker
  sections [REASONING]
  capabilities [review, testing]
  llm haiku
  format xml
}

workflow full-deploy {
  trigger "deploy-production"

  step review {
    agent code-reviewer
    action "Review all pending changes"
  }

  step build {
    agent react-specialist
    action "Build production bundle"
    requires review
    on-fail escalate
  }

  step deploy {
    agent system-architect
    action "Execute deployment"
    requires build
    on-fail retry
  }
}

pipeline ci-checks {
  parallel {
    agent code-reviewer -> "Lint check"
    agent code-reviewer -> "Type check"
    agent react-specialist -> "Unit tests"
  }

  then {
    agent system-architect -> "Integration tests"
  }

  then {
    agent system-architect -> "Generate report"
  }
}`;

        // PHASE 1: Lexer
        const tokens = new Lexer(src).tokenize();
        if (Array.isArray(tokens) && tokens.length > 50) {
          details.push(`Lexer produced ${tokens.length} tokens`);
          score += 1;
        } else {
          details.push(
            `Lexer produced ${tokens?.length ?? 0} tokens (expected >50)`,
          );
        }

        // Verify no comment text leaked
        const commentLeak = tokens.some(
          (t) =>
            t.value.includes("AETHER Agent Definitions") ||
            t.value.includes("Full system"),
        );
        if (!commentLeak) {
          details.push("Comments stripped from token stream");
          score += 1;
        } else {
          details.push("Comment text leaked into tokens");
        }

        // PHASE 2: Parser
        const nodes = new Parser(tokens).parse();
        if (nodes.length === 5) {
          details.push(
            "Parser produced 5 top-level nodes (3 agents, 1 workflow, 1 pipeline)",
          );
          score += 1;
        } else {
          details.push(`Parser produced ${nodes.length} nodes (expected 5)`);
        }

        // Check node types
        const agents = nodes.filter((n) => n.type === "agent");
        const workflows = nodes.filter((n) => n.type === "workflow");
        const pipelines = nodes.filter((n) => n.type === "pipeline");
        if (
          agents.length === 3 &&
          workflows.length === 1 &&
          pipelines.length === 1
        ) {
          details.push(
            "Correct distribution: 3 agents, 1 workflow, 1 pipeline",
          );
          score += 1;
        } else {
          details.push(
            `Distribution: ${agents.length}a, ${workflows.length}w, ${pipelines.length}p`,
          );
        }

        // PHASE 3: Transpiler toJSON
        const jsonArr = Transpiler.toJSON(nodes);
        if (jsonArr.length === 5) {
          details.push("Transpiler.toJSON produced 5 JSON objects");
          score += 1;
        } else {
          details.push(`toJSON produced ${jsonArr.length} objects`);
        }

        // Verify agent JSON detail
        const architectJson = jsonArr[0] as Record<string, unknown>;
        if (
          architectJson.id === "system-architect" &&
          architectJson.llmRequirement === "opus" &&
          architectJson.format === "markdown" &&
          architectJson.tier === "orchestrator"
        ) {
          details.push("system-architect JSON fields correct");
          score += 1;
        } else {
          details.push(
            `Architect JSON: ${JSON.stringify(architectJson).slice(0, 100)}`,
          );
        }

        // Verify workflow JSON detail
        const wfJson = jsonArr[3] as Record<string, unknown>;
        const wfSteps = wfJson.steps as Array<Record<string, unknown>>;
        if (
          wfJson.type === "workflow" &&
          wfJson.id === "full-deploy" &&
          wfJson.trigger === "deploy-production" &&
          wfSteps?.length === 3 &&
          wfSteps[2].onFail === "retry"
        ) {
          details.push("Workflow JSON with 3 steps and on-fail=retry correct");
          score += 1;
        } else {
          details.push(
            `Workflow JSON: ${JSON.stringify(wfJson).slice(0, 120)}`,
          );
        }

        // Verify pipeline JSON detail
        const pipeJson = jsonArr[4] as Record<string, unknown>;
        const stages = pipeJson.stages as Array<Record<string, unknown>>;
        if (
          pipeJson.type === "pipeline" &&
          stages?.length === 3 &&
          stages[0].type === "parallel" &&
          stages[1].type === "then" &&
          stages[2].type === "then"
        ) {
          details.push(
            "Pipeline JSON with 3 stages (1 parallel, 2 then) correct",
          );
          score += 1;
        } else {
          details.push(
            `Pipeline JSON: ${JSON.stringify(pipeJson).slice(0, 120)}`,
          );
        }

        // PHASE 4: Transpiler toAgentFile on first agent
        if (agents.length > 0 && agents[0].type === "agent") {
          const md = Transpiler.toAgentFile(agents[0]);
          const hasFrontmatter =
            md.startsWith("---") && md.includes("id: system-architect");
          const hasTitle = md.includes("# System Architect");
          const hasPrompt = md.includes("coordinate all sub-agents");
          const hasHandlers = md.includes("### when task_overflow");
          if (hasFrontmatter && hasTitle && hasPrompt && hasHandlers) {
            details.push(
              "Agent markdown: frontmatter, title, prompt, handlers all present",
            );
            score += 1;
          } else {
            details.push(
              `MD checks: fm=${hasFrontmatter} title=${hasTitle} prompt=${hasPrompt} handlers=${hasHandlers}`,
            );
          }
        }

        // PHASE 5: Registration messages
        const regMsgs = Transpiler.toRegistrationMessages(nodes);
        if (regMsgs.length === 3) {
          details.push("3 registration messages (agents only)");
          score += 1;
        } else {
          details.push(`Registration messages: ${regMsgs.length} (expected 3)`);
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
