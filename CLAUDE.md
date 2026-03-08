# AETHER — Multi-Agent Orchestration Framework

## Quick Start

```bash
bun run bin/aether.ts init                          # Initialize in current workspace
bun run bin/aether.ts run "your task description"    # Route task to best agent
bun run bin/aether.ts status                         # Check runtime status
bun run bin/aether.ts registry                       # List all registered agents
```

## CLI Commands

| Command                   | Description                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `run <task>`              | Execute a task (routes to best-fit agent). Flags: `-p` provider, `-m` model, `-a` agent |
| `init`                    | Scan workspace, create `.aether/` config, discover agents                               |
| `link`                    | Start the Aether-Link WebSocket server (port 9999)                                      |
| `status`                  | Show runtime status (agent counts, server ping)                                         |
| `registry`                | ASCII table of all registered agents with tiers and status                              |
| `spawn <id>`              | Activate a specific agent                                                               |
| `config get <path>`       | Read a config value (e.g., `execution.maxDepth`)                                        |
| `config set <path> <val>` | Update a config value                                                                   |
| `context list`            | List agent namespace contexts                                                           |
| `context switch <name>`   | Switch active context                                                                   |
| `scan`                    | Scan workspace tech stack                                                               |

## Examples

```bash
# Route to specific agent
bun run bin/aether.ts run -a code-reviewer "review the auth module"
bun run bin/aether.ts run -a react-specialist "build a todo list component"
bun run bin/aether.ts run -a system-architect "plan a REST API for user management"

# Use specific model
bun run bin/aether.ts run -p gemini -m gemini-2.5-flash "explain this function"

# Configuration
bun run bin/aether.ts config get execution.maxDepth
bun run bin/aether.ts config set execution.maxDepth 5
```

## Agent Hierarchy (34 agents)

### Master (strategic planning)

- **cortex-0** — Top-level orchestrator, decomposes complex tasks

### Managers (coordination)

- **system-architect** — Backend architecture, API design, system design
- **product-visionary** — Product strategy, feature prioritization
- **cyber-sentinel** — Security oversight, threat assessment
- **marketing-lead** — Marketing strategy, content direction
- **qa-audit-director** — Quality assurance, testing strategy

### Workers (execution)

**Frontend:** react-specialist, ui-designer, ux-psychologist
**Backend:** bun-runtime-master, postgres-db-architect, redis-state-guard
**Security:** code-hardener, dependency-sentinel, threat-architect, vuln-hunter
**Marketing:** copywriter, fomo-logic-engine
**Research:** market-analyst, ragx-indexer
**Tools:** cli-wizard, playwright-tester
**MCP:** mcp-server-creator, skill-logic-generator
**Meta:** agent-breeder, general
**Workflow:** script-automator

### Infrastructure

- **forge-0** — Dynamic agent spawning/retirement
- **sentinel-0** — System health monitoring

## MCP Server

AETHER includes an MCP (Model Context Protocol) server for AI assistant integration:

```bash
bun run bin/aether-mcp.ts --workspace /path/to/project
```

### MCP Tools

- `submit_task` — Route a task to the agent hierarchy
- `query_agents` — Search agents by capability, section, or tier
- `search_memory` — RAG-indexed memory search
- `get_status` — System status (agents, cache, tiers)
- `switch_context` — Change active namespace
- `get_config` — Read settings by dot-path

### MCP Resources

- `aether://agents` — Full agent registry
- `aether://agents/{id}` — Single agent details
- `aether://settings` — All settings
- `aether://metrics` — System metrics

## MCP Configuration

### Claude Code (`~/.claude.json` or project `.mcp.json`)

```json
{
  "mcpServers": {
    "aether": {
      "command": "bun",
      "args": ["run", "H:/aether/bin/aether-mcp.ts", "--workspace", "."],
      "env": {
        "GOOGLE_AI_KEY": "<your-gemini-api-key>"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "aether": {
      "command": "bun",
      "args": [
        "run",
        "H:/aether/bin/aether-mcp.ts",
        "--workspace",
        "H:/aether"
      ],
      "env": {
        "GOOGLE_AI_KEY": "<your-gemini-api-key>"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to your editor's MCP settings — same format as Claude Desktop above.

Once configured, the AI assistant can call `submit_task`, `query_agents`, `search_memory`, `get_status`, `switch_context`, and `get_config` directly.

## Architecture

- **Runtime:** Bun (TypeScript), 28 subsystems
- **Storage:** SQLite with FTS5 full-text search + sqlite-vec for 384-dim vector embeddings
- **Protocol:** BAP-02 binary (MessagePack + Zstd compression) over WebSocket
- **DSL:** Synapse (.syn files) for defining agents, workflows, and pipelines
- **Providers:** Gemini (gemini-2.5-pro for master/manager, gemini-2.5-flash for workers)

## Key Directories

```
agents/          — 34 agent definitions (.agent.md files)
core/            — 28 subsystem modules (runtime, registry, router, rag, etc.)
providers/       — LLM provider abstraction (Gemini, pluggable)
protocol/        — BAP-02 codec, WebSocket server
transports/      — API, CLI, MCP, Federation transports
dsl/             — Synapse DSL lexer, parser, transpiler
nexus/           — MCP HTTP server, client pool
bin/             — CLI (aether.ts) + MCP server (aether-mcp.ts)
eval/            — 7-phase evaluation suite (Grade A, 9.19/10)
aether-vscode/   — VS Code extension (in development)
```
