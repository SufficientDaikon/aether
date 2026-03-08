// -----------------------------------------------------------------
// AETHER Eval -- Phase 4: Parser Tests
// Tests Synapse DSL Parser: agent definitions, workflows, pipelines,
// handlers, step properties, list parsing
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 4.2.1: Parse agent definition with all properties -----------
  await harness.runTest(
    "4.2.1",
    "Parser -- Parse agent definition with properties, tools, prompt",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        const src = `agent react-specialist {
  name "React & Framework Specialist"
  tier worker
  sections [TOOLS, CONTEXT]
  capabilities [react, typescript, nextjs]
  dependencies [file-io, terminal]
  llm sonnet
  format markdown
  escalates-to system-architect

  prompt {
    You are a React specialist.
    Build high-quality components.
  }

  tools [file_io, terminal, browser]
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();

        if (Array.isArray(nodes) && nodes.length === 1) {
          details.push("Parsed 1 top-level node");
          score += 1;
        } else {
          details.push(`Expected 1 node, got ${nodes?.length ?? 0}`);
          return { score, maxScore, details: details.join("; ") };
        }

        const agent = nodes[0];
        if (agent.type === "agent") {
          details.push("Node type is 'agent'");
          score += 1;
        } else {
          details.push(`Node type: ${agent.type} (expected 'agent')`);
          return { score, maxScore, details: details.join("; ") };
        }

        if (agent.type === "agent") {
          // Check id
          if (agent.id === "react-specialist") {
            details.push("Agent id: react-specialist");
            score += 1;
          } else {
            details.push(`Agent id: ${agent.id}`);
          }

          // Check properties
          const props = agent.properties;
          if (
            props["name"] === "React & Framework Specialist" &&
            props["tier"] === "worker" &&
            props["llm"] === "sonnet" &&
            props["format"] === "markdown" &&
            props["escalates-to"] === "system-architect"
          ) {
            details.push("All scalar properties correct");
            score += 1;
          } else {
            details.push(`Properties mismatch: ${JSON.stringify(props)}`);
          }

          // Check array properties
          const sections = props["sections"];
          const capabilities = props["capabilities"];
          if (
            Array.isArray(sections) &&
            sections.length === 2 &&
            Array.isArray(capabilities) &&
            capabilities.length === 3
          ) {
            details.push("Array properties (sections, capabilities) correct");
            score += 1;
          } else {
            details.push("Array properties mismatch");
          }

          // Check prompt
          if (agent.prompt && agent.prompt.includes("React specialist")) {
            details.push("Prompt text parsed correctly");
            score += 1;
          } else {
            details.push(
              `Prompt: '${agent.prompt?.slice(0, 60) ?? "undefined"}'`,
            );
          }
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.2.2: Parse workflow with trigger and steps ----------------
  await harness.runTest(
    "4.2.2",
    "Parser -- Parse workflow with trigger, steps, requires, on-fail",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        const src = `workflow deploy-flow {
  trigger "deploy"

  step lint {
    agent code-reviewer
    action "Run linting checks"
  }

  step build {
    agent react-specialist
    action "Build production bundle"
    requires lint
    on-fail escalate
  }
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();

        if (nodes.length === 1 && nodes[0].type === "workflow") {
          details.push("Parsed 1 workflow node");
          score += 1;
        } else {
          details.push(
            `Node count/type mismatch: ${nodes.length}, ${nodes[0]?.type}`,
          );
          return { score, maxScore, details: details.join("; ") };
        }

        const wf = nodes[0] as import("../../dsl/parser.ts").WorkflowNode;

        // Check workflow id and trigger
        if (wf.id === "deploy-flow" && wf.trigger === "deploy") {
          details.push("Workflow id and trigger correct");
          score += 1;
        } else {
          details.push(`id=${wf.id}, trigger=${wf.trigger}`);
        }

        // Check steps count
        if (wf.steps.length === 2) {
          details.push("2 steps parsed");
          score += 1;
        } else {
          details.push(`Step count: ${wf.steps.length} (expected 2)`);
        }

        // Check first step
        const step1 = wf.steps[0];
        if (
          step1 &&
          step1.id === "lint" &&
          step1.agent === "code-reviewer" &&
          step1.action === "Run linting checks"
        ) {
          details.push("Step 'lint' parsed correctly");
          score += 1;
        } else {
          details.push(`Step1: ${JSON.stringify(step1)}`);
        }

        // Check second step with requires and on-fail
        const step2 = wf.steps[1];
        if (
          step2 &&
          step2.id === "build" &&
          step2.requires === "lint" &&
          step2.onFail === "escalate"
        ) {
          details.push("Step 'build' with requires/on-fail correct");
          score += 1;
        } else {
          details.push(
            `Step2: requires=${step2?.requires}, onFail=${step2?.onFail}`,
          );
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.2.3: Parse pipeline with parallel and then stages ---------
  await harness.runTest(
    "4.2.3",
    "Parser -- Parse pipeline with parallel and then stages",
    async () => {
      let score = 0;
      const maxScore = 5;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        const src = `pipeline ci-pipeline {
  parallel {
    agent linter -> "Run lint"
    agent tester -> "Run tests"
  }

  then {
    agent deployer -> "Deploy to staging"
  }
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();

        if (nodes.length === 1 && nodes[0].type === "pipeline") {
          details.push("Parsed 1 pipeline node");
          score += 1;
        } else {
          details.push(`Node count/type: ${nodes.length}, ${nodes[0]?.type}`);
          return { score, maxScore, details: details.join("; ") };
        }

        const pipe = nodes[0] as import("../../dsl/parser.ts").PipelineNode;

        if (pipe.id === "ci-pipeline") {
          details.push("Pipeline id correct");
          score += 1;
        } else {
          details.push(`Pipeline id: ${pipe.id}`);
        }

        // Check stages count
        if (pipe.stages.length === 2) {
          details.push("2 stages parsed");
          score += 1;
        } else {
          details.push(`Stage count: ${pipe.stages.length} (expected 2)`);
        }

        // Check parallel stage
        const parallel = pipe.stages[0];
        if (
          parallel &&
          parallel.type === "parallel" &&
          parallel.tasks.length === 2 &&
          parallel.tasks[0].agent === "linter" &&
          parallel.tasks[0].action === "Run lint" &&
          parallel.tasks[1].agent === "tester" &&
          parallel.tasks[1].action === "Run tests"
        ) {
          details.push("Parallel stage with 2 tasks correct");
          score += 1;
        } else {
          details.push(`Parallel stage: ${JSON.stringify(parallel)}`);
        }

        // Check then stage
        const thenStage = pipe.stages[1];
        if (
          thenStage &&
          thenStage.type === "then" &&
          thenStage.tasks.length === 1 &&
          thenStage.tasks[0].agent === "deployer" &&
          thenStage.tasks[0].action === "Deploy to staging"
        ) {
          details.push("Then stage with 1 task correct");
          score += 1;
        } else {
          details.push(`Then stage: ${JSON.stringify(thenStage)}`);
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.2.4: Parse agent with when-handlers -----------------------
  await harness.runTest(
    "4.2.4",
    "Parser -- Parse agent with when-handlers (request, notify actions)",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        const src = `agent coordinator {
  name "Coordinator"
  tier orchestrator

  when needs_help {
    request specialist
    notify admin
  }

  when context overflow {
    include context_manager
  }
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();

        const agent = nodes[0];
        if (agent && agent.type === "agent") {
          details.push("Parsed agent node");
          score += 1;
        } else {
          details.push("Failed to parse agent node");
          return { score, maxScore, details: details.join("; ") };
        }

        if (agent.type === "agent") {
          const handlers = agent.handlers;
          if (handlers.length === 2) {
            details.push("2 handlers parsed");
            score += 1;
          } else {
            details.push(`Handler count: ${handlers.length} (expected 2)`);
          }

          // First handler: when needs_help
          const h1 = handlers[0];
          if (
            h1 &&
            h1.condition === "needs_help" &&
            h1.actions.length === 2 &&
            h1.actions[0].type === "request" &&
            h1.actions[0].target === "specialist" &&
            h1.actions[1].type === "notify" &&
            h1.actions[1].target === "admin"
          ) {
            details.push(
              "Handler 'needs_help' with request+notify actions correct",
            );
            score += 1;
          } else {
            details.push(`Handler 1: ${JSON.stringify(h1)}`);
          }

          // Second handler: when context overflow
          const h2 = handlers[1];
          if (
            h2 &&
            h2.condition === "context overflow" &&
            h2.actions.length === 1 &&
            h2.actions[0].type === "include" &&
            h2.actions[0].target === "context_manager"
          ) {
            details.push(
              "Handler 'context overflow' with include action correct",
            );
            score += 1;
          } else {
            details.push(`Handler 2: ${JSON.stringify(h2)}`);
          }
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
