// -----------------------------------------------------------------
// AETHER Eval -- Phase 4: Error Handling Tests
// Tests error conditions: missing fields, invalid keywords,
// unclosed blocks, empty input, unterminated strings
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 4.5.1: Missing required fields ------------------------------
  await harness.runTest(
    "4.5.1",
    "Errors -- Missing fields: agent without id, step without braces",
    async () => {
      let score = 0;
      const maxScore = 3;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        // Agent missing its identifier (just "agent {")
        try {
          const tokens1 = new Lexer(`agent {}`).tokenize();
          new Parser(tokens1).parse();
          details.push("FAIL: no error for agent without id");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for agent without id");
            score += 1;
          } else {
            details.push(`Non-SyntaxError thrown for agent without id: ${e}`);
            score += 1;
          }
        }

        // Workflow step missing block (step without braces)
        try {
          const src = `workflow broken {
  step orphan
}`;
          const tokens2 = new Lexer(src).tokenize();
          new Parser(tokens2).parse();
          details.push("FAIL: no error for step missing block");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for step missing block");
            score += 1;
          } else {
            details.push(`Non-SyntaxError for step missing block: ${e}`);
            score += 1;
          }
        }

        // Pipeline stage missing agent keyword
        try {
          const src = `pipeline broken {
  parallel {
    "Run tests"
  }
}`;
          const tokens3 = new Lexer(src).tokenize();
          new Parser(tokens3).parse();
          details.push(
            "FAIL: no error for pipeline task missing agent keyword",
          );
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for pipeline task missing agent keyword");
            score += 1;
          } else {
            details.push(`Non-SyntaxError for pipeline task: ${e}`);
            score += 1;
          }
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.5.2: Invalid/unexpected keywords --------------------------
  await harness.runTest(
    "4.5.2",
    "Errors -- Invalid keywords at top level and in bodies",
    async () => {
      let score = 0;
      const maxScore = 2;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        // Invalid top-level keyword "foobar" -- Lexer will tokenize as IDENTIFIER,
        // Parser should reject as unexpected token at top level
        try {
          const tokens1 = new Lexer(`foobar test {}`).tokenize();
          new Parser(tokens1).parse();
          details.push("FAIL: no error for invalid top-level keyword");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for invalid top-level keyword");
            score += 1;
          } else {
            details.push(`Non-SyntaxError: ${e}`);
            score += 1;
          }
        }

        // Invalid on-fail value (not escalate|skip|retry)
        try {
          const src = `workflow wf {
  step s1 {
    agent tester
    action "test"
    on-fail explode
  }
}`;
          const tokens2 = new Lexer(src).tokenize();
          new Parser(tokens2).parse();
          details.push("FAIL: no error for invalid on-fail value 'explode'");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for invalid on-fail value 'explode'");
            score += 1;
          } else {
            details.push(`Non-SyntaxError for invalid on-fail: ${e}`);
            score += 1;
          }
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.5.3: Unclosed blocks and unterminated strings -------------
  await harness.runTest(
    "4.5.3",
    "Errors -- Unclosed blocks and unterminated strings",
    async () => {
      let score = 0;
      const maxScore = 3;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        // Unclosed agent block (missing closing })
        try {
          const tokens1 = new Lexer(
            `agent broken {\n  name "Test"\n`,
          ).tokenize();
          new Parser(tokens1).parse();
          details.push("FAIL: no error for unclosed agent block");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for unclosed agent block");
            score += 1;
          } else {
            details.push(`Non-SyntaxError for unclosed block: ${e}`);
            score += 1;
          }
        }

        // Unterminated string literal at lexer level
        try {
          new Lexer(`agent test {\n  name "unclosed string\n}`).tokenize();
          details.push("FAIL: no error for unterminated string");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for unterminated string");
            score += 1;
          } else {
            details.push(`Non-SyntaxError for unterminated string: ${e}`);
            score += 1;
          }
        }

        // Unterminated prompt block at lexer level
        try {
          new Lexer(`agent test {\n  prompt {\n    Hello world\n`).tokenize();
          details.push("FAIL: no error for unterminated prompt block");
        } catch (e) {
          if (e instanceof SyntaxError) {
            details.push("SyntaxError for unterminated prompt block");
            score += 1;
          } else {
            details.push(`Non-SyntaxError for unterminated prompt: ${e}`);
            score += 1;
          }
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.5.4: Empty input ------------------------------------------
  await harness.runTest(
    "4.5.4",
    "Errors -- Empty and whitespace-only input produces no nodes",
    async () => {
      let score = 0;
      const maxScore = 2;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");
        const { Parser } = await import("../../dsl/parser.ts");

        // Empty string
        const tokens1 = new Lexer("").tokenize();
        const nodes1 = new Parser(tokens1).parse();
        if (Array.isArray(nodes1) && nodes1.length === 0) {
          details.push("Empty input produces 0 AST nodes");
          score += 1;
        } else {
          details.push(`Empty input produced ${nodes1?.length ?? "N/A"} nodes`);
        }

        // Whitespace and comments only
        const src = `
  // Just a comment
  // Another comment

`;
        const tokens2 = new Lexer(src).tokenize();
        const nodes2 = new Parser(tokens2).parse();
        if (Array.isArray(nodes2) && nodes2.length === 0) {
          details.push("Whitespace/comment-only input produces 0 AST nodes");
          score += 1;
        } else {
          details.push(
            `Comment-only input produced ${nodes2?.length ?? "N/A"} nodes`,
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
}
