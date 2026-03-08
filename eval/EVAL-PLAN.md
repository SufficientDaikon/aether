# AETHER Framework — Comprehensive Evaluation Plan

> **Goal:** Treat AETHER as an AI system under evaluation. Test every feature, rate performance, document everything. Zero source code modifications.

---

## BEFORE WE START — What I Need From You

### 1. API Keys (CRITICAL)

The framework routes LLM calls to providers based on agent tier. I need to know which you have:

| Env Variable               | Provider           | Used By                                         | Do you have it? |
| -------------------------- | ------------------ | ----------------------------------------------- | --------------- |
| `ANTHROPIC_API_KEY`        | Claude (Anthropic) | Master (Opus), Manager (Sonnet), Worker (Haiku) | **?**           |
| `OPENAI_API_KEY`           | OpenAI             | Fallback for all tiers (GPT-4o / GPT-4o-mini)   | **?**           |
| `GOOGLE_AI_KEY`            | Google Gemini      | Fallback (gemini-1.5-pro / flash)               | **?**           |
| Ollama running on `:11434` | Ollama (local)     | Fallback (llama3.2)                             | **?**           |

- **Minimum:** At least ONE provider must be available for Phases 5-6 (live LLM tests)
- **Ideal:** Anthropic key (primary) + one fallback
- Phases 1-4 do NOT require API keys (all synthetic/unit tests)

### 2. Budget / Cost Limits

Phase 5 and 6 make real LLM API calls. Rough cost estimate:

- Phase 5 (10 functional tests): ~$2-5 with Claude, ~$1-3 with GPT-4o
- Phase 6 (stress tests): ~$5-15 depending on scale

**Should I:**

- Run everything freely?
- Cap at a specific dollar amount?
- Prefer cheaper models (Haiku/Flash) where possible?
- Skip live LLM tests entirely and only test infrastructure?

### 3. Folder Naming

There's already a `tests/` folder with 17 existing test files. I recommend:

- Create **`eval/`** for all evaluation scripts and reports (keeps things clean)
- Leave existing `tests/` untouched

Is `eval/` OK, or do you want a different name?

### 4. Ollama (Optional but Free)

If you have Ollama installed, I can run all live tests against local models at zero cost. Want me to use Ollama as primary for cost savings?

---

## Evaluation Structure

```
eval/
├── phase1-baseline/           # Environment & existing test results
│   ├── setup-check.ts         # Verify Bun, deps, init
│   └── REPORT.md
├── phase2-subsystems/         # 28 subsystem unit tests
│   ├── 01-storage.test.ts
│   ├── 02-registry.test.ts
│   ├── 03-interaction-net.test.ts
│   ├── ... (one per subsystem)
│   ├── 28-structured-logger.test.ts
│   └── REPORT.md
├── phase3-protocol/           # Protocol, transport, server tests
│   ├── 01-bap02-codec.test.ts
│   ├── 02-websocket-server.test.ts
│   ├── 03-mcp-server.test.ts
│   ├── 04-transports.test.ts
│   └── REPORT.md
├── phase4-dsl/                # Synapse DSL compilation tests
│   ├── 01-lexer.test.ts
│   ├── 02-parser.test.ts
│   ├── 03-transpiler.test.ts
│   ├── 04-complex-workflows.test.ts
│   └── REPORT.md
├── phase5-functional/         # Live end-to-end tests (needs API keys)
│   ├── 01-trivial-task.ts
│   ├── 02-agent-routing.ts
│   ├── 03-multi-step.ts
│   ├── 04-full-hierarchy.ts
│   ├── 05-parallel-pipeline.ts
│   ├── 06-multi-provider.ts
│   ├── 07-escalation-chain.ts
│   ├── 08-group-chat.ts
│   ├── 09-durable-workflow.ts
│   ├── 10-full-stack-generation.ts
│   └── REPORT.md
├── phase6-stress/             # Load & stress tests
│   ├── 01-message-throughput.ts
│   ├── 02-concurrent-tasks.ts
│   ├── 03-large-payloads.ts
│   ├── 04-deep-recursion.ts
│   ├── 05-circuit-breaker-load.ts
│   ├── 06-worker-pool-spike.ts
│   ├── 07-rag-at-scale.ts
│   ├── 08-websocket-saturation.ts
│   └── REPORT.md
├── phase7-feature-matrix/     # Coverage & rating analysis
│   └── REPORT.md
└── FINAL-REPORT.md            # Master report with all ratings
```

---

## Phase 1: Environment & Baseline

**API Keys Required:** None
**Estimated Time:** 5 minutes
**Purpose:** Verify the framework can boot, and establish baseline test results.

| #   | Test                                                        | What it checks                         |
| --- | ----------------------------------------------------------- | -------------------------------------- |
| 1.1 | Verify Bun >= 1.1.0 installed                               | Runtime prerequisite                   |
| 1.2 | Verify dependencies (`node_modules/msgpackr`, `sqlite-vec`) | Package integrity                      |
| 1.3 | Run `aether scan`                                           | Workspace detection works              |
| 1.4 | Run `aether init`                                           | Config generation, `.aether/` creation |
| 1.5 | Run `aether status`                                         | Runtime boot sequence                  |
| 1.6 | Run `aether registry`                                       | Agent discovery from `.agent.md` files |
| 1.7 | Run all existing unit tests (`bun test`)                    | Baseline pass/fail counts              |
| 1.8 | Run existing `tests/simulation.ts`                          | Full system simulation                 |
| 1.9 | Run existing `tests/e2e-executor.ts`                        | E2E executor test                      |

**Deliverable:** `eval/phase1-baseline/REPORT.md` with pass/fail for each, timing, and any errors.

---

## Phase 2: Subsystem Unit Testing (28 Subsystems)

**API Keys Required:** None (all synthetic data, mocked providers)
**Estimated Time:** 30-60 minutes
**Purpose:** Verify every subsystem works correctly in isolation.

Each test creates instances directly, feeds synthetic data, and validates behavior.

| #    | Subsystem                | File                      | Key Tests                                                                                                                                                                                                 |
| ---- | ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | **SQLite Store**         | `storage/sqlite-store.ts` | Agent CRUD, Task CRUD, KV with TTL, FTS5 search, vector insert/query (384-dim), content dedup, counters, namespace validation                                                                             |
| 2.2  | **Agent Registry**       | `registry.ts`             | Register/unregister, section/capability/tier indexing, fuzzy matching, composite query, resolve (prefers idle), escalation chain walk, cycle guard, status callbacks                                      |
| 2.3  | **Interaction Net**      | `interaction-net.ts`      | Node/wire CRUD, port connections, active pair detection, pair claiming (concurrency), checkpoint/restore, factory methods (DAG, pipeline, fan-out), normal form detection                                 |
| 2.4  | **Net Scheduler**        | `net-scheduler.ts`        | All 10 reduction rules individually, run-to-completion, concurrent reductions, GC sweep, metrics, effects collection                                                                                      |
| 2.5  | **Worker Pool**          | `worker-pool.ts`          | Start/stop, task submission, priority ordering, elastic scaling (up on load, down on idle), timeout, retry, batch submit, stuck task detection                                                            |
| 2.6  | **Memory Highway**       | `memory-highway.ts`       | Pub/sub delivery, channel isolation, wildcard subscribers, subscribeOnce, broadcast, deduplication (FNV-1a), KV CRUD with TTL, recall search, threading (correlationId), ring buffer, metrics             |
| 2.7  | **RAG Index**            | `rag-index.ts`            | Initialize/shutdown, index single/batch, hybrid query (vector + BM25), namespace isolation, boost multipliers, metadata filtering, min score threshold, findSimilar, delete, metrics                      |
| 2.8  | **RAG Meta Index**       | `rag-meta-index.ts`       | 3-tier cache (hot → bloom → full), TTL expiry, cache hit rate, fallback behavior                                                                                                                          |
| 2.9  | **Embedder**             | `embedder.ts`             | Text embedding (384-dim output), caching, normalization                                                                                                                                                   |
| 2.10 | **Escalation Manager**   | `escalation.ts`           | Escalation recording, circuit breaker trip/auto-reset/manual-reset, tier gate policies (master needs P4+), chain walking, store persistence, stats, pruning                                               |
| 2.11 | **Guardrails Pipeline**  | `guardrails.ts`           | Each pre-guard (injection 7 patterns, length, sensitive data 6 patterns), each post-guard (code safety 6 patterns, output length), pipeline chaining, blocking vs modification, guard removal             |
| 2.12 | **Conversation Manager** | `conversation.ts`         | Create, add messages, auto-trim, get history, clean history (Microsoft-style), checkpoint/restore round-trip, status management, formatForPrompt                                                          |
| 2.13 | **Entity Memory**        | `entity-memory.ts`        | Extract entities (files, modules, APIs, configs), process task output, entity context formatting, CRUD, fact extraction, type/name search                                                                 |
| 2.14 | **Handoff Manager**      | `handoff.ts`              | Successful handoff, target validation (missing, offline), cycle detection, chain length enforcement, parse handoff from LLM output, conversation context, history trimming                                |
| 2.15 | **State Graph**          | `state-graph.ts`          | Graph construction, compile validation, sequential execution, conditional branching, cycle with max iterations, trace generation, unreachable node detection                                              |
| 2.16 | **Workflow Builder**     | `workflow-builder.ts`     | Sequential/parallel/handoff/conditional/aggregate, dependency tracking, cycle detection (Kahn's), entry/exit step identification, describe(), factory functions                                           |
| 2.17 | **Durable Workflow**     | `durable.ts`              | Run with checkpointing, resume from checkpoint, pause/abort, topological sort, approval gates, dependency validation, incomplete workflow discovery                                                       |
| 2.18 | **Conflict Resolution**  | `conflict-resolution.ts`  | Agreement detection, contradiction detection, unique contributions, each strategy (majority-vote, weighted-by-tier, weighted-by-confidence, merge), similarity calc, topic grouping                       |
| 2.19 | **Progress Tracker**     | `progress-tracker.ts`     | Event tracking, stall detection (time threshold), loop detection (hash similarity), budget checking (tokens + wall clock), abort recommendation, budget estimation, summary                               |
| 2.20 | **ACP Bus**              | `acp.ts`                  | Send/receive, request-response with timeout, ack tracking, dead-letter queue, schema validation, comm graph, agent/type subscriptions, retry dead letters                                                 |
| 2.21 | **Shared State Bus**     | `shared-state.ts`         | Session CRUD, immutable transitions, version incrementing, edge recording, adjacency list, transition history, KV persistence, MemoryHighway notifications, cleanup                                       |
| 2.22 | **Plugin System**        | `plugin.ts`               | Register/unregister with init/destroy, all 8 hook slots, execution order, abort propagation, error handling, plugin introspection                                                                         |
| 2.23 | **Reaction Engine**      | `reaction-engine.ts`      | Rule matching, channel wildcards, condition compilation (dot-notation), cooldown enforcement, max-fire limits, action handler invocation, reaction log                                                    |
| 2.24 | **Tier Registry**        | `tier-registry.ts`        | Register/unregister, rank ordering, escalation gate policies (open/priority/tier-only), hierarchy queries, capability queries, validation (4 checks), serialization round-trip, builtin/classic factories |
| 2.25 | **Agent Forge**          | `forge.ts`                | Agent spawning (file generation + register), tier validation, max agent enforcement, retirement with sentinel protection, ephemeral tracking, needs analysis, contribution scoring                        |
| 2.26 | **System Sentinel**      | `sentinel.ts`             | Health scoring 0-100, stuck agent detection, utilization calc, constitutional rule evaluation, force kill, swarm pause/resume, dual ledger ops, health check recommendations                              |
| 2.27 | **Preflight Checker**    | `preflight.ts`            | Agent health classification, capability gap detection, dependency validation (missing, self-dep), budget estimation with warnings, empty workflow detection                                               |
| 2.28 | **Settings Manager**     | `settings.ts`             | Load/save round-trip, deep merge, dot-path get/set, 30+ validation rules, section reset, test command detection, tier format migration                                                                    |

**Scoring per subsystem:**

- **Correctness** (0-10): Do all operations produce expected results?
- **Error Handling** (0-10): Does it fail gracefully on bad input?
- **Edge Cases** (0-10): Boundary conditions, empty inputs, overflows?

**Deliverable:** `eval/phase2-subsystems/REPORT.md` with per-subsystem scorecard.

---

## Phase 3: Protocol & Transport Testing

**API Keys Required:** None for codec/server tests; Ollama or API key for transport live tests
**Estimated Time:** 15-30 minutes

| #   | Component            | Key Tests                                                                                                                                                                                                                                           |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **BAP-02 Codec**     | Encode/decode roundtrip, Unicode payloads, large messages (1MB+), legacy BAP-01 backward compat, validation rules (all 8), compression efficiency measurement, magic header verification                                                            |
| 3.2 | **WebSocket Server** | Start on port 9999, HTTP endpoints (/health, /metrics, /status, /registry), WebSocket connect/disconnect, agent registration, point-to-point routing, broadcast, channel pub/sub, heartbeat timeout, rate limiting (>10 conn/IP), origin validation |
| 3.3 | **WebSocket Client** | Connect, auto-reconnect (exponential backoff), heartbeat send, request-response (correlationId), timeout handling, message type handlers                                                                                                            |
| 3.4 | **MCP Server**       | Start on port 3001, tool listing, tool calls (submit_task, query_agents, search_memory, get_status, switch_context, get_config), resource reads (aether://agents, aether://metrics, aether://settings), session management                          |
| 3.5 | **Transports**       | API transport (mock HTTP endpoint), CLI transport (mock subprocess), MCP transport (mock JSON-RPC), Federation transport (connect to local server), Transport Manager routing                                                                       |

**Deliverable:** `eval/phase3-protocol/REPORT.md`

---

## Phase 4: DSL Compilation Testing

**API Keys Required:** None
**Estimated Time:** 10-15 minutes

| #   | Component             | Key Tests                                                                                                                                |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **Lexer**             | All 15 token types, comments, escape sequences, multiline prompt blocks, hyphenated keywords, error positions                            |
| 4.2 | **Parser**            | Agent definitions (all fields), workflows (steps with dependencies), pipelines (parallel + then), handlers (when blocks), error recovery |
| 4.3 | **Transpiler**        | Agent → JSON output, Agent → Markdown output, Workflow → JSON, Pipeline → JSON, BAP registration messages, LLM tier mapping              |
| 4.4 | **Complex Scenarios** | Multi-agent file with all construct types, deeply nested pipelines, conditional workflows, cross-references                              |
| 4.5 | **Error Handling**    | Malformed input, missing required fields, invalid keywords, unclosed blocks, empty files                                                 |

**Deliverable:** `eval/phase4-dsl/REPORT.md`

---

## Phase 5: End-to-End Functional Testing (LIVE LLM)

**API Keys Required:** YES — at least one provider
**Estimated Time:** 30-60 minutes (depends on API latency)
**Purpose:** Actually USE the system to generate real outputs. Rate quality.

| #    | Test                          | Complexity | What it Exercises                                                                                                                                    |
| ---- | ----------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | **Trivial Task**              | ★☆☆☆☆      | `aether run "What is 2+2?"` — Routing to general worker, basic LLM call, response formatting                                                         |
| 5.2  | **Specific Agent Routing**    | ★★☆☆☆      | `aether run -a react-specialist "Create a React counter component"` — Direct agent targeting, code generation quality                                |
| 5.3  | **Capability-Based Routing**  | ★★☆☆☆      | `aether run "Design a PostgreSQL schema for a blog"` — Router should pick postgres-db-architect via capability matching                              |
| 5.4  | **Section-Based Routing**     | ★★★☆☆      | `aether run "Find security vulnerabilities in this code: [sample]"` — Should route to SECURITY section agents                                        |
| 5.5  | **Multi-Provider Comparison** | ★★★☆☆      | Same task sent to Claude, OpenAI, Gemini (if available) — Compare output quality, speed, cost                                                        |
| 5.6  | **RAG-Enriched Task**         | ★★★☆☆      | Index documents first, then run a task that requires context — Verify RAG retrieval improves output                                                  |
| 5.7  | **Escalation Chain**          | ★★★★☆      | Submit a task designed to fail at worker level — Verify escalation to manager, then to master                                                        |
| 5.8  | **Parallel Pipeline**         | ★★★★☆      | "Build a landing page" decomposed into parallel frontend + backend + copy tasks — InteractionNet fan-out                                             |
| 5.9  | **Durable Workflow**          | ★★★★☆      | Multi-step workflow with checkpoint — Kill mid-execution, resume, verify continuity                                                                  |
| 5.10 | **Full Stack Generation**     | ★★★★★      | "Build a complete todo app with React frontend, Bun API, and SQLite database" — Full hierarchy: CORTEX-0 → managers → workers, delegation, synthesis |

**Scoring per test:**

- **Routing Accuracy** (0-10): Did it pick the right agent(s)?
- **Output Quality** (0-10): Is the generated content correct and useful?
- **Speed** (measured in ms): Time from submission to completion
- **Token Efficiency** (tokens/quality): Cost per unit of useful output
- **Error Recovery** (0-10): How well did it handle failures?

**Deliverable:** `eval/phase5-functional/REPORT.md` with full output samples and ratings.

---

## Phase 6: Stress Testing

**API Keys Required:** Partial (some tests are infrastructure-only)
**Estimated Time:** 20-40 minutes

| #   | Test                           | Target                  | What We Measure                                                                           |
| --- | ------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| 6.1 | **Message Bus Throughput**     | MemoryHighway           | Publish 10,000 messages → measure messages/sec, dedup rate, memory usage                  |
| 6.2 | **Concurrent Task Submission** | Executor + WorkerPool   | Submit 50 tasks simultaneously → measure completion time, ordering, failures              |
| 6.3 | **Large Payloads**             | Codec + Highway + Store | 100KB, 500KB, 1MB messages → measure encode/decode time, storage overhead                 |
| 6.4 | **Deep Recursion**             | Executor depth limiting | Tasks spawning sub-tasks to max depth → verify depth guard, no stack overflow             |
| 6.5 | **Circuit Breaker Under Load** | EscalationManager       | Rapid-fire failures from 20 agents → verify circuit breaks, not cascading                 |
| 6.6 | **Worker Pool Elasticity**     | WorkerPool              | Spike from 0 to 100 tasks → measure scale-up time, scale-down time, task stealing         |
| 6.7 | **RAG at Scale**               | RAGIndex + Embedder     | Index 1,000+ documents → measure index time, query latency, accuracy at scale             |
| 6.8 | **WebSocket Saturation**       | Protocol server         | 50+ simultaneous WebSocket connections → measure throughput, dropped messages, reconnects |

**Scoring per test:**

- **Throughput** (ops/sec)
- **Latency** (p50, p95, p99)
- **Stability** (crash/hang/leak detection)
- **Graceful Degradation** (does it fail cleanly?)

**Deliverable:** `eval/phase6-stress/REPORT.md` with benchmark tables and charts.

---

## Phase 7: Final Analysis & Report

**Purpose:** Synthesize all results into a master evaluation.

### Feature Coverage Matrix

Every feature from ARCHITECTURE.md mapped to test results:

| Feature                | Tested?             | Pass? | Score | Notes |
| ---------------------- | ------------------- | ----- | ----- | ----- |
| 3-tier hierarchy       | Phase 2.2, 5.10     | ?     | ?/10  | ...   |
| 19-table SQLite store  | Phase 2.1           | ?     | ?/10  | ...   |
| RAG hybrid search      | Phase 2.7, 5.6, 6.7 | ?     | ?/10  | ...   |
| ... (all 28+ features) | ...                 | ...   | ...   | ...   |

### Rating Dimensions

| Dimension                       | Score | Notes                                       |
| ------------------------------- | ----- | ------------------------------------------- |
| **Correctness**                 | ?/10  | Do subsystems produce correct results?      |
| **Reliability**                 | ?/10  | Does it handle failures gracefully?         |
| **Performance**                 | ?/10  | Speed and throughput under load             |
| **Scalability**                 | ?/10  | Behavior as load increases                  |
| **Code Quality**                | ?/10  | Architecture, separation of concerns, types |
| **Feature Completeness**        | ?/10  | Do all claimed features actually work?      |
| **Developer Experience**        | ?/10  | CLI UX, error messages, documentation       |
| **LLM Output Quality**          | ?/10  | Quality of generated content across tasks   |
| **Cost Efficiency**             | ?/10  | Token usage vs output quality               |
| **Self-Improvement Capability** | ?/10  | Forge spawning, learning, adaptation        |

### Bug Inventory

Every issue found during testing, with:

- Severity (Critical / Major / Minor / Cosmetic)
- Reproduction steps
- Subsystem affected
- Suggested fix (without implementing)

### Architecture Assessment

- What's well-designed?
- What's over-engineered?
- What's missing?
- What would break at production scale?

**Deliverable:** `eval/FINAL-REPORT.md`

---

## Execution Order

```
Phase 1  (5 min)   ──► Baseline — can I even boot the system?
Phase 2  (45 min)  ──► Unit tests — does each piece work alone?
Phase 4  (15 min)  ──► DSL — does the language compile?
Phase 3  (20 min)  ──► Protocol — do agents communicate?
Phase 5  (45 min)  ──► Functional — does it actually DO things? (needs API keys)
Phase 6  (30 min)  ──► Stress — how far can we push it?
Phase 7  (20 min)  ──► Report — synthesize everything
                   ────────────────────────────
                   ~3 hours total
```

Phases 1-4 can run WITHOUT any API keys.
Phases 5-6 REQUIRE at least one LLM provider.

---

## Rules I Will Follow

1. **ZERO source code modifications** — I will not edit any file under `core/`, `providers/`, `protocol/`, `dsl/`, `agents/`, `bin/`, `nexus/`, `transports/`, or `tests/`
2. All eval scripts go in `eval/` (new directory)
3. Every test produces structured JSON logs + human-readable markdown
4. Failed tests are documented, not skipped
5. All LLM API calls and their costs are logged
6. Reports include raw output samples for manual review
