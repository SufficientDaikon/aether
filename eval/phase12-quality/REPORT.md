# Phase 12: Quality Benchmarks -- Evaluation Report

**Run:** 2026-03-07T22:59:19.007Z to 2026-03-07T22:59:19.198Z
**Results:** 15 passed, 0 failed, 0 skipped, 0 errors out of 15 tests
**Score:** 144 / 150 (96.0%)

---

## Results

| # | Test | Status | Score | Duration | Details |
|---|------|--------|-------|----------|---------|
| 12.01.1 | Routing — react task routes to react-specialist | PASS | 10/10 | 32ms | routed to react-specialist expected react-specialist |
| 12.01.2 | Routing — SQL task routes to backend agent | PASS | 7/10 | 31ms | routed to playwright-tester expected postgres-db-architect |
| 12.01.3 | Routing — security task routes to code-hardener | PASS | 10/10 | 33ms | routed to code-hardener expected code-hardener |
| 12.01.4 | Routing — testing task routes to tester agent | PASS | 7/10 | 30ms | routed to system-architect expected playwright-tester |
| 12.01.5 | Routing — batch accuracy >= 4/6 | PASS | 10/10 | 30ms | batch accuracy: 5/6 |
| 12.01.6 | Routing — unknown task gets load-balanced (not null) | PASS | 10/10 | 27ms | result=playwright-tester strategy=load-balance |
| 12.02.1 | Guardrails — safe prompts not blocked (low FP rate) | PASS | 10/10 | 1ms | false positives: 0/10 (FP rate: 0.0%) |
| 12.02.2 | Guardrails — malicious prompts blocked (low FN rate) | PASS | 10/10 | 0ms | false negatives: 0/10 (FN rate: 0.0%) |
| 12.02.3 | Guardrails — F1 score >= 0.9 | PASS | 10/10 | 1ms | F1=1.000 precision=1.000 recall=1.000 TP=5 FP=0 FN=0 |
| 12.03.1 | Workflow — sequential chain builds correctly | PASS | 10/10 | 1ms | steps=3 sequential=true deps=true |
| 12.03.2 | Workflow — parallel fan-out groups steps | PASS | 10/10 | 0ms | steps=3 allParallel=true hasGroup=true |
| 12.03.3 | Workflow — build rejects empty workflow | PASS | 10/10 | 0ms | empty build threw: true |
| 12.04.1 | Conflict — majority-vote picks centroid output | PASS | 10/10 | 1ms | strategy=majority-vote picked react=true |
| 12.04.2 | Conflict — weighted-by-tier picks highest tier | PASS | 10/10 | 0ms | strategy=weighted-by-tier pickedMaster=true |
| 12.04.3 | Conflict — merge combines outputs | PASS | 10/10 | 0ms | strategy=merge merged output length=140 (longer than single: true) |