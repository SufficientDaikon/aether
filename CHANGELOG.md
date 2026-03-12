# Changelog

All notable changes to AETHER will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Notice

- **Development paused** — Project is on hold while the future direction is being reconsidered. Expect to resume in ~1 week.

## [0.2.0] — 2026-03-08

### Added

- **SQLite persistence** — 19-table database (`.aether/aether.db`) with WAL mode, sqlite-vec for vector embeddings, and FTS5 for full-text search. All runtime state persists across restarts.
- **28 subsystems** — Registry, Escalation, MemoryHighway, RAGIndex, InteractionNet, Aether-Link, AgentRouter, GuardrailsPipeline, SchemaValidator, ConversationManager, EntityMemory, HandoffManager, GroupChat, StateGraph, ProgressTracker, DurableWorkflow, ACPBus, ConflictResolver, SharedStateBus, StructuredLogger, PluginRegistry, ReactionEngine, SettingsManager, and more.
- **Synapse DSL** — Define workflows in `.syn` files with lexer, parser, and transpiler.
- **MCP server** — Model Context Protocol server for AI assistant integration with 6 tools and 4 resources.
- **VS Code extension** — Language support and integration (aether-vscode v0.1.0).
- **Eval suite** — 17-phase evaluation framework covering subsystems, protocol, DSL, integration, quality, and production readiness.
- **726 tests** across 101 test files with full coverage of core subsystems.
- **Multi-provider support** — Claude, OpenAI, Gemini, and Ollama with automatic tier mapping and fallback chains.
- **CI/CD** — GitHub Actions for type checking, unit tests, npm publishing, and VS Code extension builds.

### Fixed

- **Rate limiter** now accepts configurable `rateLimitMax` and `rateLimitWindow` via constructor options (was hardcoded at 100).
- **CLITransport** tests now work cross-platform (Windows + Unix).
- **35 TypeScript errors** resolved across core modules:
  - `ProviderConfig` type aligned with `tiers` record structure.
  - `DurableWorkflow` async status checks no longer produce unreachable-code errors.
  - `RAGIndex` metadata spread order fixed (no more duplicate `sourceId`).
  - `AgentRouter.query()` call signature corrected to match 2-arg API.
  - `Embedder` constructor called with required `logger` argument.
  - `SettingsManager` type casts use `unknown` intermediate for safety.
  - `MCPPool` stdio stream type narrowing added.
  - `Forge` agent scoring uses `getRecentTasks()` instead of non-existent `recentTasks` property.
  - Eval test files annotated with explicit types to eliminate implicit `any`.

### Resolved

- **PERSIST-01** — All runtime state now persists in SQLite. Issue closed.

## [0.1.0] — 2026-02-21

### Added

- Initial framework with 3-tier agent hierarchy (Master/Manager/Worker).
- Agent definition via `.agent.md` files with YAML frontmatter.
- CLI with `init`, `run`, `link`, `status`, `registry`, `spawn`, `config`, `scan` commands.
- WebSocket server (Aether-Link) with BAP-02 binary protocol.
- Provider abstraction for Claude, OpenAI, Gemini, Ollama.
- In-memory agent registry, escalation, and task execution.
