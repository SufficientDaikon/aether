# AETHER: Architecture & Design Reference

> A deep dive into what AETHER is, how it works, why it was built the way it was, and the reasoning behind every major architectural decision.

---

## Table of Contents

**I. Foundations**

1. [What Is AETHER?](#1-what-is-aether)
2. [The Three-Tier Agent Hierarchy](#2-the-three-tier-agent-hierarchy)
3. [The Storage Layer](#3-the-storage-layer)
4. [The Agent Registry](#4-the-agent-registry)
5. [Task Execution](#5-task-execution)
6. [Escalation & Circuit Breaking](#6-escalation--circuit-breaking)

**II. Communication**

7. [Memory Highway: The Message Bus](#7-memory-highway-the-message-bus)
8. [The RAG System](#8-the-rag-system)
9. [Interaction Nets: Structured Parallelism](#9-interaction-nets-structured-parallelism)
10. [The Binary Protocol (BAP-02)](#10-the-binary-protocol-bap-02)

**III. Providers & DSL**

11. [Providers & Model Routing](#11-providers--model-routing)
12. [Transports: External Agents](#12-transports-external-agents)
13. [The Synapse DSL](#13-the-synapse-dsl)

**IV. Orchestration**

14. [Orchestration Patterns](#14-orchestration-patterns)
15. [Context-Aware Routing](#15-context-aware-routing)
16. [Conversation & Entity Memory](#16-conversation--entity-memory)

**V. Safety & Reliability**

17. [Safety & Validation Pipeline](#17-safety--validation-pipeline)
18. [Progress Tracking](#18-progress-tracking)
19. [Durable Workflows](#19-durable-workflows)

**VI. Infrastructure**

20. [Agent Communication Protocol (ACP)](#20-agent-communication-protocol-acp)
21. [Conflict Resolution](#21-conflict-resolution)
22. [Observability & Structured Logging](#22-observability--structured-logging)
23. [Shared State Bus](#23-shared-state-bus)
24. [Plugin System](#24-plugin-system)
25. [Reaction Engine](#25-reaction-engine)
26. [Settings & Configuration](#26-settings--configuration)

**VII. Decisions & Flow**

27. [Key Architectural Decisions](#27-key-architectural-decisions)
28. [Data Flow: A Request End to End](#28-data-flow-a-request-end-to-end)
29. [What Does Not Exist (And Why)](#29-what-does-not-exist-and-why)

---

## 1. What Is AETHER?

AETHER is a multi-agent LLM orchestration framework. It lets you define a network of AI agents — each with a role, a set of capabilities, and a preferred language model — and then route tasks through that network automatically.

The core idea is that no single LLM call should be responsible for everything. Large, complex tasks get decomposed and delegated down a hierarchy. Failures escalate up it. Agents that are good at something handle only that thing. The framework wires them together.

**What AETHER is not:**

- It is not a prompt-chaining library. Agents are first-class entities with identity, status, and persistent state.
- It is not a cloud service. It runs entirely on your machine (or your server) against whatever LLM APIs you configure.
- It is not a fixed pipeline. The execution graph is dynamic — tasks can spawn sub-tasks, agents can fail and escalate, parallelism is computed at runtime.

**At full operation, AETHER coordinates:**

- Multiple agents with different models (Opus, Sonnet, Haiku, Gemini, Ollama)
- A live WebSocket server for inter-agent communication
- A SQLite database (19 tables) storing all agent state, task history, messages, entities, conversations, and vector embeddings
- A pub/sub message bus indexed semantically in real time
- Parallel task execution modeled as interaction combinator graphs
- A full retrieval-augmented generation (RAG) pipeline for context injection
- Context-aware routing with 6-strategy agent resolution
- Pre/post LLM guardrails, schema validation, and preflight verification
- Durable workflows with checkpoint/resume
- An Agent Communication Protocol (ACP) with typed envelopes, request-response, and dead-letter queues
- Entity-level knowledge accumulation across sessions
- A plugin system with 8 lifecycle hook slots
- A unified settings system with 13 configurable subsystem groups

---

## 2. The Three-Tier Agent Hierarchy

The hierarchy is the backbone of the system. Every agent is one of three tiers:

```
Master (Opus)          ← 1 agent, strategic oversight
   │
   ├── Manager (Sonnet) ← N agents, domain coordination
   │      │
   │      └── Worker (Haiku/Flash) ← M agents, task execution
   │
   └── Manager (Sonnet)
          │
          └── Worker (Haiku)
```

**Worker agents** execute tasks. They are the most numerous and cheapest to run. A worker handles a specific domain: React development, Python scripting, SQL queries, documentation — whatever its `capabilities` array says. Workers have an `escalationTarget` pointing to their manager.

**Manager agents** coordinate workers. They receive complex tasks, decompose them, delegate to workers, and consolidate results. They handle failures from workers. Managers escalate to the master if the situation exceeds their authority.

**The master agent** has strategic oversight. It receives only high-priority or unresolvable escalations. It is expensive (Opus-class model) so it is protected by a circuit breaker that prevents low-priority noise from reaching it.

### Why a fixed three-tier structure?

Because unbounded delegation hierarchies are unpredictable. With three tiers you always know: this problem can be resolved at this level or escalated a known number of hops. The circuit breaker at the master tier enforces this contract even if the hierarchy is misconfigured.

The alternative — flat random routing — loses organizational context. The agent that decomposed a task is the right one to handle its failure, not a random peer with the same capabilities.

### Agent Definition

Agents are defined as `.agent.md` files with YAML frontmatter:

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

You are a React specialist agent. Given a task, you...
```

The body of the file becomes the system prompt. The frontmatter is the machine-readable metadata. This keeps human authoring and programmatic parsing in the same place.

**`sections`** are domain buckets (FRONTEND, BACKEND, TOOLS, etc.) used for coarse routing. **`capabilities`** are fine-grained descriptors used for capability-based resolution. Both are indexed for fast lookup.

---

## 3. The Storage Layer

AETHER uses a single SQLite file at `.aether/aether.db` for everything. Not a cache, not a side-store — the single source of truth for all persistent state.

### Why SQLite?

SQLite is the right choice for a local tool:

- Zero operational overhead. No server to start, no network, no credentials.
- WAL mode gives concurrent reads without blocking writes.
- sqlite-vec extension adds vector similarity search inside the same file.
- FTS5 extension adds full-text search inside the same file.
- All state survives process restarts automatically.

The alternative (in memory + periodic JSON files) was the original approach. The problem: every restart lost agent status, task history, message context, and the entire vector index. The system had no memory across sessions.

### The Schema

Nineteen tables across two schema versions:

**V1 — Core Tables:**

| Table                | Contents                                              |
| -------------------- | ----------------------------------------------------- |
| `agents`             | Agent definitions (id, tier, capabilities, status...) |
| `task_results`       | Every task execution outcome                          |
| `escalation_records` | Per-agent escalation history                          |
| `master_escalation`  | Global escalation counter (singleton)                 |
| `messages`           | MemoryHighway message log                             |
| `kv_store`           | General key-value state with TTL                      |
| `vec_*` (6 tables)   | Vector embeddings per namespace (sqlite-vec)          |
| `fts_*` (6 tables)   | Full-text search indexes per namespace (FTS5)         |
| `tfidf_state`        | TF-IDF corpus snapshot (singleton)                    |
| `net_snapshots`      | InteractionNet graph checkpoint (singleton)           |
| `metrics`            | Named counters and gauges                             |
| `_migrations`        | Schema version tracking                               |

**V2 — Phase 1-9 Tables (added by `migrateV2()`):**

| Table                     | Contents                                              |
| ------------------------- | ----------------------------------------------------- |
| `conversations`           | Multi-turn conversation state (participants, status)  |
| `conversation_messages`   | Messages within conversations (agent, role, content)  |
| `entities`                | Extracted entity definitions (name, type)             |
| `entity_facts`            | Facts accumulated per entity (with confidence score)  |
| `workflow_checkpoints`    | Durable workflow checkpoint state                     |
| `file_ownership`          | File pattern → agent ID routing rules                 |
| `progress_events`         | Workflow step progress records (tokens, duration)     |

### The AetherStore Interface

All subsystems talk to storage through a single interface defined in `core/storage/store.ts`. This matters because:

1. The SQLite implementation can be swapped for Postgres (or anything else) without touching business logic.
2. Tests can inject a mock store.
3. The interface documents exactly what each subsystem needs from persistence.

Every subsystem receives its store via constructor injection — the runtime creates the store, initializes it, and threads it through everything.

### Message Deduplication

Messages use FNV-1a content hashing on `channel + sender + summary`. The `content_hash` column has a `UNIQUE` index. A duplicate `saveMessage()` call does nothing (INSERT OR IGNORE) and the message log stays clean.

---

## 4. The Agent Registry

The registry is an in-memory, multi-indexed lookup structure backed by the SQLite store.

When AETHER starts, it reads all agents from the database into three Maps:

- **`bySection`**: `"FRONTEND" → Set<agent_id>` — for coarse domain routing
- **`byCapability`**: `"react" → Set<agent_id>` — for fine capability matching
- **`byTier`**: `"worker" → Set<agent_id>` — for tier-based queries

All three indexes are maintained in sync during `register()` and `unregister()`. Writes go to the DB synchronously; reads come from the in-memory Maps instantly.

### Capability Resolution

```typescript
registry.resolve("react");
// → picks the idle agent with "react" in capabilities
// → falls back to busy agents if no idle ones exist
// → returns undefined if nothing matches
```

Capability matching is substring-based. Searching for `"react"` matches agents with `"react"`, `"react-components"`, `"react-native"`. This is intentional — agents don't need to exactly predict the search terms a task will use.

### Escalation Chain Walking

```typescript
registry.getEscalationChain("junior-worker");
// → [managerAgent, masterAgent]
```

The registry walks `escalationTarget` links, collecting each agent in order, until it hits `null` or a cycle. Cycle detection uses a visited Set to terminate immediately rather than infinitely loop. A malformed escalation graph degrades to a shorter chain rather than crashing.

---

## 5. Task Execution

The executor is the most complex subsystem. It takes a task request and produces a result, but the path between those two points involves many decisions.

### The Execution Decision Tree

When `executor.execute(task)` is called:

1. **Check if agent has external transport** → if so, delegate to TransportManager instead of LLM
2. **Build prompt** → inject system prompt + RAG context + task description
3. **Call LLM** → with timeout enforcement (default 120s)
4. **Parse response** → extract main output, look for sub-task requests
5. **If sub-tasks requested** → spawn them recursively (up to max depth, default 3)
6. **If task fails** → escalate up the hierarchy
7. **Record result** → persist to store, publish to MemoryHighway

### RAG Context Injection

Before calling the LLM, the executor queries the RAG index for relevant context:

```
Task: "Fix the authentication bug in the login flow"
→ RAG query finds: previous login-related task results, auth agent definitions,
                   code snippets about JWT validation, related messages
→ Injects top-3 results as context into the prompt
```

This is why AETHER improves over time — every task execution adds to the knowledge base, which enriches future executions.

### Three Execution Modes

**Sequential workflow**: Tasks run one after another. Each task's output becomes part of the next task's context. Good for dependent pipelines where step 2 needs step 1's result.

**Parallel pipeline**: All tasks launch concurrently with `Promise.allSettled`. Results are collected when all finish. Good for independent tasks that can overlap.

**InteractionNet DAG**: Tasks are nodes in an interaction combinator graph. The NetScheduler reduces this graph to normal form by executing active pairs. This is the most powerful mode — it handles arbitrary dependency graphs, fan-out, fan-in, and cancellation. See [Section 9](#9-interaction-nets-structured-parallelism).

### Sub-task Decomposition

An LLM response can include a structured sub-task request:

```json
{
  "mainOutput": "I've analyzed the requirements...",
  "subTasks": [
    { "description": "Write the React component", "capability": "react" },
    { "description": "Write the API endpoint", "capability": "backend" }
  ]
}
```

The executor spawns these as child tasks (depth + 1), routes them to capable agents, and collects their results. The parent task receives the aggregated output. This allows the manager tier to genuinely delegate rather than simulate delegation inside a single prompt.

---

## 6. Escalation & Circuit Breaking

When a task fails, AETHER does not immediately give up. It walks the escalation chain.

### The Escalation Flow

```
Worker fails
  → escalationManager.escalate(agentId, reason)
    → Check if circuit is broken for this agent
    → If broken: reject (too many recent failures)
    → If open: record failure, find next target in chain
      → Check master gate rules
      → If allowed: return target agent
      → Executor retries task with new agent
```

### Circuit Breaker Parameters

Each agent has its own circuit breaker with a rolling time window. If an agent generates more than `threshold` escalations within `windowMs`, its circuit breaks. Circuit broken means: no more escalations from this agent are accepted until the window resets or a human manually resets it.

Default: 3 escalations in 5 minutes trips the circuit.

### The Master Gate

The master is expensive. Three rules govern access:

1. **Priority ≥ 4**: High-urgency tasks always reach master.
2. **Manager tier escalating**: Managers escalate to master by design (that is the purpose of the chain).
3. **Everyone else**: Blocked.

A worker with a low-priority recurring failure does not spam the master's context window. The master sees only what it needs to see.

The master escalation count is a global singleton counter in the database, incremented atomically on each successful master escalation. This feeds the `/metrics` endpoint for operations monitoring.

### Why Circuit Breakers and Not Just Retry Limits?

Retry limits are per-task. If ten different tasks all fail on the same broken agent and all retry, you get ten separate failure cascades before anyone notices. A circuit breaker is stateful — once it trips on agent `X`, all subsequent tasks immediately know not to route through `X`. The failure is surfaced once, not ten times.

---

## 7. Memory Highway: The Message Bus

The MemoryHighway is the pub/sub nervous system of AETHER. Every subsystem that produces or consumes events goes through it.

### The Channel Model

Messages are published to named channels:

- `tasks` — task requests and assignments
- `results` — task completion results
- `escalations` — escalation events
- `events` — system lifecycle events
- `*` (wildcard) — receives all messages on all channels

Handlers register for a channel:

```typescript
highway.subscribe("results", (msg) => {
  // called every time a task result lands
});
```

The wildcard subscriber is powerful for auditing and logging — the WebSocket server uses it to forward everything to connected clients.

### Automatic RAG Indexing

Here is the non-obvious part: every message above priority 2 is automatically indexed into the RAG system as it passes through the highway. The summary becomes searchable text. The message metadata (channel, agent, type) becomes filterable.

This means that when the executor queries for context before an LLM call, it is searching not just documents — it is searching the entire conversation history of the system. Previous task results, agent decisions, error messages, status updates — all of it is retrievable semantically.

### Message Deduplication

The highway tracks a sliding window of content hashes (5 seconds by default). If the same logical message arrives twice in quick succession, the second one is dropped. This matters because:

- Agents on a flaky network might send twice
- The WebSocket server might deliver once locally and once via persistence
- Worker tasks emit results that sometimes get double-flushed

The dedup window is short enough that genuinely separate messages with identical content are eventually stored (they must arrive more than 5 seconds apart).

### The KV Store

The highway exposes a key-value interface backed by the SQLite store:

```typescript
await highway.set("last-deploy-hash", commitHash, 3600_000); // 1hr TTL
const hash = await highway.get("last-deploy-hash");
```

This is for shared mutable state that agents need to coordinate on. TTLs prevent unbounded accumulation. Keys are scoped globally (not per-channel), so multiple agents can share a namespace implicitly.

---

## 8. The RAG System

Retrieval-Augmented Generation means injecting relevant context into a prompt before the LLM call. AETHER's RAG system is why the agents can work on large codebases and complex multi-session projects without losing context.

### Two-Phase Retrieval

Every query runs two lookups and merges the results:

**Phase 1 — Vector search (70% weight):** The query text is embedded into a 384-dimension float vector. sqlite-vec finds the K-nearest neighbors in the embedding space. Similar-meaning text ranks high even if the exact words differ.

**Phase 2 — FTS5 keyword search (30% weight):** The query text is matched against a BM25 full-text index. Exact and stemmed keyword matches rank high. This catches things that are semantically similar but use different terminology (e.g., "authentication" vs. "auth").

The two result sets are merged with weighted scoring:

```
final_score = (0.7 × vector_similarity) + (0.3 × fts_rank)
```

Duplicates are deduplicated by ID after merging. The top-N results go into the prompt.

### Six Namespaces

The vector and FTS5 indexes are partitioned into six namespaces:

| Namespace  | Contains                                            |
| ---------- | --------------------------------------------------- |
| `agents`   | Agent definitions and capabilities                  |
| `code`     | Code snippets, file contents, function signatures   |
| `messages` | MemoryHighway message history                       |
| `docs`     | Documentation, README files, inline comments        |
| `tasks`    | Task descriptions and results                       |
| `meta`     | Configuration, schema descriptions, system metadata |

Queries can target a single namespace or search across all of them. Namespace-specific metadata boosts apply — for example, a master-tier agent definition gets a 1.5× relevance boost over worker-tier agents for the same embedding distance.

### The Embedder

The system uses TF-IDF embedding by default — no API key required, zero latency, deterministic output.

**How TF-IDF embedding works here:**

1. Tokenize with bigrams (word pairs capture more semantic context than individual words)
2. Compute term frequency in the document
3. Weight by inverse document frequency (common words are down-weighted)
4. Project the resulting sparse vector onto a fixed 384-dimension space via deterministic hash
5. L2-normalize the output

This is not as high-quality as OpenAI's `text-embedding-3-small`, but it is good enough for agent capability matching and task context retrieval, requires no API calls, and produces stable identical vectors for identical inputs.

When `OPENAI_API_KEY` is available, the embedder switches to API embeddings automatically and caches the results in the KV store.

---

## 9. Interaction Nets: Structured Parallelism

This is the most theoretically interesting part of AETHER.

### The Problem with Ad-Hoc Parallelism

Spawning goroutines or promises and hoping they do not deadlock is brittle. The more complex the dependency graph, the harder it is to reason about. Standard approaches use locks, semaphores, or queues — all of which require the programmer to manually reason about correctness.

### Interaction Combinators

AETHER uses a model from theoretical computer science: **interaction combinators**, introduced by Yves Lafont in 1997. The key property is **strong confluence**: no matter what order you reduce an interaction net, you always get the same result. This makes deadlock structurally impossible.

### The Three Combinators

Every computation is expressed with three node types:

**Constructor (γ):** Takes two inputs, produces one output. In AETHER, a constructor node joins/merges the results of two sub-tasks. The merge strategy is configurable: concatenate, take the first, apply a custom function.

**Duplicator (δ):** Takes one input, produces two outputs. A duplicator node fans a single task out to multiple independent agents. Fanout modes: all (wait for all), race (first to finish wins), quorum (any N of M).

**Eraser (ε):** Cancels a branch. When a duplicator in race mode gets its first result, the losing branches get erased — their resources are released and downstream computations are cancelled.

### Reduction Rules

When two nodes are connected principal-port to principal-port, they form an **active pair** and are ready to reduce. The 11 reduction rules describe what happens when each pair of combinator types interact. For example:

- **Constructor ↔ Constructor**: The pair annihilates. Both nodes are deleted. Their auxiliary ports are cross-wired.
- **Duplicator ↔ Duplicator**: The pair commutes. Each duplicates the other.
- **Constructor ↔ Eraser**: The eraser propagates. Both auxiliary ports of the constructor also get erased.

The NetScheduler scans for active pairs, claims them (marking as "reducing" to prevent double-processing), and executes them concurrently up to a configured limit. After each reduction, new active pairs may emerge, and the loop continues until no active pairs remain — the normal form, which represents the completed computation.

### Why This Instead of async/await DAGs?

With async/await DAGs you describe the dependency graph statically and hope you got it right. Interaction nets let you build the graph dynamically (agents can request fanouts, merges can fail and trigger erasures) and the confluence property guarantees correctness by construction regardless of what the graph ends up looking like.

---

## 10. The Binary Protocol (BAP-02)

AETHER agents communicate over WebSocket using BAP-02: Binary Agent Protocol version 2.

### The Encoding Pipeline

```
AetherMessage (TypeScript object)
  → MessagePack (binary serialization, ~40% smaller than JSON)
  → zstd compression (Bun built-in, ~80% size reduction on typical messages)
  → "BAP02" magic header (5 bytes for version identification)
  → Uint8Array (send over WebSocket)
```

### Why MessagePack + zstd?

JSON is human-readable but wasteful. `{"type":"task","priority":3}` wastes bytes on bracket, colon, and quote characters. MessagePack encodes the same structure in roughly 60% of the space.

zstd then compresses the MessagePack bytes. Typical agent messages contain repetitive strings (capability names, field names, agent IDs) that compress extremely well. A 2KB JSON message encodes to ~200 bytes on the wire.

The codec's `efficiency()` method measures the wire/JSON size ratio so you can verify the compression is working.

### Validation

The codec validates every message on decode:

- Required fields must be present (`id`, `from`, `to`, `type`, `priority`, `timestamp`)
- `priority` must be integer 1–5
- `timestamp` must be within 30 days past and 1 hour future
- `from` and `to` must be alphanumeric+hyphens, max 128 characters
- Decompressed payload must not exceed 4MB

These rules prevent malformed messages from propagating into the bus, and the timestamp range prevents replay attacks.

### Backward Compatibility

BAP-01 (the original protocol) encoded messages as hex strings. The decoder detects a hex string input and handles it as BAP-01. This allows old clients to continue working without forcing a synchronized upgrade.

---

## 11. Providers & Model Routing

AETHER abstracts over LLM providers. The same task execution code works whether the agent is backed by Claude, GPT-4, Gemini, or a local Ollama model.

### Tier-Based Routing

The ProviderManager maps agent tiers to model quality levels:

| Tier    | Default Provider | Default Model     |
| ------- | ---------------- | ----------------- |
| Master  | Claude           | claude-opus-4-5   |
| Manager | Claude           | claude-sonnet-4-6 |
| Worker  | Claude           | claude-haiku-3-5  |

These defaults are overridable in `.aether/config.json`. The model selection can also be overridden per-task.

### The Fallback Chain

If the primary provider fails (rate limit, timeout, API outage), the system walks a fallback chain:

```
Claude → OpenAI → Gemini → Ollama
```

Each entry in the chain is tried in sequence. This means most AETHER deployments continue functioning even if one provider goes down, degrading gracefully to whatever is available.

### Provider Detection

On `aether init`, the system scans for environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_KEY`/`GEMINI_API_KEY`) and automatically configures available providers. The config file is written with the detected setup.

### Ollama Integration

Ollama runs locally and requires no API key. If Ollama is running on localhost, AETHER detects it automatically and uses it as the final fallback. This means AETHER can operate entirely offline if needed (with reduced model quality).

---

## 12. Transports: External Agents

Not every agent needs to be an LLM call. AETHER supports four transport types:

**API transport:** The agent is an HTTP endpoint. AETHER sends a POST request, waits for a response. Useful for agents that are really external microservices with structured APIs. Supports bearer token, API key, and basic auth.

**CLI transport:** The agent is a command-line program. AETHER spawns a subprocess, writes the task to stdin, reads the result from stdout. Useful for wrapping existing tools (linters, test runners, build systems) as agents.

**MCP transport:** The agent implements the Model Context Protocol. AETHER sends an MCP-compatible request. This lets AETHER work with the growing ecosystem of MCP-enabled tools.

**Federation transport:** The agent lives in another AETHER instance. AETHER opens a BAP-02 WebSocket connection to the remote instance and routes the task there. This is how multi-machine AETHER deployments work.

### Why Support Non-LLM Agents?

Because the most useful agents are often not LLMs at all. A test runner, a linter, a code formatter, a database query executor — these are deterministic tools with structured input/output. Treating them as agents in the same hierarchy lets the orchestration layer route to them using the same capability-resolution mechanism as LLM agents.

---

## 13. The Synapse DSL

Synapse is a domain-specific language for defining AETHER workflows declaratively. Instead of writing TypeScript to wire agents together, you write:

```synapse
@workflow data-pipeline
  @trigger on_commit("main")

  step analyze = research-agent("Analyze the PR changes")
  step review  = code-reviewer(analyze.output)
  step report  = report-writer(review.output)

  @output report.output
```

The DSL has a lexer, parser, and transpiler. The lexer turns the source into tokens. The parser builds an AST with `WorkflowNode`, `StepNode`, `PipelineNode`, and `HandlerNode` types. The transpiler emits TypeScript that calls the AETHER runtime API.

**Why have a DSL at all?** Because AETHER workflows are fundamentally declarative — you are describing a dependency graph, not writing an algorithm. A DSL makes the graph visible and readable to humans who are not TypeScript experts. It also enables tooling (syntax highlighting, validation, documentation generation) that generic TypeScript never gets.

---

## 14. Orchestration Patterns

AETHER's base system has three execution modes: sequential workflow, parallel pipeline, and InteractionNet DAG. Phase 1 adds four higher-level orchestration patterns that cover the remaining real-world multi-agent coordination needs.

### Handoff Protocol

Unlike escalation (vertical, failure-driven), a **handoff** is a horizontal, intentional transfer of control between peer agents. An agent mid-execution can decide "this task needs a different specialist" and hand off the conversation state.

```
Agent A (frontend) → handoff → Agent B (backend) → handoff → Agent C (database)
```

The `HandoffManager` validates that the target agent exists, has the required capabilities, and is not circuit-broken. Conversation state (last N messages, task context, accumulated results) carries forward. Handoff chains are tracked in the store to prevent cycles — if A hands off to B and B tries to hand back to A, the manager detects the cycle and blocks it.

**Key parameter**: `maxChainLength` (default: 5) — the maximum number of handoffs in a single task before the chain is terminated. Configurable via `settings.handoff.maxChainLength`.

### Group Chat

Multiple agents discuss a problem in rounds. A **speaker selector** picks who speaks next. A **termination condition** decides when to stop.

```
Round 1: CapabilitySelector picks → frontend-agent speaks
Round 2: CapabilitySelector picks → backend-agent speaks
Round 3: CapabilitySelector picks → frontend-agent speaks (follow-up)
Round 4: ConsensusTerminator fires → done
```

**Built-in speaker selectors:**

- `RoundRobinSelector` — agents take turns in order
- `CapabilitySelector` — picks the agent whose capabilities best match the current conversation topic (TF-IDF similarity scoring against the last message)

**Built-in terminators:**

- `MaxRoundsTerminator` — stops after N rounds
- `KeywordTerminator` — stops when an agent's output contains a trigger phrase (e.g., "FINAL ANSWER")
- `ConsensusTerminator` — stops when the last N messages from different agents agree (similarity > 0.85)

Each round: selector picks speaker → executor runs task with full conversation history → result appended to shared history → check termination. History is stored via ConversationManager (Section 16).

### State Graph

A `StateGraph` defines a directed graph where edges have conditions. This is the right abstraction for sequential decision flows with branches and reflection loops.

```
draft → review → [if quality < 0.8] → revise → review → [if quality ≥ 0.8] → done
```

Unlike InteractionNet (which models parallel reduction), StateGraph models sequential decision making. Nodes are state transformers: they receive the accumulated state, execute, and return modified state. Edges can be unconditional or conditional — a routing function examines the state and returns the next node ID.

- `addNode(id, executor)` — registers a state transformer node
- `addEdge(from, to)` — unconditional edge
- `addConditionalEdge(from, router)` — router function picks next node based on state
- `compile()` → validates the graph (no unreachable nodes, entry/exit exist) → returns a `CompiledGraph`
- `CompiledGraph.run(initialState)` — walks the graph until exit or max iterations (default: 10)

Cycle detection prevents infinite loops. The graph tracks iteration count per node; if any node executes more than `maxIterations` times, the graph terminates with the current state.

### Workflow Builder

A fluent TypeScript API that eliminates the need to write raw graph manipulation:

```typescript
const workflow = new WorkflowBuilder("deploy-pipeline")
  .sequential([
    { agent: "code-reviewer", task: "Review the PR" },
    { agent: "test-runner", task: "Run test suite" },
  ])
  .parallel([
    { agent: "docs-writer", task: "Update docs" },
    { agent: "changelog-writer", task: "Update changelog" },
  ])
  .aggregate("release-manager", "Compile release notes")
  .build();
```

- `.sequential()` → creates a chain with context threading (each step receives the previous step's output)
- `.parallel()` → creates fan-out (all steps execute concurrently)
- `.handoff()` → creates a handoff chain
- `.conditional(router)` → creates a StateGraph branch
- `.aggregate(agent, task)` → creates a fan-in merge point
- `.build()` → produces a `WorkflowDefinition` with typed steps ready for execution

### Why Four Patterns?

Each pattern maps to a distinct coordination topology that appears in real multi-agent systems:

| Pattern | Topology | Use Case |
|---------|----------|----------|
| Handoff | Linear chain | Specialist routing across domains |
| Group Chat | Round-table | Brainstorming, multi-perspective review |
| State Graph | Branching DAG | Quality loops, conditional pipelines |
| Workflow Builder | Composed | Any combination of the above |

---

## 15. Context-Aware Routing

The base system routes tasks by: direct agent ID → capability substring match → section fallback. The `AgentRouter` replaces this with a 6-strategy pipeline where each strategy returns a confidence score (0–1) and the highest-confidence match above the threshold wins.

### The Six Strategies

**1. Direct ID match** (confidence: 1.0)
If the task request specifies a target agent ID, use it. No scoring needed.

**2. File ownership** (confidence: 0.9)
If the task description mentions file paths, check the `file_ownership` table for agents that own those paths. Glob pattern matching: `src/components/**` matches `src/components/Button.tsx`.

```yaml
# In agent definition metadata:
metadata:
  owns: ["src/components/**", "src/hooks/**"]
  watches: ["package.json", "tsconfig.json"]
```

**3. Capability scoring** (confidence: 0.5–0.85)
TF-IDF similarity between the task description and each agent's capability vector. The agent with the highest cosine similarity above 0.5 wins. This replaces the old substring match, catching cases like "build a React component" routing to an agent with capability `react-components` even though neither string is a substring of the other.

**4. Historical success** (confidence: 0.7)
Query the `task_results` table for agents that successfully completed similar tasks. "Similar" is determined by TF-IDF similarity between the current task description and past task descriptions. The agent with the most successful similar completions gets a confidence boost.

**5. Section fallback** (confidence: 0.4)
Coarse domain routing using registry section indexes. "Build a login page" → section FRONTEND → any agent in that section. This is the existing behavior, preserved as a safety net.

**6. Load balancing** (confidence: tie-breaker)
Among equally capable agents, prefer idle ones over busy ones. This is not a routing strategy per se but a tie-breaker applied after all other strategies.

### Confidence Threshold

The router only accepts a match if confidence ≥ 0.6 (configurable via `settings.routing.confidenceThreshold`). Below that threshold, the router returns no match and the executor falls back to the default agent.

---

## 16. Conversation & Entity Memory

### Conversation Manager

Tracks multi-turn conversations between agents. Each conversation has an ID, a participant list, and a message history.

- `create(participants)` → returns a conversation ID
- `addMessage(convId, { agent, role, content })` → appends to history
- `getHistory(convId, limit?)` → retrieves messages (newest first, respects limit)
- `getCleanHistory(convId, forAgent)` → strips messages irrelevant to the target agent (for handoff "conversation cleaning")
- `checkpoint(convId)` → serializes the full conversation state for durable resume
- `restore(serializedState)` → recreates a conversation from checkpoint

History windowing: conversations are capped at `maxMessages` (default: 100, configurable via `settings.conversation.maxMessages`). When the limit is reached, the oldest messages are trimmed (FIFO), preserving the most recent context.

Backed by the `conversations` and `conversation_messages` tables in V2 schema.

### Entity Memory

Extracts and stores entity-level knowledge from task results. Every time a task completes successfully, the `EntityMemory` system scans the output for recognizable entities and accumulates facts about them.

**Entity types:** `file`, `module`, `api`, `concept`, `person`, `config`

**Extraction** uses pattern matching:
- File paths: `/src/auth/jwt.ts` → entity type `file`
- Module names: `AuthenticationModule` → entity type `module`
- API routes: `/api/v1/users` → entity type `api`
- Technical concepts: `JWT`, `OAuth`, `WebSocket` → entity type `concept`

**Fact accumulation**: Each entity builds a knowledge base over time. The fact "JWT tokens expire after 24 hours" gets attached to the `JWT` entity. Future tasks that mention JWT get this context injected automatically.

```
Task: "Fix the JWT expiration bug"
→ EntityMemory finds entity "JWT" with 4 accumulated facts
→ Facts injected into prompt alongside RAG context
→ Agent has project-specific JWT knowledge without re-reading the codebase
```

Backed by the `entities` and `entity_facts` tables in V2 schema.

---

## 17. Safety & Validation Pipeline

### Guardrails Pipeline

A pre/post LLM filter chain that validates inputs before they reach the model and outputs before they reach the user.

**Pre-guards (run before LLM call):**

- `PromptInjectionGuard` — detects patterns like "ignore previous instructions", "system prompt override", and similar injection attempts
- `LengthGuard` — caps prompt length at a configurable maximum (default: 50,000 characters) to prevent token budget exhaustion
- `SensitiveDataGuard` — scans for API keys (`sk-...`, `AKIA...`), passwords, email addresses, and other PII patterns before they reach the LLM

**Post-guards (run after LLM response):**

- `OutputSchemaGuard` — validates that the output matches an expected JSON schema (if one is defined)
- `CodeSafetyGuard` — scans generated code for dangerous patterns: `rm -rf /`, `eval()` with user input, raw SQL string concatenation, `child_process.exec` with unsanitized input

Guards return `{ allowed: boolean, modified?: string, reason?: string }`. A blocked pre-guard prevents the LLM call entirely. A blocked post-guard discards the response and returns an error to the caller.

### Schema Validation

The `SchemaValidator` validates LLM outputs against JSON Schema definitions. When validation fails, it generates a correction prompt explaining what was wrong and retries once.

```
LLM response: { "status": "done", "code": "..." }
Schema expects: { "status": string, "code": string, "tests": string[] }
→ Validation fails: missing required field "tests"
→ Correction prompt: "Your response was missing the required field 'tests'. Please include it."
→ Retry with correction prompt
→ If retry also fails: return partial result with validation errors attached
```

Built-in schemas: `CodeBlockSchema`, `PlanSchema`, `ReviewSchema`, `JSONResponseSchema`.

### Preflight Verification

Before executing a complex workflow, the `PreflightChecker` runs verification:

- All referenced agents exist and are in a healthy state (not error, not circuit-broken)
- Required capabilities are available in the registry
- Estimated token/time budget is sufficient for the workflow
- No circular dependencies exist in the workflow graph

Returns `{ passed: boolean, warnings: string[], errors: string[], budget: BudgetEstimate }`. Warnings are non-blocking (e.g., "agent X is busy but available"). Errors are blocking (e.g., "agent Y does not exist").

---

## 18. Progress Tracking

The `ProgressTracker` monitors long-running workflows for three failure modes:

### Stall Detection

If the time between consecutive workflow steps exceeds `2 × averageStepTime`, a stall warning is emitted. This catches agents that hang on an LLM call, wait for an unresponsive external service, or enter an infinite loop.

**Default stall threshold**: 60 seconds (configurable via `settings.progress.stallThresholdMs`).

### Loop Detection

If the same agent produces outputs with cosine similarity > 0.9 for 3 or more consecutive rounds, a loop warning is emitted. This catches agents that keep generating the same response without making progress.

**Default similarity threshold**: 0.9 (configurable via `settings.progress.loopSimilarityThreshold`).
**Default max similar outputs**: 3 (configurable via `settings.progress.maxConsecutiveSimilar`).

### Budget Exhaustion

Every workflow has a token budget and a wall-clock time budget. The tracker monitors accumulated tokens and elapsed time. When 80% of either budget is consumed, a warning is emitted. When 100% is reached, the workflow is aborted.

**Default token budget**: 500,000 tokens per workflow.
**Default time budget**: 600,000ms (10 minutes) per workflow.

Progress events are recorded in the `progress_events` table for post-mortem analysis.

---

## 19. Durable Workflows

AETHER loses in-flight workflow state on crash — unless the workflow is durable.

The `DurableWorkflow` class wraps a workflow definition and checkpoints state to SQLite after each step. On crash and restart, the runtime scans the `workflow_checkpoints` table for incomplete workflows and offers to resume them.

### Lifecycle States

```
START → RUNNING → COMPLETED
                → PAUSED (human-in-the-loop)
                → FAILED (unrecoverable error)
                → ABORTED (budget exhausted or manual abort)
```

### Checkpoint/Resume

After each step completes, the workflow writes a checkpoint containing:
- Current step index
- Accumulated context (all previous step outputs)
- Conversation ID (if using ConversationManager)
- Intermediate results

On resume, the workflow loads the last checkpoint and continues from the next step. Steps that already completed are not re-executed.

### Human-in-the-Loop

A step marked `requiresApproval: true` pauses the workflow and waits for external approval (via WebSocket message or CLI command). The workflow moves to PAUSED state until approval arrives.

---

## 20. Agent Communication Protocol (ACP)

ACP is a typed messaging layer on top of MemoryHighway. While MemoryHighway handles pub/sub transport, ACP adds structure: typed envelopes, schema validation, request-response futures, acknowledgments, dead-letter queues, and communication graph tracking.

### The ACP Envelope

Every ACP message is wrapped in a typed envelope:

```typescript
{
  msgId: "uuid",
  timestamp: "2025-01-15T10:30:00Z",
  sender: "frontend-agent",
  receiver: "backend-agent",
  msgType: "task",           // task | plan | result | validation | error | control | ack | query | broadcast
  content: { ... },          // typed payload
  meta: {
    schemaId: "task-v1",     // optional: validate content against registered schema
    expectsResponse: true,   // optional: sender is awaiting a reply
    retryCount: 0,
    maxRetries: 3,
  },
  trace: {
    taskId: "task-uuid",     // optional: correlation
    workflowId: "wf-uuid",
    parentMsgId: "prev-uuid", // for request-response threading
    hopCount: 2,
    hops: ["agent-a", "agent-b"],
    policyTags: ["priority-high"],
  },
  acknowledged: false,
}
```

### Request-Response Pattern

`acpBus.request(params)` sends a message with `meta.expectsResponse = true` and returns a Promise. The bus monitors incoming messages for a response matching `trace.parentMsgId`. If no response arrives within the timeout (default: 30s), the Promise rejects.

### Dead-Letter Queue

If a message delivery fails (handler throws, agent unreachable) and retries are exhausted (`meta.retryCount >= meta.maxRetries`), the message is moved to the dead-letter queue. Dead letters can be inspected and retried manually.

### Communication Graph

Every `send()` call records an edge in the communication graph: `sender → receiver (msgType)`. This graph is queryable for debugging: "which agents talk to each other?", "what message types flow between A and B?", "what is the adjacency list for agent X?".

---

## 21. Conflict Resolution

When multiple agents work in parallel or group chat, their outputs may conflict. The base system just concatenates results. The `ConflictResolver` detects and resolves these conflicts.

### Analysis

`analyze(outputs)` takes an array of agent outputs and produces a `ConflictReport` identifying:

- **Agreements**: points where multiple agents say the same thing
- **Contradictions**: points where agents directly disagree
- **Unique contributions**: information that only one agent provides

Analysis uses sentence-level similarity (TF-IDF cosine similarity between sentence pairs across outputs). Sentences with similarity > 0.85 are agreements. Sentences with similarity > 0.5 but semantic negation detected are contradictions.

### Resolution Strategies

| Strategy | How it works | Best for |
|----------|-------------|----------|
| `majority-vote` | If 3 agents say X and 1 says Y, pick X | Fact-checking |
| `weighted-by-tier` | Master output > Manager > Worker | Hierarchical decisions |
| `weighted-by-confidence` | Agents self-report confidence (0-1) | When agents know their limits |
| `llm-mediator` | Send conflicts to a manager agent for resolution | Complex disagreements |
| `merge` | Take unique contributions from each, flag contradictions inline | Documentation, summaries |

---

## 22. Observability & Structured Logging

### StructuredLogger

The `StructuredLogger` replaces flat text logs with JSON-structured entries that carry context automatically.

```typescript
const logger = structuredLogger.scoped({ taskId: "task-123", agentId: "frontend" });
logger.info("Starting component generation", { component: "Button" });
// → { timestamp, level: "info", source: "...", message: "Starting component generation",
//    context: { taskId: "task-123", agentId: "frontend" }, data: { component: "Button" } }
```

**Scoped loggers** propagate context: every log entry from a scoped logger automatically includes its fixed context (task ID, workflow ID, agent ID). Child scopes merge parent and child context.

**LLM call instrumentation**: `recordLLMCall()` tracks every LLM API call with provider, model, token counts, latency, and success/failure. `getLLMStats()` returns aggregate statistics by provider and by agent.

**JSONL audit trail**: ACP messages are logged to a separate `audit.jsonl` file for compliance and debugging.

**Log querying**: `query({ taskId, agentId, level, since, until, limit })` scans the in-memory ring buffer (max 5,000 entries) with filters. `getTaskLog(taskId)` and `getWorkflowLog(workflowId)` are convenience wrappers.

### Why Structured Logging?

Flat text logs (`[2025-01-15T10:30:00] [INFO] [Executor] Task started`) are human-readable but machine-hostile. You cannot filter by task ID, correlate across subsystems, or compute latency distributions from flat text. Structured logging solves all three while still forwarding to the existing SynapseLogger for backward compatibility.

---

## 23. Shared State Bus

The `SharedStateBus` provides centralized, observable state for workflows. All participants see the same state. Changes are atomic and immutable — every `update()` creates a new version rather than mutating in place.

### The Update Pattern

```typescript
const newState = bus.update("session-123", {
  agent: "frontend-agent",
  reason: "Component generation complete",
  patches: { componentCode: "...", testsPassing: true },
  incrementStep: true,
  addEdge: { from: "frontend-agent", to: "test-runner", msgType: "handoff" },
});
```

Internally, `update()`:
1. Gets current state (throws if session not found)
2. Creates new state: `{ ...old, values: { ...old.values, ...patches }, version: old.version + 1 }`
3. Records a `StateTransition` with changed fields, agent, reason, and version numbers
4. Publishes a notification to MemoryHighway
5. Persists to KV store if configured
6. Returns new state (old reference unchanged — immutability preserved)

### Communication Graph

The bus tracks which agents talk to which other agents within each session. `getAdjacencyList(sessionId)` returns the directed graph. This is separate from ACP's communication graph — the shared state graph tracks workflow-level interactions, while ACP tracks message-level interactions.

### Background Maintenance

The bus runs a background timer (configurable interval, default: 5 minutes) that cleans expired KV entries from the underlying store. This is the mechanism that finally schedules the `cleanExpiredKV()` function that exists in the SQLite store but was never called on a timer in the base system.

---

## 24. Plugin System

The `PluginRegistry` manages external code that hooks into AETHER's lifecycle.

### Plugin Slots

Eight lifecycle points where plugins can execute:

| Slot | When it fires |
|------|--------------|
| `PreExecution` | Before a task is sent to an agent |
| `PostExecution` | After a task result is received |
| `PreRouting` | Before the router picks an agent |
| `PostRouting` | After the router picks an agent |
| `OnEscalation` | When an agent escalates a failure |
| `OnError` | When any subsystem error occurs |
| `OnStartup` | During runtime initialization |
| `OnShutdown` | During runtime shutdown |

### Plugin Interface

```typescript
interface AetherPlugin {
  id: string;
  name: string;
  version: string;
  slots: PluginSlot[];
  init(runtime: AetherRuntime): Promise<void>;
  execute(slot: PluginSlot, context: PluginContext): Promise<PluginResult>;
  destroy(): Promise<void>;
}
```

Plugins are discovered by scanning `.aether/plugins/` for `*.plugin.ts` files. Each plugin declares which slots it wants to hook into. `executeHooks(slot, context)` runs all plugins registered for a slot in registration order.

### Why Plugins Instead of Direct Code Modification?

Because AETHER's core should remain stable while users customize behavior. A monitoring plugin, a Slack notification plugin, a custom routing plugin — these are all use cases that should not require forking the framework. The 8-slot model covers the key lifecycle points without exposing all internal state.

---

## 25. Reaction Engine

The `ReactionEngine` watches MemoryHighway events and triggers workflows automatically based on configurable rules.

### Reaction Rules

```typescript
{
  id: "auto-test-on-review",
  trigger: {
    channel: "results",
    condition: (msg) => msg.type === "task-complete" && msg.summary.includes("code review"),
  },
  action: {
    type: "execute_task",
    target: "test-runner",
    taskTemplate: "Run the test suite for the reviewed code",
  },
  cooldown: 30000,  // Don't fire more than once per 30 seconds
  maxFires: 10,     // Stop after 10 fires (prevent runaway)
  enabled: true,
}
```

The engine subscribes to the MemoryHighway wildcard channel. Every incoming message is checked against all enabled rules. If a rule's condition matches and the cooldown has elapsed, the action fires.

**Action types:**
- `execute_task` — creates a TaskRequest and sends it to the executor
- `execute_workflow` — triggers a named workflow
- `notify` — publishes a notification message to a channel
- `custom` — calls a user-provided handler function

Cooldown prevents reaction storms (rule A triggers B, B triggers A). `maxFires` provides an absolute cap.

---

## 26. Settings & Configuration

AETHER has two configuration files in `.aether/`:

- **`config.json`** — auto-generated by `aether init`. Contains workspace scan results (detected frameworks, languages, databases), provider configuration (which LLM APIs are available), and server settings. Not intended for manual editing.

- **`settings.json`** — user-editable tuning knobs for all subsystems. Created by `aether init` with sensible defaults. Every tunable parameter across AETHER's 28 subsystems is surfaced here.

### Settings Structure

Thirteen configuration groups:

| Group | Controls |
|-------|----------|
| `methodology` | Development mode (TDD/SDD/hybrid), test command, spec directory |
| `agents` | Max concurrent agents, tier limits (masters/managers/workers) |
| `execution` | Max depth, timeout, tokens, temperature, feature toggles |
| `escalation` | Circuit breaker threshold and window |
| `routing` | Confidence threshold for agent resolution |
| `conversation` | Max messages per conversation |
| `handoff` | Max handoff chain length |
| `progress` | Token/time budgets, stall/loop thresholds |
| `highway` | RAG indexing, dedup window, KV TTL |
| `acp` | Request timeout, max retries, dead-letter limit |
| `logging` | Log level, max retained entries |
| `sharedState` | Cleanup interval, max transitions, persistence |
| `server` | WebSocket port and host |

### The `aether config` CLI

```bash
aether config                          # Show all current settings
aether config get execution.maxDepth   # Get a specific value → 3
aether config set execution.maxDepth 5 # Set a specific value
aether config reset execution          # Reset one section to defaults
aether config reset                    # Reset everything to defaults
aether config edit                     # Open settings.json in $EDITOR
aether config validate                 # Check settings for errors
aether config path                     # Print path to settings.json
```

Settings are deep-merged with defaults on load. Missing keys get default values. The `SettingsManager.validate()` method checks types, numeric ranges (temperature 0–2, maxDepth 1–10), and enum values (methodology mode, log level, agent tier).

---

## 27. Key Architectural Decisions

### Decision: SQLite over a document store or key-value store

**Considered:** Redis (fast KV), MongoDB (flexible documents), flat JSON files
**Chosen:** SQLite with sqlite-vec and FTS5
**Reason:** AETHER needs five distinct storage patterns simultaneously: relational (agent relationships, escalation chains), key-value with TTL (KV store), vector similarity (RAG), full-text search (RAG), and time-series (message log, task history). SQLite with its extension ecosystem handles all five in one file with ACID guarantees and zero operational overhead.

### Decision: Interface-based storage with constructor injection

**Considered:** Global store singleton, module-level state
**Chosen:** `AetherStore` interface, injected via constructors
**Reason:** Global singletons make testing impossible (tests share state) and make the dependency graph implicit. Constructor injection documents exactly what each subsystem needs. The interface boundary means the SQLite backend can be swapped for a test double or a different database without modifying subsystem code.

### Decision: Interaction combinators over async/await task graphs

**Considered:** Promise chains, BullMQ/queue-based parallelism, hand-rolled DAG executor
**Chosen:** Yves Lafont interaction combinators
**Reason:** Correctness by construction. Every other approach requires the programmer to manually verify that the execution graph cannot deadlock. Interaction combinators have a mathematical proof (strong confluence) that guarantees the same result regardless of reduction order. The cost is implementation complexity. The benefit is that any agent-authored graph is automatically correct.

### Decision: TF-IDF embeddings with API fallback

**Considered:** Require OpenAI API key, use a static embedding model
**Chosen:** TF-IDF as default, API embeddings as optional upgrade
**Reason:** AETHER should work out of the box with zero configuration. Requiring an external embedding service is a hard dependency that fails at startup if the key is missing or the service is rate-limited. TF-IDF embeddings are deterministic, zero-latency, and good enough for capability matching and task context retrieval. Users who need higher-quality embeddings opt in with an API key.

### Decision: Three fixed agent tiers instead of flexible depth

**Considered:** Arbitrary depth hierarchies, flat peer networks
**Chosen:** Exactly three tiers (master/manager/worker)
**Reason:** Arbitrary depth hierarchies make escalation unpredictable — how many hops before master? Flat peer networks have no escalation concept at all. Three tiers is the minimum that supports "delegate down, escalate up" semantics while keeping the hierarchy shallow enough to reason about. The circuit breaker at master enforces the budget cost of deep escalation.

### Decision: FNV-1a hashing for message deduplication

**Considered:** MD5/SHA for content hashing, store-backed exact deduplication
**Chosen:** FNV-1a (Fowler–Noll–Vo) hash of `channel:sender:summary`
**Reason:** Fast, non-cryptographic, collision-resistant enough for deduplication. MD5/SHA are overkill here — we are not preventing adversarial collision attacks, we are preventing accidental duplicates from network retries. FNV-1a runs in nanoseconds versus microseconds and produces a compact 64-bit hash that fits in the database without wasting space.

### Decision: WAL mode for SQLite

**Chosen:** `PRAGMA journal_mode = WAL`
**Reason:** WAL (Write-Ahead Logging) mode allows concurrent readers and a single writer without readers blocking writers or writers blocking readers. The default rollback journal mode blocks readers during writes. Since AETHER has multiple subsystems reading the database concurrently (registry queries while tasks are executing while messages are being logged), WAL mode prevents the database from becoming a bottleneck.

### Decision: Immutable state transitions in SharedStateBus

**Considered:** Mutable shared state with locks, event-sourced state
**Chosen:** Immutable transitions via `update()` — every change creates a new version
**Reason:** Mutable shared state with locks is the classic source of concurrency bugs. Event sourcing is powerful but adds reconstruction complexity. Immutable transitions with version numbering give the simplicity of direct state access with the auditability of event sourcing. Every transition records who changed what, when, and why.

### Decision: Horizontal handoff separate from vertical escalation

**Considered:** Merging handoff into the existing escalation mechanism
**Chosen:** Handoff as a separate, peer-to-peer protocol
**Reason:** Escalation is failure-driven and vertical (worker → manager → master). Handoff is success-driven and horizontal (specialist → specialist). Merging them would conflate "I failed" with "this needs a different expert." Keeping them separate means escalation can trigger circuit breakers while handoff can transfer state without marking the source agent as failed.

---

## 28. Data Flow: A Request End to End

Here is what happens when you run:

```bash
aether run "Refactor the authentication module to use JWT"
```

1. **CLI parses the command** (`bin/aether.ts`) and calls `runtime.run(taskText)`.

2. **Runtime bootstraps** if not already running: init SQLite store, load config and settings, discover agents from `.agent.md` files, populate registry, start MemoryHighway, initialize all Phase 1-9 subsystems.

3. **Runtime creates a TaskRequest** with a generated request ID, current timestamp, and default priority 3.

4. **AgentRouter resolves the target agent**. It runs the 6-strategy pipeline: direct ID (no match) → file ownership (no file paths in task) → capability scoring (finds `auth-specialist` with 0.82 confidence) → accepts.

5. **PreflightChecker verifies** the selected agent is healthy, not circuit-broken, and the token budget is sufficient.

6. **Executor queries RAG + EntityMemory for context**. RAG finds: the auth module's last refactor result, the agent definition, JWT middleware code. EntityMemory finds: 4 accumulated facts about the "JWT" entity and 2 facts about the "auth module" entity. All are injected into the prompt.

7. **Guardrails pre-check** scans the assembled prompt for injection patterns, sensitive data, and length. All clear.

8. **Executor calls the LLM** with: system prompt + RAG context + entity context + task description. The LLM responds with a plan and requests two sub-tasks.

9. **Guardrails post-check** validates the response. **SchemaValidator** checks output structure. Both pass.

10. **Executor spawns two sub-tasks** — routed to capable agents, executed concurrently via InteractionNet. ProgressTracker monitors for stalls and loops.

11. **ConflictResolver merges** the two sub-task results, detecting no contradictions.

12. **EntityMemory extracts** new entities from the output (e.g., new JWT utility function name) and stores facts.

13. **Parent task completes**. Result is saved to `task_results`. A message is published to MemoryHighway `results` channel. The result is indexed into the RAG `tasks` namespace. **ACP** publishes a typed `result` envelope. **ReactionEngine** checks rules (no matches this time).

14. **CLI prints the result** and exits.

Total LLM calls: 3 (1 initial + 2 sub-tasks). Total SQL writes: ~25 (agent status, messages, task results, vector upserts, entity facts, progress events, counters). Total time: dominated by LLM latency, typically 10–30 seconds.

---

## 29. What Does Not Exist (And Why)

### No distributed lock manager

AETHER runs as a single process. There is no need to coordinate locks across processes. SQLite's WAL mode handles concurrent read/write within the process. If you need multi-process deployment, use federation transport between two AETHER instances rather than trying to share a single SQLite file across processes.

### No streaming LLM responses

The executor waits for the full LLM response before processing it. Streaming would complicate sub-task parsing (you cannot parse JSON from a partial stream), guardrails post-checks (you cannot validate a partial response), and schema validation. For long responses, the timeout (configurable, default 120s) provides a safety bound.

### No authentication between agents in the same process

Message bus subscriptions and direct executor calls are trust-zero internally. Agents in the same AETHER instance are co-tenants by definition. Authentication exists only at the WebSocket layer (for external connections) and at the transport layer (for external agent APIs).

### No hot plugin reloading

Plugins are loaded once during `runtime.init()` and destroyed during `runtime.shutdown()`. There is no mechanism to reload a plugin without restarting the runtime. This is a deliberate simplicity choice — hot reloading introduces state consistency issues (what happens to in-flight tasks when a plugin's behavior changes?) that are not worth solving for a local tool.

### No built-in secret management

API keys are read from environment variables. There is no vault integration, no encrypted configuration, no secret rotation. AETHER is a local development tool — secrets are managed by the operating system's environment or by external tools like `dotenv`. Adding a vault would be a heavy dependency for marginal benefit in the target use case.

### No distributed consensus

The SharedStateBus uses simple version numbering for optimistic concurrency, not Raft or Paxos. Since AETHER is single-process, there is no split-brain problem. Federation between instances uses the BAP-02 protocol's message ordering, not a consensus algorithm.

---

_AETHER v0.2.0 — BSL-1.1 License, converts to MIT in 2030._
