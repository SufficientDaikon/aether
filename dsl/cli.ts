#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Synapse DSL — CLI Compiler
// Usage: bun run dsl/cli.ts <input.syn> [--output <dir>] [--format json|md|both]
// ─────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";

import { Lexer } from "./lexer.ts";
import { Parser } from "./parser.ts";
import type { ASTNode } from "./parser.ts";
import { Transpiler } from "./transpiler.ts";

// ───────────────── ANSI Helpers ─────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(msg: string): void {
  console.log(msg);
}

function info(label: string, value: string | number): void {
  console.log(`  ${c.dim}${label}${c.reset} ${c.bold}${value}${c.reset}`);
}

function success(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

function fatal(msg: string): never {
  console.error(`${c.red}✗ ${msg}${c.reset}`);
  process.exit(1);
}

// ───────────────── Argument Parsing ─────────────────

interface CLIArgs {
  inputFile: string;
  outputDir: string;
  format: "json" | "md" | "both";
  help: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    inputFile: "",
    outputDir: "./out",
    format: "both",
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      i++;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      i++;
      if (i >= argv.length) fatal("--output requires a directory path");
      args.outputDir = argv[i];
      i++;
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      i++;
      if (i >= argv.length) fatal("--format requires json|md|both");
      const val = argv[i];
      if (val !== "json" && val !== "md" && val !== "both") {
        fatal(`Invalid format "${val}" — expected json, md, or both`);
      }
      args.format = val;
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      fatal(`Unknown flag: ${arg}`);
    }

    // Positional: input file
    if (!args.inputFile) {
      args.inputFile = arg;
    } else {
      fatal(`Unexpected argument: ${arg}`);
    }

    i++;
  }

  return args;
}

function printUsage(): void {
  log("");
  log(
    `${c.bold}${c.cyan}Synapse${c.reset} — AETHER DSL Compiler`
  );
  log("");
  log(`${c.bold}USAGE${c.reset}`);
  log(`  bun run dsl/cli.ts <input.syn> [options]`);
  log("");
  log(`${c.bold}OPTIONS${c.reset}`);
  log(`  -o, --output <dir>     Output directory   ${c.dim}(default: ./out)${c.reset}`);
  log(`  -f, --format <fmt>     Output format: json | md | both  ${c.dim}(default: both)${c.reset}`);
  log(`  -h, --help             Show this help message`);
  log("");
  log(`${c.bold}EXAMPLES${c.reset}`);
  log(`  bun run dsl/cli.ts agents.syn`);
  log(`  bun run dsl/cli.ts agents.syn --output ./agents --format md`);
  log(`  bun run dsl/cli.ts system.syn -o .aether/compiled -f json`);
  log("");
}

// ───────────────── Stats ─────────────────

function countNodeTypes(nodes: ASTNode[]): Record<string, number> {
  const counts: Record<string, number> = { agent: 0, workflow: 0, pipeline: 0 };
  for (const n of nodes) counts[n.type]++;
  return counts;
}

// ───────────────── Main ─────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.inputFile) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const inputPath = resolve(args.inputFile);
  const outputDir = resolve(args.outputDir);

  // ── Read source ──
  let source: string;
  try {
    source = await readFile(inputPath, "utf-8");
  } catch {
    fatal(`Could not read file: ${inputPath}`);
  }

  log("");
  log(
    `${c.bold}${c.cyan}⬡ Synapse${c.reset}  compiling ${c.bold}${basename(inputPath)}${c.reset}`
  );
  log(`${"─".repeat(50)}`);

  const t0 = performance.now();

  // ── Lex ──
  let tokens;
  try {
    const lexer = new Lexer(source);
    tokens = lexer.tokenize();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Lexer error: ${msg}`);
  }

  const significantTokens = tokens.filter(
    (t) => t.type !== "NEWLINE" && t.type !== "EOF"
  );
  info("Tokens lexed:", significantTokens.length);

  // ── Parse ──
  let ast: ASTNode[];
  try {
    const parser = new Parser(tokens);
    ast = parser.parse();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Parser error: ${msg}`);
  }

  const counts = countNodeTypes(ast);
  info("Nodes parsed:", ast.length);
  info(
    "  Breakdown:",
    `${counts.agent} agent(s), ${counts.workflow} workflow(s), ${counts.pipeline} pipeline(s)`
  );

  // ── Transpile ──
  const written: string[] = [];

  try {
    if (args.format === "json" || args.format === "both") {
      // Write JSON files
      const { mkdir, writeFile: wf } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(outputDir, { recursive: true });

      for (const node of ast) {
        switch (node.type) {
          case "agent": {
            const p = join(outputDir, `${node.id}.agent.json`);
            const data = Transpiler.toJSON([node]);
            await wf(p, JSON.stringify(data[0], null, 2), "utf-8");
            written.push(p);
            break;
          }
          case "workflow": {
            const p = join(outputDir, `${node.id}.workflow.json`);
            const data = Transpiler.toJSON([node]);
            await wf(p, JSON.stringify(data[0], null, 2), "utf-8");
            written.push(p);
            break;
          }
          case "pipeline": {
            const p = join(outputDir, `${node.id}.pipeline.json`);
            const data = Transpiler.toJSON([node]);
            await wf(p, JSON.stringify(data[0], null, 2), "utf-8");
            written.push(p);
            break;
          }
        }
      }
    }

    if (args.format === "md" || args.format === "both") {
      // Write .agent.md files (only for agent nodes)
      const { mkdir, writeFile: wf } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(outputDir, { recursive: true });

      for (const node of ast) {
        if (node.type === "agent") {
          const p = join(outputDir, `${node.id}.agent.md`);
          await wf(p, Transpiler.toAgentFile(node), "utf-8");
          written.push(p);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Transpiler error: ${msg}`);
  }

  const elapsed = (performance.now() - t0).toFixed(1);

  log(`${"─".repeat(50)}`);
  info("Files written:", written.length);
  for (const f of written) {
    log(`  ${c.green}→${c.reset} ${f}`);
  }
  info("Time:", `${elapsed}ms`);
  log("");
  success("Compilation complete");
  log("");
}

main().catch((err) => {
  fatal(err instanceof Error ? err.message : String(err));
});
