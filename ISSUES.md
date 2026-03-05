# AETHER — Known Issues & Deferred Work

## PERSIST-01: All Runtime State Is In-Memory

**Status**: Deferred  
**Priority**: High  
**Category**: Data Persistence

### Problem

All runtime state — agent registry, escalation records, task history, execution logs, and circuit breaker state — exists only in memory. On process crash, restart, or shutdown:

- **Agent registry** must be re-discovered from disk (`.agent.md` files).
- **Escalation history** is lost — circuit breakers reset, no record of past failures.
- **Task execution history** vanishes — no audit trail, no replay capability.
- **Provider token usage** resets — budget tracking starts from zero each session.

### Impact

- Cannot resume interrupted workflows.
- No post-mortem analysis of failed tasks across sessions.
- Circuit breaker loses protective state — could immediately re-trigger known-bad patterns.
- Token budget tracking is per-session only — no cumulative cost visibility.

### Current Mitigation

- Logger writes structured logs to disk (`.aether/logs/synapse.log`) — provides some forensic data but not queryable state.
- Agent definitions persist via `.agent.md` files — registry can be reconstructed.

### Planned Resolution

User has an external persistence solution planned. This issue is logged for tracking purposes. The solution should provide:

1. **State serialization**: Save/restore registry, escalation, and task history.
2. **WAL or journaling**: Crash-safe state updates.
3. **Queryable storage**: Ability to query task history, token usage, and escalation patterns.
4. **Session continuity**: Resume workflows from last checkpoint after restart.

### Notes

- SQLite (via `bun:sqlite`) is the natural fit for Bun environments.
- Redis could handle hot state (circuit breakers, active task tracking).
- Both are referenced in the agent definitions (`redis-state-guard`, `postgres-db-architect`).

---

*Created: 2026-02-21*  
*Last Updated: 2026-02-21*
