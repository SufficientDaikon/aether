// ─────────────────────────────────────────────────────────────
// Synapse DSL — Lexer / Tokenizer
// Transforms raw Synapse source into a stream of typed tokens
// ─────────────────────────────────────────────────────────────

/** All token types the Synapse lexer can produce */
export type TokenType =
  | "KEYWORD"
  | "IDENTIFIER"
  | "STRING"
  | "MULTILINE_STRING"
  | "BLOCK_START"
  | "BLOCK_END"
  | "LIST_START"
  | "LIST_END"
  | "ARROW"
  | "COMMA"
  | "NEWLINE"
  | "EOF";

/** A single lexed token with positional metadata */
export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

/** Reserved keywords in the Synapse language */
const KEYWORDS = new Set([
  "agent",
  "workflow",
  "pipeline",
  "step",
  "when",
  "trigger",
  "action",
  "requires",
  "on-fail",
  "parallel",
  "then",
  "prompt",
  "tools",
  "name",
  "tier",
  "sections",
  "capabilities",
  "dependencies",
  "llm",
  "format",
  "escalates-to",
  "request",
  "notify",
  "include",
  "context",
]);

/**
 * Lexer for the Synapse DSL.
 *
 * Converts a raw source string into an array of `Token` objects,
 * skipping comments and insignificant whitespace while preserving
 * newlines as statement separators.
 */
export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  // ───────────────── Public API ─────────────────

  /** Tokenize the full source and return the token array. */
  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      this.skipSpacesAndTabs();

      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Newlines — collapse consecutive newlines into one token
      if (ch === "\n" || ch === "\r") {
        this.readNewline();
        continue;
      }

      // Single-line comments
      if (ch === "/" && this.peek(1) === "/") {
        this.readComment();
        continue;
      }

      // Strings
      if (ch === '"') {
        this.tokens.push(this.readString());
        continue;
      }

      // Arrow operator ->
      if (ch === "-" && this.peek(1) === ">") {
        this.tokens.push(this.makeToken("ARROW", "->", 2));
        continue;
      }

      // Structural characters
      if (ch === "{") {
        // Check if the preceding token is "prompt" — if so, capture block as MULTILINE_STRING
        const lastTok = this.tokens[this.tokens.length - 1];
        if (lastTok && lastTok.type === "KEYWORD" && lastTok.value === "prompt") {
          this.tokens.push(this.readPromptBlock());
          continue;
        }
        this.tokens.push(this.makeToken("BLOCK_START", "{", 1));
        continue;
      }
      if (ch === "}") {
        this.tokens.push(this.makeToken("BLOCK_END", "}", 1));
        continue;
      }
      if (ch === "[") {
        this.tokens.push(this.makeToken("LIST_START", "[", 1));
        continue;
      }
      if (ch === "]") {
        this.tokens.push(this.makeToken("LIST_END", "]", 1));
        continue;
      }
      if (ch === ",") {
        this.tokens.push(this.makeToken("COMMA", ",", 1));
        continue;
      }

      // Identifiers / keywords (may contain hyphens like `on-fail`)
      if (this.isIdentStart(ch)) {
        this.tokens.push(this.readIdentifierOrKeyword());
        continue;
      }

      this.error(`Unexpected character '${ch}'`);
    }

    this.tokens.push({
      type: "EOF",
      value: "",
      line: this.line,
      column: this.column,
    });
    return this.tokens;
  }

  // ───────────────── Token readers ─────────────────

  /** Read a double-quoted string literal. */
  private readString(): Token {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip opening "
    let value = "";

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];

      if (ch === "\\") {
        // Escape sequences
        this.advance();
        if (this.pos >= this.source.length) {
          this.error("Unexpected end of input in string escape");
        }
        const escaped = this.source[this.pos];
        switch (escaped) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case '"':
            value += '"';
            break;
          case "\\":
            value += "\\";
            break;
          default:
            value += escaped;
        }
        this.advance();
        continue;
      }

      if (ch === '"') {
        this.advance(); // skip closing "
        return { type: "STRING", value, line: startLine, column: startCol };
      }

      if (ch === "\n") {
        this.line++;
        this.column = 1;
      }

      value += ch;
      this.advance();
    }

    this.error("Unterminated string literal");
  }

  /**
   * Read a `prompt { ... }` block as a single MULTILINE_STRING token.
   * Everything between the opening `{` and the matching `}` is captured
   * as raw text, preserving whitespace. Handles nested braces.
   */
  private readPromptBlock(): Token {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // consume opening {

    let depth = 1;
    let value = "";

    while (this.pos < this.source.length && depth > 0) {
      const ch = this.source[this.pos];

      if (ch === "{") {
        depth++;
        value += ch;
        this.advance();
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          this.advance(); // consume closing }
          break;
        }
        value += ch;
        this.advance();
      } else {
        if (ch === "\n") {
          this.line++;
          this.column = 0; // advance() will set it to 1
        }
        value += ch;
        this.advance();
      }
    }

    if (depth !== 0) {
      this.error("Unterminated prompt block");
    }

    // Trim and normalise: remove leading/trailing blank lines
    const trimmed = value
      .split("\n")
      .map((l) => l.trim())
      .filter((l, i, arr) => {
        if (i === 0 && l === "") return false;
        if (i === arr.length - 1 && l === "") return false;
        return true;
      })
      .join("\n");

    return {
      type: "MULTILINE_STRING",
      value: trimmed,
      line: startLine,
      column: startCol,
    };
  }

  /**
   * Read an identifier or keyword.
   * Identifiers may contain alphanumeric chars, hyphens, and underscores.
   * A hyphenated word (e.g. `on-fail`, `escalates-to`) is treated as
   * a single token when the combined form is a keyword; otherwise the
   * hyphen is NOT consumed (it could be part of an arrow `->`, handled
   * separately at the top level).
   */
  private readIdentifierOrKeyword(): Token {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    // Read the first word segment
    while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }

    // Greedily try to absorb hyphen-separated segments if the combined
    // form might be a keyword (e.g. `on-fail`, `escalates-to`).
    while (
      this.pos < this.source.length &&
      this.source[this.pos] === "-" &&
      this.peek(1) !== ">" // don't eat the arrow
    ) {
      const savedPos = this.pos;
      const savedCol = this.column;
      const savedLine = this.line;

      // Tentatively consume the hyphen and next segment
      this.advance(); // skip '-'
      let segment = "-";
      while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos])) {
        segment += this.source[this.pos];
        this.advance();
      }

      const combined = value + segment;
      if (KEYWORDS.has(combined) || this.looksLikeIdentWithHyphen(combined)) {
        value = combined;
      } else {
        // Roll back — the hyphen isn't part of this token
        this.pos = savedPos;
        this.column = savedCol;
        this.line = savedLine;
        break;
      }
    }

    const type: TokenType = KEYWORDS.has(value) ? "KEYWORD" : "IDENTIFIER";
    return { type, value, line: startLine, column: startCol };
  }

  /** Skip a single-line comment (from `//` to end of line). */
  private readComment(): void {
    while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
      this.advance();
    }
    // Don't consume the newline — let the main loop handle it
  }

  /** Collapse one or more newline sequences into a single NEWLINE token. */
  private readNewline(): void {
    // Avoid duplicate NEWLINE tokens
    const last = this.tokens[this.tokens.length - 1];
    const needsToken = !last || (last.type !== "NEWLINE" && last.type !== "BLOCK_START");

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === "\r") {
        this.pos++;
        this.column = 1;
        // Consume optional \n after \r
        if (this.pos < this.source.length && this.source[this.pos] === "\n") {
          this.pos++;
        }
        this.line++;
      } else if (ch === "\n") {
        this.pos++;
        this.line++;
        this.column = 1;
      } else if (ch === " " || ch === "\t") {
        // Skip whitespace between newlines
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }

    if (needsToken) {
      this.tokens.push({
        type: "NEWLINE",
        value: "\\n",
        line: this.line,
        column: this.column,
      });
    }
  }

  // ───────────────── Helpers ─────────────────

  /** Skip spaces and tabs (but NOT newlines). */
  private skipSpacesAndTabs(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === " " || ch === "\t") {
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }
  }

  /** Peek ahead by `offset` characters without consuming. */
  private peek(offset: number): string | undefined {
    return this.source[this.pos + offset];
  }

  /** Advance the cursor by one character. */
  private advance(): void {
    this.pos++;
    this.column++;
  }

  /** Create a token and advance by `length` characters. */
  private makeToken(type: TokenType, value: string, length: number): Token {
    const tok: Token = { type, value, line: this.line, column: this.column };
    for (let i = 0; i < length; i++) {
      this.advance();
    }
    return tok;
  }

  /** Is `ch` a valid start of an identifier? */
  private isIdentStart(ch: string): boolean {
    return /[a-zA-Z_]/.test(ch);
  }

  /** Is `ch` a valid continuation of an identifier? */
  private isIdentChar(ch: string): boolean {
    return /[a-zA-Z0-9_]/.test(ch);
  }

  /** Heuristic: does the hyphenated word look like a compound identifier? */
  private looksLikeIdentWithHyphen(word: string): boolean {
    // All agent/capability names use hyphens (e.g. `react-specialist`)
    // We allow them as identifiers when they're not keywords.
    // The parser context decides whether the token is meaningful.
    return /^[a-zA-Z_][a-zA-Z0-9_]*(-[a-zA-Z0-9_]+)+$/.test(word);
  }

  /** Throw a descriptive error with source position. */
  private error(message: string): never {
    throw new SyntaxError(
      `[Synapse Lexer] ${message} at line ${this.line}, column ${this.column}`
    );
  }
}
