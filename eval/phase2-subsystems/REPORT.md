# Phase 2: Subsystem Unit Tests -- Evaluation Report

**Run:** 2026-03-07T22:57:06.715Z to 2026-03-07T22:57:08.663Z
**Results:** 77 passed, 0 failed, 0 skipped, 0 errors out of 77 tests
**Score:** 675 / 685 (98.5%)

---

## Results

| # | Test | Status | Score | Duration | Details |
|---|------|--------|-------|----------|---------|
| 2.1.1 | SQLiteStore — Agent CRUD | PASS | 10/10 | 45ms | saveAgent succeeded; getAgent returned correct agent; getAllAgents returned 1 agent(s); updateAgentStatus changed status |
| 2.1.2 | SQLiteStore — Task CRUD | PASS | 10/10 | 49ms | saveTaskResult succeeded; getTaskResult returned correct task; Task metrics: totalTasks=1; getTaskResult handles missing |
| 2.1.3 | SQLiteStore — KV Operations | PASS | 10/10 | 43ms | kvSet succeeded; kvGet returned correct value; kvDelete removed the key; kvSet with TTL stored value; kvGet returns null |
| 2.1.4 | SQLiteStore — FTS5 Search | PASS | 10/10 | 39ms | ftsUpsert succeeded for 3 documents; ftsQuery('React') returned 2 results; ftsQuery returns empty for non-matching query |
| 2.1.5 | SQLiteStore — Vector Operations (sqlite-vec) | PASS | 10/10 | 68ms | vectorUpsert succeeded; Second vectorUpsert succeeded; vectorQuery returned 2 result(s); Closest match is correct (vec-d |
| 2.2.1 | AgentRegistry — Register all fixture agents | PASS | 5/5 | 2ms | Registered all 10 fixture agents |
| 2.2.2 | AgentRegistry — findBySection | PASS | 5/5 | 1ms | findBySection('FRONTEND') returned 3 agent(s); react-specialist found in FRONTEND section; findBySection('META') returne |
| 2.2.3 | AgentRegistry — findByCapability | PASS | 5/5 | 0ms | findByCapability('react') returned 1 agent(s); findByCapability('sql') returned 1 agent(s) (fuzzy match) |
| 2.2.4 | AgentRegistry — findByTier | PASS | 5/5 | 1ms | findByTier('worker') returned 6 worker(s); findByTier('master') returned 1 master(s); More workers than masters (correct |
| 2.2.5 | AgentRegistry — resolve prefers idle agents | PASS | 5/5 | 0ms | resolve('react-components') returned react-specialist; Resolved agent is idle; After making react-specialist busy, resol |
| 2.2.6 | AgentRegistry — Escalation chain (worker -> manager -> master) | PASS | 5/5 | 1ms | Escalation chain from react-specialist has 2 step(s); Chain includes system-architect (manager); Chain includes cortex-0 |
| 2.2.7 | AgentRegistry — Duplicate ID rejection | PASS | 3/3 | 0ms | First registration succeeded; Duplicate registration correctly threw error |
| 2.2.8 | AgentRegistry — Unregister removes from all indexes | PASS | 2/2 | 2ms | unregister returned true; Agent fully removed from all indexes |
| 2.3.1 | InteractionNet — Add nodes, wires, check ports | PASS | 10/10 | 3ms | Created 2 task nodes: task-1-mmgxb4pt, task-2-mmgxb4pt; Both nodes retrievable by ID; Node ports correctly structured (p |
| 2.3.2 | InteractionNet — Active pair detection | PASS | 10/10 | 1ms | Found 1 active pair(s); Active pair contains the correct nodes; getReadyPairs returned 1 pair(s) |
| 2.3.3 | InteractionNet — Checkpoint/restore round-trip | PASS | 10/10 | 42ms | Net built with 3 nodes; Checkpoint saved; Restore returned true; Restored node count matches: 3 |
| 2.3.4 | InteractionNet — Factory methods (buildParallelDAG, buildPipeline, createFanOut) | PASS | 10/10 | 1ms | buildParallelDAG: created 3 task nodes + 1 join; buildPipeline: created 2 sequential nodes; createFanOut: created duplic |
| 2.4.1 | NetScheduler — Create and run with constructor-eraser pair | PASS | 15/15 | 9ms | Created constructor-eraser active pair; Active pairs before: 1; runToCompletion finished; Metrics: totalReductions=1, su |
| 2.4.2 | NetScheduler — Metrics tracking | PASS | 15/15 | 2ms | Initial totalReductions = 0; Final metrics: total=1, successful=1, failed=0; Reductions occurred; averageReductionMs = 0 |
| 2.5.1 | WorkerPool — Create pool with mock executor, submit tasks | PASS | 10/10 | 7ms | Pool started; Pool is running; submit(5) returned 10 (correct); submitAll returned 3 results: [2,4,6]; All results corre |
| 2.5.2 | WorkerPool — Priority ordering | PASS | 10/10 | 56ms | Pool started with 1 worker; Completion order: [1,2,3]; All 3 tasks completed; Higher priority task (5) completed before  |
| 2.6.1 | MemoryHighway — Subscribe to channel, publish message, verify delivery | PASS | 6/6 | 11ms | Subscribed to test-channel; Published message: msg-1-mmgxb4tk; Message delivered to subscriber; Message content correct; |
| 2.6.2 | MemoryHighway — Channel isolation | PASS | 6/6 | 2ms | Channel A received exactly 2 messages; Channel B received exactly 1 message |
| 2.6.3 | MemoryHighway — Wildcard subscriber receives all | PASS | 6/6 | 2ms | Wildcard subscriber received all 3 messages across channels |
| 2.6.4 | MemoryHighway — Broadcast message | PASS | 4/4 | 2ms | Broadcast sent to wildcard channel; Broadcast received by wildcard subscriber |
| 2.6.5 | MemoryHighway — KV set/get | PASS | 4/4 | 7ms | KV set/get works correctly; has() returns true for existing key; del() removes the key |
| 2.6.6 | MemoryHighway — Deduplication | PASS | 4/4 | 2ms | Deduplication blocked duplicate message; duplicatesBlocked = 1 |
| 2.7.1 | RAGIndex — Initialize, index a document, query, verify results | PASS | 15/15 | 104ms | RAGIndex initialized; Indexed doc 1: docs-1772924227183-cigv9c; Indexed doc 2: docs-1772924227198-p4lwbi; Query returned |
| 2.7.2 | RAGIndex — Namespace isolation | PASS | 15/15 | 103ms | Indexed in 'agents' namespace; Indexed in 'code' namespace; Agents namespace query returned 1 result(s), all from 'agent |
| 2.8.1 | RAGMetaIndex — 3-tier query acceleration (hot cache, bloom, full) | PASS | 10/10 | 71ms | RAGMetaIndex created; First query tier: full; First query returned 1 result(s); Second query tier: hot; Hot cache hit on |
| 2.8.2 | RAGMetaIndex — Cache invalidation and clear | PASS | 10/10 | 44ms | Cache warmed with repeat query; invalidateNamespace('docs') called; clear() called; cacheHitRate=0.000, bloomHitRate=0.5 |
| 2.9.1 | Embedder — Embed text produces 384-dim vector | PASS | 8/8 | 4ms | Embedding returned vector of length 384; Vector dimension is 384 (correct); Mode is tfidf; Reported dimension is 384; La |
| 2.9.2 | Embedder — L2 normalization (norm close to 1) | PASS | 6/6 | 3ms | L2 norm = 1.000000; Norm is within 0.01 of 1.0 (well normalized) |
| 2.9.3 | Embedder — Caching (same text returns cached result) | PASS | 6/6 | 3ms | First call: not cached; Second call: cached=true; Cached vector is identical to original; cacheHits = 1 |
| 2.10.1 | EscalationManager — Escalation from worker to manager | PASS | 15/15 | 2ms | EscalationManager created with threshold=5; Escalation result: target=system-architect, circuitBroken=false; Escalation  |
| 2.10.2 | EscalationManager — Circuit breaker trips after threshold | PASS | 15/15 | 1ms | Escalation 1: succeeded, circuit not broken; Escalation 2: succeeded, circuit not broken; Escalation 3: circuit breaker  |
| 2.11.1 | GuardrailsPipeline — Injection detection patterns | PASS | 10/10 | 3ms | Pipeline created with PromptInjectionGuard; Blocked 5/5 injection attempts; Safe prompt correctly allowed |
| 2.11.2 | GuardrailsPipeline — Sensitive data detection | PASS | 8/10 | 0ms | Pipeline created with SensitiveDataGuard; AWS key detected and blocked; GitHub token NOT detected; Private key detected  |
| 2.11.3 | GuardrailsPipeline — Code safety patterns | PASS | 5/10 | 1ms | Pipeline created with CodeSafetyGuard (post-guard); Warned on 0/5 dangerous patterns; Safe code passed without warnings |
| 2.12.1 | ConversationManager — Create, add messages, get history | PASS | 10/10 | 43ms | ConversationManager created; Created conversation: conv-1772924227507-iezez1g3; Added 3 messages successfully; getHistor |
| 2.12.2 | ConversationManager — Auto-trim when exceeding max messages | PASS | 7/10 | 39ms | Created conversation with maxMessages=5; Added 8 messages (exceeds max of 5); After trim, history has 8 messages; Histor |
| 2.13.1 | EntityMemory — Extract entities from text | PASS | 10/10 | 39ms | EntityMemory created; Extracted 5 entities; Files: src/auth/handler.ts; Modules: express; APIs: /api/users; Configs: DAT |
| 2.13.2 | EntityMemory — Save/get entities and facts | PASS | 10/10 | 37ms | Added fact for auth-module; Retrieved entity: auth-module (type: module); Retrieved 1 fact(s) for entity; Fact content i |
| 2.14.1 | HandoffManager — Successful handoff A -> B | PASS | 10/10 | 47ms | HandoffManager created; Handoff succeeded; fromAgent correct; toAgent correct; Conversation created: conv-1772924227676- |
| 2.14.2 | HandoffManager — Cycle detection | PASS | 10/10 | 50ms | First handoff succeeded: conv=conv-1772924227726-9ilyf02e; Second handoff succeeded: B -> C; Cycle correctly detected an |
| 2.15.1 | StateGraph — Build, compile, execute linear graph | PASS | 10/10 | 4ms | Graph built with 3 nodes and 2 edges; Graph compiled successfully; Compiled graph has correct nodes; Compiled graph has  |
| 2.15.2 | StateGraph — Conditional branching | PASS | 10/10 | 0ms | Conditional graph compiled; valid=true routed to success; Trace correct for success path; valid=false routed to failure; |
| 2.16.1 | WorkflowBuilder — Sequential chain | PASS | 7/7 | 2ms | Workflow built: test-sequential, 3 steps; Correct step count; First step has no dependencies; Second step depends on fir |
| 2.16.2 | WorkflowBuilder — Parallel fan-out | PASS | 6/6 | 1ms | Parallel workflow built: 3 steps; All steps are parallel type; All steps in group: parallel-0; parallelGroups has correc |
| 2.16.3 | WorkflowBuilder — Conditional + describe() | PASS | 7/7 | 1ms | Conditional workflow: 4 steps; Correct total step count (4); 2 conditional steps found; 1 aggregate step found; describe |
| 2.17.1 | DurableWorkflow — Run 3-step workflow to completion | PASS | 10/10 | 44ms | Workflow built: 3 steps; Workflow completed; All 3 steps completed; Steps executed in order: [step-0, step-1, step-2]; I |
| 2.17.2 | DurableWorkflow — Checkpoint and resume | PASS | 10/10 | 34ms | Workflow paused after step 1; Completed 1 step(s) before pause; Workflow resumed and completed; 2 step(s) executed on re |
| 2.18.1 | ConflictResolver — Analyze overlapping/contradicting outputs | PASS | 8/8 | 4ms | ConflictResolver created; Analysis complete; Agreements found: 2; Contradictions found: 0; Unique contributions: 3; Tota |
| 2.18.2 | ConflictResolver — majority-vote, weighted-by-tier, merge strategies | PASS | 12/12 | 2ms | majority-vote produced output; Strategy correctly reported as majority-vote; All 3 agents participated; weighted-by-tier |
| 2.19.1 | ProgressTracker — Track execution events and summary | PASS | 10/10 | 36ms | ProgressTracker created; 3 execution events tracked; Summary reports 3 total steps; Total tokens: 4500 (correct); Unique |
| 2.19.2 | ProgressTracker — Detect loop from identical outputs | PASS | 10/10 | 37ms | 4 identical events tracked for same agent; Loop detected: Loop detected: agent stuck-agent produced identical output 4 t |
| 2.20.1 | ACPBus — Send and receive messages | PASS | 10/10 | 70ms | ACPBus started; Agent-b subscribed; Message sent: 51ec5015-91fb-4202-ad75-26b6ff8beee2; Agent-b received 1 message(s); M |
| 2.20.2 | ACPBus — Request-response with timeout | PASS | 10/10 | 125ms | ACPBus started for request-response test; Request-response succeeded; Response content correct; Request correctly timed  |
| 2.20.3 | ACPBus — Dead letter queue | PASS | 10/10 | 78ms | ACPBus started for dead letter test; Dead letters: 1; Dead letter has correct error reason; Dead letter envelope preserv |
| 2.21.1 | SharedStateBus — Session lifecycle and versioning | PASS | 10/10 | 4ms | Session created; Initial version is 0; Goal set correctly; Version incremented to 1 after first update; Patches applied  |
| 2.21.2 | SharedStateBus — Multiple sessions and edge tracking | PASS | 10/10 | 3ms | 2 sessions created; hasSession works; 2 unique comm edges recorded; Edge count incremented on repeat; Adjacency list cor |
| 2.22.1 | PluginRegistry — Register and execute hooks | PASS | 10/10 | 3ms | PluginRegistry created; Plugin registered; init() was called during registration; Registry size: 1; pre-execution hook e |
| 2.22.2 | PluginRegistry — Execution order and abort propagation | PASS | 10/10 | 2ms | Registered 3 plugins; Plugins A and B executed; Plugin C correctly skipped after abort; shouldAbort returns abort=true;  |
| 2.23.1 | ReactionEngine — Rule trigger and action execution | PASS | 10/10 | 137ms | ReactionEngine created; 1 rule registered; Engine started; Action fired: ruleId=rule-on-task, channel=tasks; Reaction lo |
| 2.23.2 | ReactionEngine — Cooldown and maxFires limits | PASS | 10/10 | 140ms | Engine started with maxFires=2 rule; maxFires=2 correctly limited to 2 fires; Skipped entries in log: 1; Rule disabled;  |
| 2.24.1 | TierRegistry — Register and rank ordering | PASS | 10/10 | 2ms | TierRegistry created; 3 tiers registered; Rank ordering correct: supreme > commander > operative; supreme is higher than |
| 2.24.2 | TierRegistry — Escalation gate policies | PASS | 5/5 | 0ms | Builtin tiers loaded: 5 tiers; worker -> manager: allowed (open); manager -> master: blocked at priority 2 (needs 4); ma |
| 2.24.3 | TierRegistry — builtinTiers and classicTiers factories | PASS | 5/5 | 1ms | builtinTiers: 5 tiers; All 5 builtin tier names present; classicTiers: 3 tiers; Classic tiers: master, manager, worker;  |
| 2.25.1 | AgentForge — Spawn agent (creates file + registers) | PASS | 10/10 | 117ms | AgentForge created; Agent spawned: auto-tester-1; Agent tier: worker; Agent file created on disk; Agent found in registr |
| 2.25.2 | AgentForge — Retire agent | PASS | 10/10 | 35ms | Agent spawned for retire test; retireAgent called; Agent removed from registry; Agent file deleted from disk; Correctly  |
| 2.26.1 | SystemSentinel — Swarm health and health check | PASS | 10/10 | 5ms | SystemSentinel created; Agent count: 10; Tiers: {"master":1,"manager":1,"worker":6,"forge":1,"sentinel":1}; Statuses: {" |
| 2.26.2 | SystemSentinel — Force kill, pause, and resume | PASS | 10/10 | 5ms | react-specialist force-killed to error state; Facts ledger has 1 entry(ies); Swarm paused; Non-sentinel agents set to of |
| 2.27.1 | PreflightChecker — All agents present (should pass) | PASS | 10/10 | 2ms | PreflightChecker created; Preflight PASSED (all agents present); No errors; All agents reported healthy; Budget within l |
| 2.27.2 | PreflightChecker — Missing agents (should fail) | PASS | 10/10 | 0ms | Preflight correctly FAILED (missing agent); Errors: Agent not found: non-existent-agent; Missing agent correctly identif |
| 2.28.1 | SettingsManager — Defaults and save/load round-trip | PASS | 10/10 | 8ms | SettingsManager created; Settings file does not exist initially; Default methodology.mode: tdd; Default execution.maxDep |
| 2.28.2 | SettingsManager — Dot-path get and set | PASS | 5/5 | 3ms | get('execution.maxDepth'): 3; get('methodology.mode'): tdd; set/get('execution.temperature'): 0.5; set() persisted and r |
| 2.28.3 | SettingsManager — Validate settings | PASS | 5/5 | 1ms | Defaults validate successfully; Invalid settings correctly rejected; Validation errors: 3; Errors reference specific fie |