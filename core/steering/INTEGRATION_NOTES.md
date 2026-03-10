# Steering System — Integration Notes

## How to Wire into `core/executor.ts` Prompt Building

The steering system provides contextual instructions that should be injected into the
system prompt when an agent executes a task. Here's how to integrate:

### 1. Import the Steering Module

```typescript
import { loadSteering, compose } from "../steering/index.ts";
```

### 2. Load and Compose at Task Execution Time

In the executor's `execute()` method (or wherever the system prompt is built):

```typescript
// Load steering files from the workspace
const { files } = loadSteering(workspacePath);

// Compose steering context for the current agent, with a token budget
const steering = compose(files, agent.id, 4000);

// Inject into the system prompt
const systemPrompt = [
  agent.systemPrompt,
  steering.content ? `\n\n## Project Steering\n\n${steering.content}` : "",
].join("");
```

### 3. Token Budget Guidance

- Default budget: 4000 tokens (adjust per model context window)
- The composer automatically truncates lowest-priority files first
- Check `steering.truncated` to log when context was dropped

### 4. Scope Filtering

Files are automatically filtered by scope matching the agent ID.
A `frontend`-scoped steering file will only be injected for frontend agents.
`global` scope files are always included.

### 5. Priority Ordering

Higher priority files (1-10 scale) appear first in the composed output.
This ensures the most important project guidelines are preserved when truncation occurs.
