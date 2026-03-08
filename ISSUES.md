# AETHER — Known Issues & Deferred Work

## PERSIST-01: All Runtime State Is In-Memory

**Status**: Resolved  
**Priority**: High  
**Category**: Data Persistence  
**Resolved**: 2026-03-08

### Problem

All runtime state — agent registry, escalation records, task history, execution logs, and circuit breaker state — originally existed only in memory.

### Resolution

SQLite persistence layer fully implemented and integrated:

1. **`core/storage/sqlite-store.ts`** — 19-table SQLite database (`.aether/aether.db`) with WAL mode, sqlite-vec for vector embeddings, and FTS5 for full-text search.
2. **State serialization**: Agent registry, escalation records, task history, conversations, entity knowledge, workflow checkpoints, and vector embeddings all persist across restarts.
3. **Session continuity**: Escalation state and circuit breaker records are restored from the store on startup via `loadFromStore()`.
4. **Queryable storage**: Task metrics, agent metrics, and vector search are all backed by SQLite queries.

---

*Created: 2026-02-21*  
*Last Updated: 2026-03-08*
