// ─────────────────────────────────────────────────────────────
// Synapse DSL — Recursive Descent Parser
// Transforms a token stream into an Abstract Syntax Tree (AST)
// ─────────────────────────────────────────────────────────────

import type { Token, TokenType } from "./lexer.ts";

// ───────────────── AST Node Types ─────────────────

export type ASTNode = AgentNode | WorkflowNode | PipelineNode;

export interface AgentNode {
  type: "agent";
  id: string;
  properties: Record<string, string | string[]>;
  prompt?: string;
  tools?: string[];
  handlers: HandlerNode[];
}

export interface HandlerNode {
  type: "when";
  condition: string;
  actions: ActionNode[];
}

export interface ActionNode {
  type: "request" | "notify" | "include" | "escalate";
  target: string;
  args?: string[];
}

export interface WorkflowNode {
  type: "workflow";
  id: string;
  trigger?: string;
  steps: StepNode[];
}

export interface StepNode {
  type: "step";
  id: string;
  agent: string;
  action: string;
  requires?: string;
  onFail?: "escalate" | "skip" | "retry";
}

export interface PipelineNode {
  type: "pipeline";
  id: string;
  stages: PipelineStage[];
}

export interface PipelineStage {
  type: "parallel" | "then";
  tasks: { agent: string; action: string }[];
}

// ───────────────── Parser ─────────────────

/**
 * Recursive descent parser for the Synapse DSL.
 *
 * Grammar (simplified):
 *   program       → (agent | workflow | pipeline)* EOF
 *   agent         → "agent" IDENT "{" agentBody "}"
 *   agentBody     → (property | prompt | tools | handler | NEWLINE)*
 *   property      → KEYWORD (STRING | IDENT | list)
 *   list          → "[" (IDENT ("," IDENT)*)? "]"
 *   prompt        → "prompt" "{" MULTILINE_STRING "}"       (parsed as raw text)
 *   handler       → "when" IDENT (IDENT)? "{" handlerBody "}"
 *   handlerBody   → (action NEWLINE)*
 *   action        → ("request" | "notify" | "include") IDENT
 *   workflow      → "workflow" IDENT "{" workflowBody "}"
 *   workflowBody  → (trigger | step | NEWLINE)*
 *   trigger       → "trigger" STRING
 *   step          → "step" IDENT "{" stepBody "}"
 *   stepBody      → (KEYWORD (STRING | IDENT) NEWLINE)*
 *   pipeline      → "pipeline" IDENT "{" pipelineBody "}"
 *   pipelineBody  → (parallel | then | NEWLINE)*
 *   parallel      → "parallel" "{" taskList "}"
 *   then          → "then" "{" taskList "}"
 *   taskList      → (task NEWLINE)*
 *   task          → "agent" IDENT "->" STRING
 */
export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ───────────────── Public API ─────────────────

  /** Parse the full token stream and return an array of top-level AST nodes. */
  parse(): ASTNode[] {
    const nodes: ASTNode[] = [];

    this.skipNewlines();

    while (!this.isAtEnd()) {
      const tok = this.current();

      if (tok.type === "NEWLINE") {
        this.advance();
        continue;
      }

      if (tok.type === "KEYWORD") {
        switch (tok.value) {
          case "agent":
            nodes.push(this.parseAgent());
            break;
          case "workflow":
            nodes.push(this.parseWorkflow());
            break;
          case "pipeline":
            nodes.push(this.parsePipeline());
            break;
          default:
            this.error(`Unexpected top-level keyword "${tok.value}"`, tok);
        }
      } else if (tok.type === "EOF") {
        break;
      } else {
        this.error(`Unexpected token "${tok.value}" at top level`, tok);
      }

      this.skipNewlines();
    }

    return nodes;
  }

  // ───────────────── Agent Parsing ─────────────────

  private parseAgent(): AgentNode {
    this.expectKeyword("agent");
    const id = this.expectIdentifier();
    this.expect("BLOCK_START");
    this.skipNewlines();

    const node: AgentNode = {
      type: "agent",
      id,
      properties: {},
      handlers: [],
    };

    while (!this.check("BLOCK_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("BLOCK_END")) break;

      const tok = this.current();

      // `prompt { ... }`
      if (tok.type === "KEYWORD" && tok.value === "prompt") {
        node.prompt = this.parsePromptBlock();
        this.skipNewlines();
        continue;
      }

      // `tools [...]`
      if (tok.type === "KEYWORD" && tok.value === "tools") {
        this.advance();
        node.tools = this.parseList();
        this.skipNewlines();
        continue;
      }

      // `when <condition> { ... }`
      if (tok.type === "KEYWORD" && tok.value === "when") {
        node.handlers.push(this.parseHandler());
        this.skipNewlines();
        continue;
      }

      // Property: keyword followed by a value (string, identifier, or list)
      if (tok.type === "KEYWORD") {
        const key = tok.value;
        this.advance();

        if (this.check("LIST_START")) {
          node.properties[key] = this.parseList();
        } else if (this.check("STRING")) {
          node.properties[key] = this.current().value;
          this.advance();
        } else if (this.check("IDENTIFIER") || this.check("KEYWORD")) {
          // Some values like `sonnet`, `markdown`, `worker` are identifiers
          node.properties[key] = this.current().value;
          this.advance();
        } else {
          this.error(
            `Expected value after property "${key}", got ${this.current().type}`,
            this.current()
          );
        }
        this.skipNewlines();
        continue;
      }

      // Identifiers at agent body level are unexpected
      this.error(`Unexpected token "${tok.value}" in agent body`, tok);
    }

    this.expect("BLOCK_END");
    return node;
  }

  // ───────────────── Workflow Parsing ─────────────────

  private parseWorkflow(): WorkflowNode {
    this.expectKeyword("workflow");
    const id = this.expectIdentifier();
    this.expect("BLOCK_START");
    this.skipNewlines();

    const node: WorkflowNode = {
      type: "workflow",
      id,
      steps: [],
    };

    while (!this.check("BLOCK_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("BLOCK_END")) break;

      const tok = this.current();

      if (tok.type === "KEYWORD" && tok.value === "trigger") {
        this.advance();
        node.trigger = this.expectString();
        this.skipNewlines();
        continue;
      }

      if (tok.type === "KEYWORD" && tok.value === "step") {
        node.steps.push(this.parseStep());
        this.skipNewlines();
        continue;
      }

      this.error(`Unexpected token "${tok.value}" in workflow body`, tok);
    }

    this.expect("BLOCK_END");
    return node;
  }

  private parseStep(): StepNode {
    this.expectKeyword("step");
    const id = this.expectIdentifier();
    this.expect("BLOCK_START");
    this.skipNewlines();

    const step: StepNode = {
      type: "step",
      id,
      agent: "",
      action: "",
    };

    while (!this.check("BLOCK_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("BLOCK_END")) break;

      const tok = this.current();
      if (tok.type !== "KEYWORD") {
        this.error(`Expected keyword in step body, got "${tok.value}"`, tok);
      }

      switch (tok.value) {
        case "agent": {
          this.advance();
          step.agent = this.expectIdentifier();
          break;
        }
        case "action": {
          this.advance();
          step.action = this.expectString();
          break;
        }
        case "requires": {
          this.advance();
          step.requires = this.expectIdentifier();
          break;
        }
        case "on-fail": {
          this.advance();
          const val = this.expectIdentifier();
          if (val !== "escalate" && val !== "skip" && val !== "retry") {
            this.error(
              `Invalid on-fail value "${val}" (expected escalate|skip|retry)`,
              this.tokens[this.pos - 1]
            );
          }
          step.onFail = val as "escalate" | "skip" | "retry";
          break;
        }
        default:
          this.error(`Unknown step property "${tok.value}"`, tok);
      }

      this.skipNewlines();
    }

    this.expect("BLOCK_END");
    return step;
  }

  // ───────────────── Pipeline Parsing ─────────────────

  private parsePipeline(): PipelineNode {
    this.expectKeyword("pipeline");
    const id = this.expectIdentifier();
    this.expect("BLOCK_START");
    this.skipNewlines();

    const node: PipelineNode = {
      type: "pipeline",
      id,
      stages: [],
    };

    while (!this.check("BLOCK_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("BLOCK_END")) break;

      const tok = this.current();
      if (tok.type === "KEYWORD" && (tok.value === "parallel" || tok.value === "then")) {
        node.stages.push(this.parsePipelineStage(tok.value as "parallel" | "then"));
        this.skipNewlines();
        continue;
      }

      this.error(`Unexpected token "${tok.value}" in pipeline body`, tok);
    }

    this.expect("BLOCK_END");
    return node;
  }

  private parsePipelineStage(kind: "parallel" | "then"): PipelineStage {
    this.advance(); // consume "parallel" or "then"
    this.expect("BLOCK_START");
    this.skipNewlines();

    const stage: PipelineStage = { type: kind, tasks: [] };

    while (!this.check("BLOCK_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("BLOCK_END")) break;

      // Each task: agent <name> -> "action string"
      this.expectKeyword("agent");
      const agentId = this.expectIdentifier();
      this.expect("ARROW");
      const action = this.expectString();

      stage.tasks.push({ agent: agentId, action });
      this.skipNewlines();
    }

    this.expect("BLOCK_END");
    return stage;
  }

  // ───────────────── Handler Parsing ─────────────────

  private parseHandler(): HandlerNode {
    this.expectKeyword("when");

    // Condition: one or more identifier/keyword tokens before `{`
    let condition = "";
    while (!this.check("BLOCK_START") && !this.isAtEnd()) {
      const tok = this.current();
      if (tok.type === "NEWLINE") break;
      if (condition) condition += " ";
      condition += tok.value;
      this.advance();
    }

    if (!condition) {
      this.error("Expected condition after 'when'", this.current());
    }

    this.expect("BLOCK_START");
    this.skipNewlines();

    const handler: HandlerNode = {
      type: "when",
      condition: condition.trim(),
      actions: [],
    };

    while (!this.check("BLOCK_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("BLOCK_END")) break;

      const tok = this.current();

      if (tok.type === "KEYWORD") {
        switch (tok.value) {
          case "request":
          case "notify": {
            const actionType = tok.value as "request" | "notify";
            this.advance();
            const target = this.expectIdentifier();
            handler.actions.push({ type: actionType, target });
            break;
          }
          case "include": {
            this.advance();
            const target = this.current().value;
            this.advance();
            handler.actions.push({ type: "include", target });
            break;
          }
          default:
            this.error(`Unknown handler action "${tok.value}"`, tok);
        }
      } else if (tok.type === "IDENTIFIER") {
        // Allow identifiers like "escalate" as handler actions
        if (tok.value === "escalate") {
          this.advance();
          handler.actions.push({ type: "escalate", target: "" });
        } else {
          this.error(`Unexpected identifier "${tok.value}" in handler body`, tok);
        }
      } else {
        this.error(`Unexpected token "${tok.value}" in handler body`, tok);
      }

      this.skipNewlines();
    }

    this.expect("BLOCK_END");
    return handler;
  }

  // ───────────────── Shared Helpers ─────────────────

  /** Parse a `[item, item, ...]` list. */
  private parseList(): string[] {
    this.expect("LIST_START");
    const items: string[] = [];

    while (!this.check("LIST_END") && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check("LIST_END")) break;

      // Items can be identifiers or keywords (e.g. section names)
      const tok = this.current();
      if (tok.type === "IDENTIFIER" || tok.type === "KEYWORD" || tok.type === "STRING") {
        items.push(tok.value);
        this.advance();
      } else {
        this.error(`Unexpected token "${tok.value}" in list`, tok);
      }

      // Optional comma
      if (this.check("COMMA")) {
        this.advance();
      }

      this.skipNewlines();
    }

    this.expect("LIST_END");
    return items;
  }

  /**
   * Parse a `prompt { ... }` block.
   * The lexer emits "prompt" KEYWORD + a single MULTILINE_STRING token
   * (the content between braces), so we just consume both.
   */
  private parsePromptBlock(): string {
    this.expectKeyword("prompt");

    const tok = this.current();
    if (tok.type === "MULTILINE_STRING") {
      this.advance();
      return tok.value;
    }

    // Fallback: if lexer didn't produce a MULTILINE_STRING, try token-by-token
    this.expect("BLOCK_START");
    let depth = 1;
    const parts: string[] = [];

    while (!this.isAtEnd() && depth > 0) {
      const t = this.current();

      if (t.type === "BLOCK_START") {
        depth++;
        parts.push("{");
        this.advance();
      } else if (t.type === "BLOCK_END") {
        depth--;
        if (depth === 0) {
          this.advance();
          break;
        }
        parts.push("}");
        this.advance();
      } else if (t.type === "NEWLINE") {
        parts.push("\n");
        this.advance();
      } else {
        parts.push(t.value);
        this.advance();
        const next = this.current();
        if (next && next.type !== "NEWLINE" && next.type !== "BLOCK_END" && depth > 0) {
          parts.push(" ");
        }
      }
    }

    const raw = parts.join("");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l, i, arr) => {
        if (i === 0 && l === "") return false;
        if (i === arr.length - 1 && l === "") return false;
        return true;
      })
      .join("\n");
  }

  // ───────────────── Token Navigation ─────────────────

  /** Return the current token without advancing. */
  private current(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", line: 0, column: 0 };
  }

  /** Peek at the next token without advancing. */
  private peek(): Token {
    return this.tokens[this.pos + 1] ?? { type: "EOF", value: "", line: 0, column: 0 };
  }

  /** Advance and return the consumed token. */
  private advance(): Token {
    const tok = this.current();
    if (this.pos < this.tokens.length) this.pos++;
    return tok;
  }

  /** Assert the current token matches `type`, consume it, and return it. */
  private expect(type: TokenType): Token {
    const tok = this.current();
    if (tok.type !== type) {
      this.error(`Expected ${type}, got ${tok.type} ("${tok.value}")`, tok);
    }
    return this.advance();
  }

  /** Check if the current token matches `type` without consuming. */
  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  /** Optionally consume a token if it matches. Returns true if consumed. */
  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  /** Skip over consecutive NEWLINE tokens. */
  private skipNewlines(): void {
    while (this.check("NEWLINE")) {
      this.advance();
    }
  }

  /** True when we've reached EOF. */
  private isAtEnd(): boolean {
    return this.current().type === "EOF";
  }

  // ───────────────── Expect Helpers ─────────────────

  /** Expect and consume a specific keyword. */
  private expectKeyword(value: string): Token {
    const tok = this.current();
    if (tok.type !== "KEYWORD" || tok.value !== value) {
      this.error(
        `Expected keyword "${value}", got ${tok.type} ("${tok.value}")`,
        tok
      );
    }
    return this.advance();
  }

  /** Expect and consume an IDENTIFIER, returning its value. */
  private expectIdentifier(): string {
    const tok = this.current();
    if (tok.type !== "IDENTIFIER" && tok.type !== "KEYWORD") {
      this.error(`Expected identifier, got ${tok.type} ("${tok.value}")`, tok);
    }
    this.advance();
    return tok.value;
  }

  /** Expect and consume a STRING token, returning its value. */
  private expectString(): string {
    const tok = this.expect("STRING");
    return tok.value;
  }

  /** Throw a descriptive parse error with location. */
  private error(message: string, token: Token): never {
    throw new SyntaxError(
      `[Synapse Parser] ${message} at line ${token.line}, column ${token.column}`
    );
  }
}
