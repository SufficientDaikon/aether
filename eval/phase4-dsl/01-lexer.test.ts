// -----------------------------------------------------------------
// AETHER Eval -- Phase 4: Lexer Tests
// Tests Synapse DSL Lexer: tokenization, comments, multiline prompt
// blocks, hyphenated keywords, arrow operators, structural tokens
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 4.1.1: Tokenize an agent definition -------------------------
  await harness.runTest(
    "4.1.1",
    "Lexer -- Tokenize agent definition, verify token types",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");

        const src = `agent test-worker {
  name "Test Worker"
  tier worker
}`;
        const lexer = new Lexer(src);
        const tokens = lexer.tokenize();

        // Should produce tokens: KEYWORD(agent), IDENTIFIER(test-worker),
        // BLOCK_START, NEWLINE, KEYWORD(name), STRING(Test Worker),
        // NEWLINE, KEYWORD(tier), IDENTIFIER(worker), NEWLINE, BLOCK_END, EOF
        if (Array.isArray(tokens) && tokens.length > 0) {
          details.push(`Produced ${tokens.length} tokens`);
          score += 1;
        } else {
          details.push("tokenize() did not return an array of tokens");
          return { score, maxScore, details: details.join("; ") };
        }

        // First token should be KEYWORD "agent"
        const first = tokens[0];
        if (first.type === "KEYWORD" && first.value === "agent") {
          details.push("First token is KEYWORD 'agent'");
          score += 1;
        } else {
          details.push(
            `First token: ${first.type} '${first.value}' (expected KEYWORD 'agent')`,
          );
        }

        // Second token should be IDENTIFIER "test-worker" (hyphenated ident)
        const second = tokens[1];
        if (second.type === "IDENTIFIER" && second.value === "test-worker") {
          details.push("Agent id tokenized as IDENTIFIER 'test-worker'");
          score += 1;
        } else {
          details.push(
            `Second token: ${second.type} '${second.value}' (expected IDENTIFIER 'test-worker')`,
          );
        }

        // Should contain a BLOCK_START token
        const hasBlockStart = tokens.some((t) => t.type === "BLOCK_START");
        if (hasBlockStart) {
          details.push("Contains BLOCK_START token");
          score += 1;
        } else {
          details.push("Missing BLOCK_START token");
        }

        // Should contain a STRING token with value "Test Worker"
        const strTok = tokens.find((t) => t.type === "STRING");
        if (strTok && strTok.value === "Test Worker") {
          details.push("STRING token 'Test Worker' found");
          score += 1;
        } else {
          details.push("STRING token 'Test Worker' not found");
        }

        // Last token should be EOF
        const last = tokens[tokens.length - 1];
        if (last.type === "EOF") {
          details.push("Last token is EOF");
          score += 1;
        } else {
          details.push(`Last token: ${last.type} (expected EOF)`);
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.1.2: Comments are skipped ---------------------------------
  await harness.runTest(
    "4.1.2",
    "Lexer -- Single-line comments are stripped from token stream",
    async () => {
      let score = 0;
      const maxScore = 3;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");

        const src = `// This is a comment
agent my_agent {
  // Another comment inside body
  name "Agent"
}`;
        const lexer = new Lexer(src);
        const tokens = lexer.tokenize();

        // No token should contain the comment text
        const hasCommentToken = tokens.some(
          (t) =>
            t.value.includes("This is a comment") ||
            t.value.includes("Another comment"),
        );
        if (!hasCommentToken) {
          details.push("Comment text absent from token stream");
          score += 1;
        } else {
          details.push("Comment text leaked into token stream");
        }

        // Should still have the agent keyword
        const hasAgent = tokens.some(
          (t) => t.type === "KEYWORD" && t.value === "agent",
        );
        if (hasAgent) {
          details.push("KEYWORD 'agent' present after comment stripping");
          score += 1;
        } else {
          details.push("KEYWORD 'agent' missing");
        }

        // Should still have the string "Agent"
        const hasName = tokens.some(
          (t) => t.type === "STRING" && t.value === "Agent",
        );
        if (hasName) {
          details.push("STRING 'Agent' present after comment stripping");
          score += 1;
        } else {
          details.push("STRING 'Agent' missing");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.1.3: Multiline prompt blocks ------------------------------
  await harness.runTest(
    "4.1.3",
    "Lexer -- Multiline prompt block tokenized as MULTILINE_STRING",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");

        const src = `agent prompter {
  prompt {
    You are a helpful assistant.
    Follow instructions carefully.
    Always be concise.
  }
}`;
        const lexer = new Lexer(src);
        const tokens = lexer.tokenize();

        // Should contain a KEYWORD "prompt" token
        const promptKw = tokens.find(
          (t) => t.type === "KEYWORD" && t.value === "prompt",
        );
        if (promptKw) {
          details.push("KEYWORD 'prompt' found");
          score += 1;
        } else {
          details.push("KEYWORD 'prompt' missing");
        }

        // Should contain a MULTILINE_STRING token (not BLOCK_START after prompt)
        const multiStr = tokens.find((t) => t.type === "MULTILINE_STRING");
        if (multiStr) {
          details.push("MULTILINE_STRING token present");
          score += 1;
        } else {
          details.push("MULTILINE_STRING token missing");
          return { score, maxScore, details: details.join("; ") };
        }

        // Multiline string should contain expected text
        if (multiStr.value.includes("helpful assistant")) {
          details.push("Prompt content preserved in MULTILINE_STRING");
          score += 1;
        } else {
          details.push(
            `Prompt content not found in value: '${multiStr.value.slice(0, 80)}'`,
          );
        }

        // The lexer should NOT produce a BLOCK_START token immediately after "prompt"
        // (the prompt { is consumed as part of the MULTILINE_STRING logic)
        const promptIdx = tokens.indexOf(promptKw!);
        const nextTok = tokens[promptIdx + 1];
        if (nextTok && nextTok.type === "MULTILINE_STRING") {
          details.push(
            "MULTILINE_STRING follows directly after prompt keyword (no BLOCK_START)",
          );
          score += 1;
        } else {
          details.push(
            `Token after 'prompt': ${nextTok?.type} (expected MULTILINE_STRING)`,
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

  // -- Test 4.1.4: Hyphenated keywords ----------------------------------
  await harness.runTest(
    "4.1.4",
    "Lexer -- Hyphenated keywords (on-fail, escalates-to) tokenized correctly",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");

        // Test on-fail keyword
        const src1 = `on-fail escalate`;
        const tokens1 = new Lexer(src1).tokenize();
        const onFail = tokens1.find((t) => t.value === "on-fail");
        if (onFail && onFail.type === "KEYWORD") {
          details.push("'on-fail' tokenized as single KEYWORD");
          score += 1;
        } else {
          details.push(
            `'on-fail' not tokenized as KEYWORD: ${onFail?.type ?? "not found"}`,
          );
        }

        // Test escalates-to keyword
        const src2 = `escalates-to system-architect`;
        const tokens2 = new Lexer(src2).tokenize();
        const escalatesTo = tokens2.find((t) => t.value === "escalates-to");
        if (escalatesTo && escalatesTo.type === "KEYWORD") {
          details.push("'escalates-to' tokenized as single KEYWORD");
          score += 1;
        } else {
          details.push(
            `'escalates-to' not tokenized as KEYWORD: ${escalatesTo?.type ?? "not found"}`,
          );
        }

        // system-architect should be IDENTIFIER (hyphenated but not a keyword)
        const sysArch = tokens2.find((t) => t.value === "system-architect");
        if (sysArch && sysArch.type === "IDENTIFIER") {
          details.push("'system-architect' tokenized as IDENTIFIER");
          score += 1;
        } else {
          details.push(
            `'system-architect' token: ${sysArch?.type ?? "not found"}`,
          );
        }

        // Arrow should NOT be consumed as part of a hyphenated keyword
        const src3 = `agent alpha -> "test"`;
        const tokens3 = new Lexer(src3).tokenize();
        const arrow = tokens3.find((t) => t.type === "ARROW");
        if (arrow && arrow.value === "->") {
          details.push("Arrow '->' not consumed by hyphen logic");
          score += 1;
        } else {
          details.push("Arrow '->' was consumed incorrectly or missing");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 4.1.5: Arrow operator, structural tokens, lists -------------
  await harness.runTest(
    "4.1.5",
    "Lexer -- Structural tokens: arrows, brackets, commas, newlines",
    async () => {
      let score = 0;
      const maxScore = 3;
      const details: string[] = [];

      try {
        const { Lexer } = await import("../../dsl/lexer.ts");

        const src = `tools [file_io, terminal, browser]`;
        const tokens = new Lexer(src).tokenize();

        // Should contain LIST_START and LIST_END
        const hasListStart = tokens.some((t) => t.type === "LIST_START");
        const hasListEnd = tokens.some((t) => t.type === "LIST_END");
        if (hasListStart && hasListEnd) {
          details.push("LIST_START and LIST_END present");
          score += 1;
        } else {
          details.push(`LIST_START: ${hasListStart}, LIST_END: ${hasListEnd}`);
        }

        // Should contain COMMA tokens
        const commas = tokens.filter((t) => t.type === "COMMA");
        if (commas.length === 2) {
          details.push("Two COMMA tokens found (3-element list)");
          score += 1;
        } else {
          details.push(`COMMA count: ${commas.length} (expected 2)`);
        }

        // Token positions: line and column should be populated
        const allHavePos = tokens.every(
          (t) => typeof t.line === "number" && typeof t.column === "number",
        );
        if (allHavePos) {
          details.push("All tokens have line and column metadata");
          score += 1;
        } else {
          details.push("Some tokens missing positional metadata");
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
