# Phase 10: Performance Profiling -- Evaluation Report

**Run:** 2026-03-07T22:58:53.795Z to 2026-03-07T22:58:54.464Z
**Results:** 16 passed, 0 failed, 0 skipped, 0 errors out of 16 tests
**Score:** 160 / 160 (100.0%)

---

## Results

| # | Test | Status | Score | Duration | Details |
|---|------|--------|-------|----------|---------|
| 10.01.1 | SQLite — write 1000 agents (ops/sec) | PASS | 10/10 | 203ms | 6168 ops/sec (162.1ms for 1000 writes) |
| 10.01.2 | SQLite — read 1000 agents (ops/sec) | PASS | 10/10 | 205ms | 146116 ops/sec (6.8ms for 1000 reads) |
| 10.01.3 | SQLite — FTS5 search latency | PASS | 10/10 | 101ms | p50=0.04ms p95=0.26ms over 20 queries |
| 10.02.1 | Embedder — single doc latency (100 iterations) | PASS | 10/10 | 6ms | p50=0.024ms p95=0.051ms |
| 10.02.2 | Embedder — batch 100 docs throughput | PASS | 10/10 | 4ms | 100 docs in 2.5ms (40660 docs/sec) |
| 10.02.3 | Embedder — output dimensionality = 384 | PASS | 10/10 | 1ms | dim=384 (expected 384) |
| 10.03.1 | BAPCodec — small message 1000 roundtrips | PASS | 10/10 | 22ms | 45399 roundtrips/sec (22.0ms) |
| 10.03.2 | BAPCodec — 10KB message 500 roundtrips | PASS | 10/10 | 20ms | 24821 roundtrips/sec (20.1ms) |
| 10.03.3 | BAPCodec — 100KB message 100 roundtrips | PASS | 10/10 | 22ms | 4760 roundtrips/sec (21.0ms) |
| 10.03.4 | BAPCodec — compression ratio | PASS | 10/10 | 0ms | raw=12151B compressed=149B ratio=81.55x |
| 10.04.1 | MemoryHighway — 1000 messages single subscriber | PASS | 10/10 | 22ms | 159,893 msg/sec (6.3ms, received=1000) |
| 10.04.2 | MemoryHighway — 10 subscribers fan-out | PASS | 10/10 | 5ms | 1,184,694 deliveries/sec (500 msgs x 10 subs = 5000 in 4.2ms) |
| 10.04.3 | MemoryHighway — publish latency p50/p95 | PASS | 10/10 | 4ms | p50=0.0028ms p95=0.0081ms p99=0.0144ms |
| 10.05.1 | Registry — register 1000 agents | PASS | 10/10 | 4ms | 1000 agents in 3.9ms |
| 10.05.2 | Registry — findByCapability latency | PASS | 10/10 | 30ms | p50=0.2421ms p95=0.4161ms over 100 queries |
| 10.05.3 | Registry — findBySection latency | PASS | 10/10 | 12ms | p50=0.0147ms p95=0.1053ms over 100 queries |