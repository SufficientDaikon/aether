# Phase 11: Integration Testing -- Evaluation Report

**Run:** 2026-03-07T22:58:54.468Z to 2026-03-07T22:59:18.995Z
**Results:** 19 passed, 0 failed, 0 skipped, 0 errors out of 19 tests
**Score:** 190 / 190 (100.0%)

---

## Results

| # | Test | Status | Score | Duration | Details |
|---|------|--------|-------|----------|---------|
| 11.01.1 | Runtime — constructor and init | PASS | 10/10 | 59ms | registry=true logger=true config=true |
| 11.01.2 | Runtime — subsystems initialized | PASS | 10/10 | 49ms | 4/4 non-store subsystems initialized |
| 11.01.3 | Runtime — store-backed subsystems | PASS | 10/10 | 50ms | 5/5 store-backed subsystems initialized |
| 11.01.4 | Runtime — clean shutdown | PASS | 10/10 | 48ms | server cleared after shutdown: true |
| 11.02.1 | Pipeline — router resolves correct agent | PASS | 10/10 | 31ms | routed to: react-specialist (strategy: section-fallback) |
| 11.02.2 | Pipeline — guardrails pre-check passes safe input | PASS | 10/10 | 1ms | allowed=true guardId=pipeline |
| 11.02.3 | Pipeline — guardrails blocks injection | PASS | 10/10 | 0ms | blocked=true reason=Potential prompt injection detected: ignore\s+(all\s+)?previous\s+instructions |
| 11.02.4 | Pipeline — schema validator extracts JSON | PASS | 10/10 | 0ms | valid=true parsed={"name":"test","count":42} |
| 11.03.1 | Escalation — worker to manager | PASS | 10/10 | 1ms | target=manager-1 circuitBroken=false |
| 11.03.2 | Escalation — manager to master | PASS | 10/10 | 0ms | target=mstr-a |
| 11.03.3 | Escalation — circuit breaker trips | PASS | 10/10 | 0ms | circuitBroken=true |
| 11.03.4 | Escalation — chain traversal (registry) | PASS | 10/10 | 1ms | chain=[chain-m → chain-x] length=2 |
| 11.04.1 | MCP Bridge — get_status tool | PASS | 10/10 | 6036ms | response contains status info: true (len=759) |
| 11.04.2 | MCP Bridge — query_agents tool | PASS | 10/10 | 6032ms | query_agents response relevant: true |
| 11.04.3 | MCP Bridge — switch_context tool | PASS | 10/10 | 6048ms | switch_context responded: true |
| 11.04.4 | MCP Bridge — invalid method returns error | PASS | 10/10 | 6027ms | error response for bad method: true |
| 11.05.1 | WebSocket — server starts and /health responds | PASS | 10/10 | 6ms | status=200 body.status=ok |
| 11.05.2 | WebSocket — client connects | PASS | 10/10 | 124ms | connected=true |
| 11.05.3 | WebSocket — /registry endpoint responds | PASS | 10/10 | 5ms | status=200 containsAgent=true |