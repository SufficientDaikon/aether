# Phase 1 — Baseline Environment -- Evaluation Report

**Run:** 2026-03-07T22:54:49.546Z to 2026-03-07T22:57:06.695Z
**Results:** 5 passed, 0 failed, 0 skipped, 3 errors out of 8 tests
**Score:** 34 / 34 (100.0%)

---

## Results

| # | Test | Status | Score | Duration | Details |
|---|------|--------|-------|----------|---------|
| 1.1 | Bun version >= 1.1.0 | PASS | -- | 0ms | Bun 1.3.9 detected |
| 1.2 | Critical dependencies present | PASS | -- | 0ms | All critical dependencies found: msgpackr, sqlite-vec |
| 1.3 | Config file exists | PASS | -- | 1ms | Found .aether/config.json |
| 1.4 | SQLiteStore boots in-memory | PASS | -- | 50ms | SQLiteStore constructed, initialized, and closed without error |
| 1.5 | Agent definition discovery | PASS | 34/34 | 2ms | Discovered 34 agent definition(s) under agents/ |
| 1.6 | Existing unit tests pass | ERROR | -- | 16544ms | bun test exited with code 1. Parsed: 722 pass, 4 fail. Output (last 500 chars): s\federation.ts                          |
| 1.7 | Simulation test passes | ERROR | -- | 472ms | Simulation exited with code 1. Output (last 500 chars): m ms  623 \|  624 \| // Serialization round-trip 625 \| const se |
| 1.8 | E2E executor test passes | ERROR | -- | 120077ms | Process timed out after 120000ms Error: Process timed out after 120000ms     at <anonymous> (H:\aether\eval\phase1-basel |

---

## Error Details

### 1.6: Existing unit tests pass
```
bun test exited with code 1. Parsed: 722 pass, 4 fail.
Output (last 500 chars): s\federation.ts                                      |    0.00 |    2.37 | 30-203,210-236,242-246
 transports\manager.ts                                         |   70.00 |   81.25 | 155-172
 transports\mcp.ts                                             |    0.00 |    1.94 | 36-220,226-283,287-369,375-395,399-405
---------------------------------------------------------------|---------|---------|-------------------

 722 pass
 4 fail
 1833 expect() calls
Ran 726 tests across 101 files. [16.42s]

Error: bun test exited with code 1. Parsed: 722 pass, 4 fail.
Output (last 500 chars): s\federation.ts                                      |    0.00 |    2.37 | 30-203,210-236,242-246
 transports\manager.ts                                         |   70.00 |   81.25 | 155-172
 transports\mcp.ts                                             |    0.00 |    1.94 | 36-220,226-283,287-369,375-395,399-405
---------------------------------------------------------------|---------|---------|-------------------

 722 pass
 4 fail
 1833 expect() calls
Ran 726 tests across 101 files. [16.42s]

    at <anonymous> (H:\aether\eval\phase1-baseline\run.ts:221:17)
    at async runTest (H:\aether\eval\helpers\test-harness.ts:67:29)
    at async run (H:\aether\eval\phase1-baseline\run.ts:204:17)
    at async main (H:\aether\eval\run-all.ts:117:38)
    at processTicksAndRejections (native:7:39)
```

### 1.7: Simulation test passes
```
Simulation exited with code 1.
Output (last 500 chars): m ms

623 | 
624 | // Serialization round-trip
625 | const serResult = bench(
626 |   "Serialize + deserialize registry",
627 |   () => {
628 |     const json = registry.toJSON();
                                ^
TypeError: registry.toJSON is not a function. (In 'registry.toJSON()', 'registry.toJSON' is undefined)
      at <anonymous> (H:\aether\tests\simulation.ts:628:27)
      at bench (H:\aether\tests\simulation.ts:74:3)
      at H:\aether\tests\simulation.ts:625:19

Bun v1.3.9 (Windows x64)
Error: Simulation exited with code 1.
Output (last 500 chars): m ms

623 | 
624 | // Serialization round-trip
625 | const serResult = bench(
626 |   "Serialize + deserialize registry",
627 |   () => {
628 |     const json = registry.toJSON();
                                ^
TypeError: registry.toJSON is not a function. (In 'registry.toJSON()', 'registry.toJSON' is undefined)
      at <anonymous> (H:\aether\tests\simulation.ts:628:27)
      at bench (H:\aether\tests\simulation.ts:74:3)
      at H:\aether\tests\simulation.ts:625:19

Bun v1.3.9 (Windows x64)
    at <anonymous> (H:\aether\eval\phase1-baseline\run.ts:250:17)
    at async runTest (H:\aether\eval\helpers\test-harness.ts:67:29)
    at async run (H:\aether\eval\phase1-baseline\run.ts:237:17)
    at async main (H:\aether\eval\run-all.ts:117:38)
    at processTicksAndRejections (native:7:39)
```

### 1.8: E2E executor test passes
```
Process timed out after 120000ms
Error: Process timed out after 120000ms
    at <anonymous> (H:\aether\eval\phase1-baseline\run.ts:59:18)
```