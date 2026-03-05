# AETHER

**Autonomous Agent Orchestration Framework**

AETHER is a multi-agent LLM orchestration framework built on Bun. It coordinates a 3-tier agent hierarchy (Master/Manager/Worker) across 28 subsystems — including context-aware routing, pre/post LLM guardrails, durable workflows with checkpoint/resume, a typed Agent Communication Protocol, entity-level knowledge accumulation, and a plugin system with 8 lifecycle hooks. Agents are defined as `.agent.md` files and can be backed by any LLM provider (Claude, OpenAI, Gemini, Ollama). All state persists in a single SQLite database (19 tables, WAL mode, sqlite-vec + FTS5).

## Quick Start

```bash
# Install dependencies
bun install

# Initialize in your project
bun run dev -- init

# Run a task
bun run dev -- run "explain the project structure"

# Start the WebSocket server
bun run dev -- link

# View registered agents
bun run dev -- registry

# Check status
bun run dev -- status
```

## Architecture

```
                    +─────────────+
                    |  cortex-0   |  Master
                    |  (Opus)     |
                    +──────┬──────+
                           |
              +────────────┼────────────+
              |            |            |
        +─────┴─────+ +───┴───+ +──────┴─────+
        |  manager   | | mgr-2 | |  manager   |  Managers
        |  (Sonnet)  | |       | |  (Sonnet)  |
        +─────┬──────+ +───┬───+ +──────┬─────+
              |            |            |
         +────┴────+   +──┴──+   +─────┴────+
         | workers  |  | ... |   | workers   |    Workers
         | (Haiku)  |  |     |   | (Flash)   |
         +-────────+   +─────+   +──────────+
```

**Tiers:**

- **Master** — Strategic oversight, final escalation target
- **Manager** — Domain coordination, sub-task delegation
- **Worker** — Specialized task execution

**Key Subsystems:**

- **Registry** — Agent discovery and multi-index capability lookup
- **Escalation** — Circuit-breaker-protected escalation chains
- **MemoryHighway** — Pub/sub messaging with persistent history and automatic RAG indexing
- **RAGIndex** — SQLite-vec + FTS5 hybrid search across 6 namespaces
- **InteractionNet** — Graph-based parallel task execution (interaction combinators)
- **Aether-Link** — WebSocket server with BAP-02 binary protocol
- **AgentRouter** — 6-strategy context-aware routing with confidence scoring
- **GuardrailsPipeline** — Pre/post LLM safety filters (injection, PII, code safety)
- **SchemaValidator** — Structured output validation with correction-prompt retry
- **ConversationManager** — Multi-turn conversation tracking with checkpoint/resume
- **EntityMemory** — Entity-level knowledge accumulation across sessions
- **HandoffManager** — Horizontal peer-to-peer agent transfer with cycle detection
- **GroupChat** — Multi-agent round-table discussions with pluggable speaker selection
- **StateGraph** — Conditional-edge state machines with reflection loops
- **ProgressTracker** — Stall, loop, and budget exhaustion detection
- **DurableWorkflow** — Checkpoint/resume workflows that survive crashes
- **ACPBus** — Typed message envelopes, request-response, dead-letter queue
- **ConflictResolver** — Multi-output contradiction detection and resolution
- **SharedStateBus** — Observable immutable state with versioned transitions
- **StructuredLogger** — JSON logging, scoped context, LLM call instrumentation
- **PluginRegistry** — 8 lifecycle hook slots for external extensions
- **ReactionEngine** — Event-driven autonomous workflow triggers
- **SettingsManager** — Unified settings with 13 configurable subsystem groups

## Agent Authoring

Create `.agent.md` files in `agents/`, `.aether/agents/`, or `.github/agents/`:

```markdown
---
id: react-specialist
name: React Specialist
tier: worker
sections: [FRONTEND]
capabilities: [react, typescript, component-design]
dependencies: [tailwind]
llmRequirement: sonnet
format: markdown
escalationTarget: frontend-manager
---

# React Specialist

You are a React specialist agent. You build high-quality React
components using TypeScript and modern patterns...
```

**Supported metadata formats:** YAML frontmatter, key-value pairs, XML tags, or auto-infer from filename.

## Configuration

After `aether init`, configuration lives in two files:

**`.aether/config.json`** — Auto-generated workspace config (not intended for manual editing):

```json
{
  "version": "0.2.0",
  "workspace": { ... },
  "providers": {
    "master": { "provider": "gemini", "model": "gemini-pro" },
    "manager": { "provider": "gemini", "model": "gemini-pro" },
    "worker": { "provider": "gemini", "model": "gemini-flash" },
    "fallbackChain": []
  },
  "server": {
    "port": 9999,
    "host": "localhost",
    "authToken": "..."
  },
  "logging": { "level": "info", "file": "..." }
}
```

**`.aether/settings.json`** — User-editable tuning knobs for all 28 subsystems:

```json
{
  "methodology": { "mode": "tdd", "testCommand": "bun test" },
  "agents": { "maxConcurrent": 10 },
  "execution": { "maxDepth": 3, "temperature": 0.7, "maxTokens": 4096 },
  "escalation": { "threshold": 3, "windowMs": 300000 },
  "routing": { "confidenceThreshold": 0.6 },
  "progress": { "maxTokenBudget": 500000, "stallThresholdMs": 60000 },
  "server": { "port": 9999, "host": "localhost" }
}
```

Manage settings via the CLI: `aether config get execution.maxDepth`, `aether config set execution.maxDepth 5`.

## CLI Reference

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `aether init`       | Scan workspace, create `.aether/` config |
| `aether run <task>` | Execute a task with an AI agent          |
| `aether link`       | Start the Aether-Link WebSocket server   |
| `aether status`     | Show runtime and server status           |
| `aether registry`   | List all registered agents               |
| `aether spawn <id>` | Activate a specific agent                |
| `aether config`     | View and manage settings                 |
| `aether scan`       | Scan workspace and display tech stack    |

**Config sub-commands:**

| Sub-command                     | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `aether config`                 | Show all current settings                     |
| `aether config get <path>`      | Get a specific setting (dot-path)             |
| `aether config set <path> <val>`| Set a specific setting                        |
| `aether config reset [section]` | Reset to defaults (all or specific section)   |
| `aether config edit`            | Open `settings.json` in `$EDITOR`             |
| `aether config validate`        | Validate current settings                     |
| `aether config path`            | Print path to `settings.json`                 |

**Run options:**

- `-p, --provider <name>` — LLM provider (`claude`, `openai`, `gemini`, `ollama`)
- `-m, --model <name>` — Model name or alias
- `-a, --agent <id>` — Target a specific agent

```bash
aether run -p gemini -m gemini-2.0-flash "explain recursion"
aether run -p ollama -m deepseek-r1 "hello world"
aether run -a cortex-0 "decompose this project"
```

## Provider Setup

Set API keys as environment variables:

| Provider         | Environment Variable                |
| ---------------- | ----------------------------------- |
| Google Gemini    | `GOOGLE_AI_KEY` or `GEMINI_API_KEY` |
| Anthropic Claude | `ANTHROPIC_API_KEY`                 |
| OpenAI           | `OPENAI_API_KEY`                    |
| Ollama           | (runs locally, no key needed)       |

AETHER auto-detects available providers on `init` and maps them to agent tiers.

## Synapse DSL

Define workflows in `.syn` files:

```synapse
@workflow data-pipeline
  @trigger on_commit("main")

  step analyze = research-agent("Analyze the PR changes")
  step review  = code-reviewer(analyze.output)
  step report  = report-writer(review.output)

  @output report.output
```

Compile with: `bun run compile -- workflow.syn`

## Storage

AETHER uses a single SQLite database at `.aether/aether.db` (WAL mode) with sqlite-vec for vector embeddings and FTS5 for full-text search. Nineteen tables store all state — agent registry, task history, escalation records, messages, RAG index, conversations, entity knowledge, workflow checkpoints, file ownership rules, progress events, and metrics — persisting across restarts.

## Security

- **WebSocket auth** — Token-based authentication on connection upgrade
- **Origin validation** — Localhost-only by default
- **Rate limiting** — Connection attempt throttling per IP
- **Input validation** — Message size limits, field format validation, timestamp range checks
- **Health endpoints** — `/health` (liveness), `/metrics` (Prometheus format)

## Development

```bash
# Run tests
bun test

# Build for distribution
bun run build

# Type check
bunx tsc --noEmit
```

## License

[BSL-1.1](./LICENSE) — Business Source License 1.1. Converts to MIT after 4 years.
