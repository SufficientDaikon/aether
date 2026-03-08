// -----------------------------------------------------------------
// AETHER Eval -- Phase 4: Transpiler Tests
// Tests Synapse DSL Transpiler: AST to JSON, AST to Markdown,
// workflow/pipeline JSON, BAP-01 registration messages
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 4.3.1: Agent AST to JSON ------------------------------------
  await harness.runTest(
    "4.3.1",
    "Transpiler -- Agent AST to JSON (toJSON)",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");
        const { Transpiler } = await import("../../dsl/transpiler.ts");

        const src = `agent test-worker {
  name "Integration Test Worker"
  tier worker
  sections [TOOLS]
  capabilities [testing, validation]
  dependencies [file-io]
  llm haiku
  format markdown
  escalates-to system-architect

  prompt {
    You are a test worker for integration testing.
    Verify all systems operational.
  }

  tools [file_io, terminal]
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();
        const jsonArr = Transpiler.toJSON(nodes);

        if (Array.isArray(jsonArr) && jsonArr.length === 1) {
          details.push("toJSON returned 1 object");
          score += 1;
        } else {
          details.push(`toJSON returned ${jsonArr?.length ?? 0} objects`);
          return { score, maxScore, details: details.join("; ") };
        }

        const obj = jsonArr[0] as Record<string, unknown>;

        // Check id and name
        if (
          obj.id === "test-worker" &&
          obj.name === "Integration Test Worker"
        ) {
          details.push("id and name correct");
          score += 1;
        } else {
          details.push(`id=${obj.id}, name=${obj.name}`);
        }

        // Check tier and llm mapping
        if (obj.tier === "worker" && obj.llmRequirement === "haiku") {
          details.push("tier and llmRequirement correct");
          score += 1;
        } else {
          details.push(`tier=${obj.tier}, llm=${obj.llmRequirement}`);
        }

        // Check sections are uppercased
        const sections = obj.sections as string[];
        if (Array.isArray(sections) && sections[0] === "TOOLS") {
          details.push("Sections uppercased correctly");
          score += 1;
        } else {
          details.push(`Sections: ${JSON.stringify(sections)}`);
        }

        // Check escalation target
        if (obj.escalationTarget === "system-architect") {
          details.push("escalationTarget correct");
          score += 1;
        } else {
          details.push(`escalationTarget: ${obj.escalationTarget}`);
        }

        // Check metadata.tools and metadata.prompt
        const meta = obj.metadata as Record<string, unknown>;
        const tools = meta?.tools as string[];
        const prompt = meta?.prompt as string;
        if (
          Array.isArray(tools) &&
          tools.includes("file_io") &&
          tools.includes("terminal") &&
          typeof prompt === "string" &&
          prompt.includes("test worker")
        ) {
          details.push("metadata.tools and metadata.prompt correct");
          score += 1;
        } else {
          details.push(
            `metadata: tools=${JSON.stringify(tools)}, prompt=${prompt?.slice(0, 40)}`,
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

  // -- Test 4.3.2: Agent AST to Markdown --------------------------------
  await harness.runTest(
    "4.3.2",
    "Transpiler -- Agent AST to Markdown (toAgentFile)",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");
        const { Transpiler } = await import("../../dsl/transpiler.ts");

        const src = `agent react-specialist {
  name "React Specialist"
  tier worker
  sections [TOOLS, CONTEXT]
  capabilities [react, typescript]
  llm sonnet
  format markdown
  escalates-to system-architect

  prompt {
    You are a React specialist.
    Build high-quality components.
  }

  tools [file_io, terminal]

  when needs_help {
    request system-architect
  }
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();
        const agentNode = nodes[0];

        if (agentNode.type !== "agent") {
          details.push("Not an agent node, cannot test toAgentFile");
          return { score, maxScore, details: details.join("; ") };
        }

        const md = Transpiler.toAgentFile(agentNode);

        // Should contain YAML frontmatter
        if (md.startsWith("---") && md.includes("id: react-specialist")) {
          details.push("YAML frontmatter present with correct id");
          score += 1;
        } else {
          details.push("YAML frontmatter missing or incorrect");
        }

        // Should have name in frontmatter
        if (md.includes('name: "React Specialist"')) {
          details.push("Name in frontmatter correct");
          score += 1;
        } else {
          details.push("Name in frontmatter missing");
        }

        // Should have markdown title
        if (md.includes("# React Specialist")) {
          details.push("Markdown title correct");
          score += 1;
        } else {
          details.push("Markdown title missing");
        }

        // Should contain prompt text
        if (
          md.includes("React specialist") &&
          md.includes("high-quality components")
        ) {
          details.push("Prompt text present in markdown");
          score += 1;
        } else {
          details.push("Prompt text missing from markdown");
        }

        // Should have tools section
        if (
          md.includes("## Tools") &&
          md.includes("- file_io") &&
          md.includes("- terminal")
        ) {
          details.push("Tools section correct");
          score += 1;
        } else {
          details.push("Tools section missing or incomplete");
        }

        // Should have event handlers section
        if (
          md.includes("## Event Handlers") &&
          md.includes("### when needs_help") &&
          md.includes("- request system-architect")
        ) {
          details.push("Event Handlers section correct");
          score += 1;
        } else {
          details.push("Event Handlers section missing or incomplete");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.3.3: Workflow and Pipeline to JSON ------------------------
  await harness.runTest(
    "4.3.3",
    "Transpiler -- Workflow and Pipeline AST to JSON",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");
        const { Transpiler } = await import("../../dsl/transpiler.ts");

        const src = `workflow deploy-flow {
  trigger "deploy"

  step lint {
    agent linter
    action "Run linting"
    on-fail skip
  }
}

pipeline ci-pipe {
  parallel {
    agent tester -> "Run tests"
    agent linter -> "Lint code"
  }

  then {
    agent deployer -> "Deploy"
  }
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();
        const jsonArr = Transpiler.toJSON(nodes);

        if (jsonArr.length === 2) {
          details.push("2 JSON objects produced");
          score += 1;
        } else {
          details.push(`Expected 2 JSON objects, got ${jsonArr.length}`);
        }

        // Workflow JSON
        const wfJson = jsonArr[0] as Record<string, unknown>;
        if (
          wfJson.type === "workflow" &&
          wfJson.id === "deploy-flow" &&
          wfJson.trigger === "deploy"
        ) {
          details.push("Workflow JSON id, type, trigger correct");
          score += 1;
        } else {
          details.push(
            `Workflow JSON: ${JSON.stringify(wfJson).slice(0, 100)}`,
          );
        }

        // Workflow steps
        const steps = wfJson.steps as Array<Record<string, unknown>>;
        if (
          steps &&
          steps.length === 1 &&
          steps[0].id === "lint" &&
          steps[0].agent === "linter" &&
          steps[0].onFail === "skip"
        ) {
          details.push("Workflow step JSON correct with onFail");
          score += 1;
        } else {
          details.push(`Workflow steps: ${JSON.stringify(steps)}`);
        }

        // Pipeline JSON
        const pipeJson = jsonArr[1] as Record<string, unknown>;
        const stages = pipeJson.stages as Array<Record<string, unknown>>;
        if (
          pipeJson.type === "pipeline" &&
          pipeJson.id === "ci-pipe" &&
          stages &&
          stages.length === 2 &&
          stages[0].type === "parallel" &&
          stages[1].type === "then"
        ) {
          details.push("Pipeline JSON with parallel+then stages correct");
          score += 1;
        } else {
          details.push(
            `Pipeline JSON: ${JSON.stringify(pipeJson).slice(0, 120)}`,
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

  // -- Test 4.3.4: BAP-01 registration messages -------------------------
  await harness.runTest(
    "4.3.4",
    "Transpiler -- toRegistrationMessages produces BAP-01 register payloads",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");
        const { Transpiler } = await import("../../dsl/transpiler.ts");

        const src = `agent alpha {
  name "Agent Alpha"
  tier worker
  llm haiku
}

agent beta {
  name "Agent Beta"
  tier orchestrator
  llm opus
}

workflow some-flow {
  trigger "test"
  step s1 {
    agent alpha
    action "Do something"
  }
}`;
        const tokens = new Lexer(src).tokenize();
        const nodes = new Parser(tokens).parse();
        const msgs = Transpiler.toRegistrationMessages(nodes);

        // Should produce 2 registration messages (only agents, not workflows)
        if (msgs.length === 2) {
          details.push(
            "2 registration messages (agents only, workflow skipped)",
          );
          score += 1;
        } else {
          details.push(`Expected 2 messages, got ${msgs.length}`);
        }

        const msg1 = msgs[0] as Record<string, unknown>;
        const msg2 = msgs[1] as Record<string, unknown>;

        // Check message structure
        if (
          msg1.from === "alpha" &&
          msg1.to === "registry" &&
          msg1.type === "register" &&
          typeof msg1.id === "string" &&
          typeof msg1.timestamp === "number"
        ) {
          details.push(
            "Message 1 structure correct (from, to, type, id, timestamp)",
          );
          score += 1;
        } else {
          details.push(`Message 1: ${JSON.stringify(msg1).slice(0, 100)}`);
        }

        // Check payload contains agent data
        const payload1 = msg1.payload as Record<string, unknown>;
        if (
          payload1 &&
          payload1.id === "alpha" &&
          payload1.name === "Agent Alpha"
        ) {
          details.push("Message 1 payload contains agent JSON");
          score += 1;
        } else {
          details.push(`Payload1: ${JSON.stringify(payload1).slice(0, 80)}`);
        }

        // Check second message
        if (
          msg2 &&
          (msg2 as Record<string, unknown>).from === "beta" &&
          typeof msg2.priority === "number"
        ) {
          details.push("Message 2 from=beta with priority field");
          score += 1;
        } else {
          details.push(`Message 2: ${JSON.stringify(msg2).slice(0, 80)}`);
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
