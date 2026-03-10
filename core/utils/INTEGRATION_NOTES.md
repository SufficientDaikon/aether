# Integration Notes — `core/utils`

These utilities are self-contained modules with no external dependencies.
Import them directly or via the barrel `core/utils/index.ts`.

---

## `retryWithBackoff` (`retry.ts`)

Wire into LLM provider call sites or any network operation that may transiently fail.

### In `providers/manager.ts`

```typescript
import { retryWithBackoff } from "../core/utils/retry.ts";

// Wrap the raw provider .send() call:
const response = await retryWithBackoff(
  () => provider.send(prompt, options),
  {
    maxRetries: 3,
    baseDelay: 1000,
    onRetry: (attempt, err, delay) =>
      logger.warn(`[${provider.name}] retry #${attempt} in ${delay}ms — ${err.message}`),
  }
);
```

### In `providers/copilot.ts` / `providers/ollama.ts`

Add the `sleepFn` option only in unit tests to avoid real delays:

```typescript
// In tests:
import { retryWithBackoff } from "../../core/utils/retry.ts";
const result = await retryWithBackoff(fn, { baseDelay: 1, sleepFn: async () => {} });
```

---

## `GitHubRateLimiter` (`rate-limit.ts`)

Wire into any module that calls the GitHub REST API (e.g. `core/rag-index.ts`,
`nexus/` GitHub integration code).

```typescript
import { GitHubRateLimiter } from "../core/utils/rate-limit.ts";

// Create one instance per token/credential scope:
const rateLimiter = new GitHubRateLimiter({ threshold: 50 });

// After every GitHub API call:
const res = await fetch("https://api.github.com/repos/...", { headers });
await rateLimiter.checkResponse(Object.fromEntries(res.headers));
const data = await res.json();
```

---

## `processBatch` (`batch.ts`)

Wire into bulk operations in `core/executor.ts` or any agent that must process
many items without overwhelming downstream services.

```typescript
import { processBatch } from "../core/utils/batch.ts";
import { SynapseLogger } from "../core/logger.ts";

const logger = new SynapseLogger("BatchRunner");

const result = await processBatch(
  agentTaskList,
  task => executor.run(task),
  {
    batchSize: 5,
    delayBetweenBatches: 500,
    onBatchComplete: (i, results) => {
      const failures = results.filter(r => !r.success);
      if (failures.length) logger.warn(`Batch ${i}: ${failures.length} failures`);
    },
  }
);

logger.info(`Done: ${result.successCount}/${result.totalProcessed} succeeded`);
```

---

## Barrel import

```typescript
import { retryWithBackoff, GitHubRateLimiter, processBatch } from "../core/utils/index.ts";
```
