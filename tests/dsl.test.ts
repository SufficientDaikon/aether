import { describe, it, expect } from "bun:test";
import { Lexer } from "../dsl/lexer.ts";
import { Parser } from "../dsl/parser.ts";
import { Transpiler } from "../dsl/transpiler.ts";
import type { AgentNode, WorkflowNode, PipelineNode } from "../dsl/parser.ts";

// ─────────────────────────────────────────────────────────────
// Lexer Tests
// ─────────────────────────────────────────────────────────────

describe("Lexer", () => {
  it("should tokenize an agent definition", () => {
    const source = `agent test-agent {
      name "Test Agent"
      tier worker
      sections [FRONTEND]
    }`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("KEYWORD");
    expect(tokens[0].value).toBe("agent");
    expect(tokens[1].type).toBe("IDENTIFIER");
    expect(tokens[1].value).toBe("test-agent");
    expect(tokens[2].type).toBe("BLOCK_START");
    expect(tokens[2].value).toBe("{");
  });

  it("should handle comments", () => {
    const source = `// This is a comment
agent foo {
  // another comment
  tier worker
}`;
    const tokens = new Lexer(source).tokenize();
    // Comments should be skipped — no comment tokens
    const values = tokens.map((t) => t.value);
    expect(values).not.toContain("// This is a comment");
    expect(values).toContain("agent");
    expect(values).toContain("foo");
  });

  it("should tokenize lists", () => {
    const source = `[FRONTEND, BACKEND, AUDIT]`;
    const tokens = new Lexer(source).tokenize();
    expect(tokens[0].type).toBe("LIST_START");
    // Section names are uppercase identifiers, not keywords
    expect(tokens[1].type).toBe("IDENTIFIER");
    expect(tokens[1].value).toBe("FRONTEND");
    expect(tokens[2].type).toBe("COMMA");
    expect(tokens[3].type).toBe("IDENTIFIER");
    expect(tokens[3].value).toBe("BACKEND");
    expect(tokens[4].type).toBe("COMMA");
    expect(tokens[5].type).toBe("IDENTIFIER");
    expect(tokens[5].value).toBe("AUDIT");
    expect(tokens[6].type).toBe("LIST_END");
  });

  it("should tokenize strings", () => {
    const source = `name "Hello World"`;
    const tokens = new Lexer(source).tokenize();
    expect(tokens[0].type).toBe("KEYWORD");
    expect(tokens[0].value).toBe("name");
    expect(tokens[1].type).toBe("STRING");
    expect(tokens[1].value).toBe("Hello World");
  });

  it("should tokenize prompt blocks", () => {
    const source = `prompt {
  You are a helpful agent.
  Do good work.
}`;
    const tokens = new Lexer(source).tokenize();
    const promptKw = tokens.find((t) => t.value === "prompt");
    expect(promptKw).toBeDefined();
    const multiline = tokens.find((t) => t.type === "MULTILINE_STRING");
    expect(multiline).toBeDefined();
    expect(multiline!.value).toContain("You are a helpful agent.");
    expect(multiline!.value).toContain("Do good work.");
  });

  it("should tokenize arrows", () => {
    const source = `agent foo -> "do stuff"`;
    const tokens = new Lexer(source).tokenize();
    const arrow = tokens.find((t) => t.type === "ARROW");
    expect(arrow).toBeDefined();
    expect(arrow!.value).toBe("->");
  });

  it("should track line numbers", () => {
    const source = `agent foo {
  tier worker
  name "Foo"
}`;
    const tokens = new Lexer(source).tokenize();
    expect(tokens[0].line).toBe(1); // "agent"
    // "tier" is on line 2
    const tierToken = tokens.find((t) => t.value === "tier");
    expect(tierToken).toBeDefined();
    expect(tierToken!.line).toBe(2);
  });

  it("should throw on unterminated strings", () => {
    const source = `name "unterminated`;
    expect(() => new Lexer(source).tokenize()).toThrow(/unterminated/i);
  });
});

// ─────────────────────────────────────────────────────────────
// Parser Tests
// ─────────────────────────────────────────────────────────────

describe("Parser", () => {
  function parse(source: string) {
    const tokens = new Lexer(source).tokenize();
    return new Parser(tokens).parse();
  }

  it("should parse a minimal agent", () => {
    const nodes = parse(`agent test { tier worker }`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("agent");
    const agent = nodes[0] as AgentNode;
    expect(agent.id).toBe("test");
    expect(agent.properties["tier"]).toBe("worker");
  });

  it("should parse agent with all properties", () => {
    const nodes = parse(`
      agent react-dev {
        name "React Developer"
        tier worker
        sections [FRONTEND]
        capabilities [react, hooks, state-management]
        dependencies [api-client]
        llm haiku
        format markdown
        escalates-to system-architect
      }
    `);
    expect(nodes).toHaveLength(1);
    const agent = nodes[0] as AgentNode;
    expect(agent.id).toBe("react-dev");
    expect(agent.properties["name"]).toBe("React Developer");
    expect(agent.properties["tier"]).toBe("worker");
    expect(agent.properties["sections"]).toEqual(["FRONTEND"]);
    expect(agent.properties["capabilities"]).toEqual([
      "react",
      "hooks",
      "state-management",
    ]);
    expect(agent.properties["llm"]).toBe("haiku");
    expect(agent.properties["format"]).toBe("markdown");
    expect(agent.properties["escalates-to"]).toBe("system-architect");
  });

  it("should parse workflow with steps", () => {
    const nodes = parse(`
      workflow feature-dev {
        trigger "new feature request"
        step plan {
          agent system-architect
          action "create plan"
        }
        step implement {
          agent react-dev
          action "implement feature"
          requires plan
          on-fail escalate
        }
      }
    `);
    expect(nodes).toHaveLength(1);
    const wf = nodes[0] as WorkflowNode;
    expect(wf.type).toBe("workflow");
    expect(wf.id).toBe("feature-dev");
    expect(wf.trigger).toBe("new feature request");
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0].id).toBe("plan");
    expect(wf.steps[0].agent).toBe("system-architect");
    expect(wf.steps[0].action).toBe("create plan");
    expect(wf.steps[1].requires).toBe("plan");
    expect(wf.steps[1].onFail).toBe("escalate");
  });

  it("should parse pipeline with parallel and then", () => {
    const nodes = parse(`
      pipeline ci {
        parallel {
          agent linter -> "lint code"
          agent tester -> "run tests"
        }
        then {
          agent deployer -> "deploy to staging"
        }
      }
    `);
    expect(nodes).toHaveLength(1);
    const pipeline = nodes[0] as PipelineNode;
    expect(pipeline.type).toBe("pipeline");
    expect(pipeline.id).toBe("ci");
    expect(pipeline.stages).toHaveLength(2);
    expect(pipeline.stages[0].type).toBe("parallel");
    expect(pipeline.stages[0].tasks).toHaveLength(2);
    expect(pipeline.stages[0].tasks[0].agent).toBe("linter");
    expect(pipeline.stages[0].tasks[0].action).toBe("lint code");
    expect(pipeline.stages[1].type).toBe("then");
    expect(pipeline.stages[1].tasks).toHaveLength(1);
    expect(pipeline.stages[1].tasks[0].agent).toBe("deployer");
  });

  it("should parse when handlers", () => {
    const nodes = parse(`
      agent handler-test {
        tier worker
        when needs_help {
          request manager
          notify logger
        }
      }
    `);
    const agent = nodes[0] as AgentNode;
    expect(agent.handlers).toHaveLength(1);
    expect(agent.handlers[0].condition).toBe("needs_help");
    expect(agent.handlers[0].actions).toHaveLength(2);
    expect(agent.handlers[0].actions[0].type).toBe("request");
    expect(agent.handlers[0].actions[0].target).toBe("manager");
    expect(agent.handlers[0].actions[1].type).toBe("notify");
    expect(agent.handlers[0].actions[1].target).toBe("logger");
  });

  it("should parse prompt blocks", () => {
    const nodes = parse(`
      agent prompted {
        tier worker
        prompt {
          You are an expert agent.
          Follow the instructions carefully.
        }
      }
    `);
    const agent = nodes[0] as AgentNode;
    expect(agent.prompt).toBeDefined();
    expect(agent.prompt).toContain("You are an expert agent.");
    expect(agent.prompt).toContain("Follow the instructions carefully.");
  });

  it("should handle multiple top-level definitions", () => {
    const nodes = parse(`
      agent alpha { tier worker }
      agent beta { tier manager }
      workflow deploy {
        step do-it {
          agent alpha
          action "build"
        }
      }
    `);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("agent");
    expect(nodes[1].type).toBe("agent");
    expect(nodes[2].type).toBe("workflow");
  });
});

// ─────────────────────────────────────────────────────────────
// Transpiler Tests
// ─────────────────────────────────────────────────────────────

describe("Transpiler", () => {
  function compile(source: string) {
    const tokens = new Lexer(source).tokenize();
    const nodes = new Parser(tokens).parse();
    return Transpiler.toJSON(nodes);
  }

  function compileNodes(source: string) {
    const tokens = new Lexer(source).tokenize();
    return new Parser(tokens).parse();
  }

  it("should transpile agent to JSON matching AgentDefinition", () => {
    const result = compile(`
      agent react-dev {
        name "React Developer"
        tier worker
        sections [FRONTEND]
        capabilities [react, hooks]
        llm haiku
        format markdown
        escalates-to system-architect
      }
    `);
    expect(result).toHaveLength(1);
    const agent = result[0] as Record<string, unknown>;
    expect(agent).toMatchObject({
      id: "react-dev",
      name: "React Developer",
      tier: "worker",
    });
    expect(agent.sections).toEqual(["FRONTEND"]);
    expect(agent.capabilities).toEqual(["react", "hooks"]);
    expect(agent.llmRequirement).toBe("haiku");
    expect(agent.format).toBe("markdown");
    expect(agent.escalationTarget).toBe("system-architect");
    expect(agent.filePath).toBe("agents/react-dev.agent.md");
    expect(agent.status).toBe("idle");
  });

  it("should generate valid .agent.md file content", () => {
    const nodes = compileNodes(`
      agent md-test {
        name "Markdown Test"
        tier worker
        sections [BACKEND]
        capabilities [api, rest]
        llm sonnet
        format markdown
        escalates-to lead
        tools [terminal, file-io]
        prompt {
          You are a backend expert.
          Build fast APIs.
        }
      }
    `);
    const agentNode = nodes[0] as AgentNode;
    const md = Transpiler.toAgentFile(agentNode);

    // Check YAML frontmatter
    expect(md).toContain("---");
    expect(md).toContain("id: md-test");
    expect(md).toContain('name: "Markdown Test"');
    expect(md).toContain("tier: worker");
    expect(md).toContain("sections: [BACKEND]");
    expect(md).toContain("capabilities: [api, rest]");
    expect(md).toContain("llm: sonnet");
    expect(md).toContain("escalates-to: lead");
    expect(md).toContain("tools: [terminal, file-io]");

    // Check heading
    expect(md).toContain("# Markdown Test");

    // Check prompt
    expect(md).toContain("You are a backend expert.");

    // Check tools section
    expect(md).toContain("## Tools");
    expect(md).toContain("- terminal");
    expect(md).toContain("- file-io");
  });

  it("should transpile workflow to JSON", () => {
    const result = compile(`
      workflow test-flow {
        trigger "on push"
        step build {
          agent builder
          action "compile code"
          on-fail retry
        }
        step deploy {
          agent deployer
          action "ship it"
          requires build
        }
      }
    `);
    expect(result).toHaveLength(1);
    const wf = result[0] as Record<string, unknown>;
    expect(wf).toMatchObject({
      type: "workflow",
      id: "test-flow",
      trigger: "on push",
    });
    const steps = wf.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe("build");
    expect(steps[0].agent).toBe("builder");
    expect(steps[0].action).toBe("compile code");
    expect(steps[0].onFail).toBe("retry");
    expect(steps[1].requires).toBe("build");
  });

  it("should transpile pipeline to JSON", () => {
    const result = compile(`
      pipeline deploy-pipe {
        parallel {
          agent linter -> "lint"
          agent tester -> "test"
        }
        then {
          agent deployer -> "deploy"
        }
      }
    `);
    expect(result).toHaveLength(1);
    const pipe = result[0] as Record<string, unknown>;
    expect(pipe).toMatchObject({
      type: "pipeline",
      id: "deploy-pipe",
    });
    const stages = pipe.stages as Array<Record<string, unknown>>;
    expect(stages).toHaveLength(2);
    expect(stages[0].type).toBe("parallel");
    const parallelTasks = stages[0].tasks as Array<Record<string, string>>;
    expect(parallelTasks).toHaveLength(2);
    expect(parallelTasks[0].agent).toBe("linter");
    expect(parallelTasks[0].action).toBe("lint");
    expect(stages[1].type).toBe("then");
  });

  it("should generate BAP-01 registration messages", () => {
    const nodes = compileNodes(`
      agent reg-test {
        name "Reg Test"
        tier worker
        sections [FRONTEND]
        capabilities [react]
        llm haiku
        format markdown
      }
      workflow ignored-wf {
        step s1 {
          agent reg-test
          action "do work"
        }
      }
    `);
    const messages = Transpiler.toRegistrationMessages(nodes);
    // Only agent nodes produce registration messages (workflow is skipped)
    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.from).toBe("reg-test");
    expect(msg.to).toBe("registry");
    expect(msg.type).toBe("register");
    expect(msg.priority).toBe(3);
    expect(typeof msg.timestamp).toBe("number");
    expect(typeof msg.id).toBe("string");

    const payload = msg.payload as Record<string, unknown>;
    expect(payload.id).toBe("reg-test");
    expect(payload.name).toBe("Reg Test");
    expect(payload.tier).toBe("worker");
  });

  it("should handle defaults when properties aren't specified", () => {
    const result = compile(`
      agent minimal {
        tier worker
      }
    `);
    const agent = result[0] as Record<string, unknown>;
    // Name falls back to id
    expect(agent.name).toBe("minimal");
    // LLM falls back to sonnet
    expect(agent.llmRequirement).toBe("sonnet");
    // Format falls back to markdown
    expect(agent.format).toBe("markdown");
    // Empty arrays for unspecified list properties
    expect(agent.sections).toEqual([]);
    expect(agent.capabilities).toEqual([]);
    expect(agent.dependencies).toEqual([]);
    // No escalation target
    expect(agent.escalationTarget).toBeNull();
  });
});
