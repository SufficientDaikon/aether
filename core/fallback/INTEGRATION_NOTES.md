# Integration Notes — `core/fallback`

These modules provide model-level fallback logic for the AETHER provider layer.
Import via the barrel `core/fallback/index.ts` or individually.

---

## `FallbackChainManager` (`chain-manager.ts`)

Wire into `providers/manager.ts` or `core/executor.ts` to replace the current
direct model invocation with a chain-aware wrapper.

### Setup in `providers/manager.ts`

```typescript
import { FallbackChainManager } from "../core/fallback/chain-manager.ts";

const fallbackManager = new FallbackChainManager({
  chains: {
    master:  ["claude-opus-4-6",  "gpt-4o",      "gemini-2.5-pro"],
    manager: ["claude-sonnet-4",  "gpt-4o-mini",  "llama3.1:70b"],
    worker:  ["claude-haiku",     "gpt-4o-mini",  "local"],
  },
});
```

### Usage in `core/executor.ts`

```typescript
// Replace direct provider.send() with:
const response = await fallbackManager.executeWithFallback(
  agent.tier,
  model => providerManager.sendToModel(model, prompt, options)
);
```

### Dynamic chain updates (e.g. from `core/config.ts`)

```typescript
fallbackManager.setChain("worker", config.fallback.workerChain);
```

---

## `MODEL_EQUIVALENCE` / `getEquivalentModel` (`model-equivalence.ts`)

Use in `core/router.ts` to resolve an agent's `llmRequirement` (an `LLMModelTier`)
to a concrete model string.

```typescript
import { getEquivalentModel } from "../core/fallback/model-equivalence.ts";
import type { LLMModelTier } from "../core/types.ts";

// In router.ts — select a concrete model for an agent:
function resolveModel(tier: LLMModelTier, preferredProvider?: string): string {
  // For tiers that map directly (opus/sonnet/haiku):
  const model = getEquivalentModel(tier as any, preferredProvider);
  return model ?? tier; // fall back to tier name itself as model ID
}
```

---

## `FallbackLogger` (`logger.ts`)

Create a single shared instance and pass it into the provider layer.

### Shared singleton

```typescript
// In core/runtime.ts or providers/manager.ts:
import { FallbackLogger } from "../core/fallback/logger.ts";
export const fallbackLogger = new FallbackLogger();
```

### Logging a fallback event

```typescript
const start = Date.now();
try {
  return await currentModel.send(prompt);
} catch (err) {
  fallbackLogger.log({
    originalModel: currentModel.id,
    fallbackModel: nextModel.id,
    reason: err instanceof Error ? err.message : String(err),
    timestamp: Date.now(),
    latency: Date.now() - start,
  });
  // continue to next model in chain ...
}
```

### Skipping degraded models

```typescript
// In FallbackChainManager integration:
const healthyChain = chain.filter(model => !fallbackLogger.isDegraded(model));
if (healthyChain.length === 0) {
  throw new Error("All models in chain are currently degraded");
}
```

### Exposing stats via MCP

```typescript
// In bin/aether-mcp.ts — the get_status tool handler:
const stats = fallbackLogger.getStats();
return {
  totalFallbacks: stats.totalEvents,
  degradedModels: Object.entries(stats.modelStats)
    .filter(([, s]) => s.isDegraded)
    .map(([model]) => model),
};
```

---

## Barrel import

```typescript
import {
  FallbackChainManager,
  MODEL_EQUIVALENCE,
  getEquivalentModel,
  getEquivalentModels,
  getTierForModel,
  FallbackLogger,
} from "../core/fallback/index.ts";
```
