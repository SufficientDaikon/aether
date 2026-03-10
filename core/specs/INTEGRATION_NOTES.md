# Specs System — Integration Notes

## How to Add CLI Commands to `bin/aether.ts`

The specs system provides spec-driven development operations.
Here's how to wire the CLI commands:

### 1. Import the Specs Module

```typescript
import {
  createSpec,
  listSpecs,
  loadSpec,
  validateSpecByPath,
  updateTaskStatus,
} from "../core/specs/index.ts";
```

### 2. Add CLI Commands

```typescript
// aether spec create <name> [--description "..."]
case "spec":
  const subCmd = args[1]; // create | list | validate | status
  const workspace = process.cwd();

  switch (subCmd) {
    case "create": {
      const name = args[2];
      const desc = flags.description || flags.d;
      const info = createSpec(workspace, name, desc);
      console.log(`Created spec: ${info.name} at ${info.path}`);
      break;
    }
    case "list": {
      const specs = listSpecs(workspace);
      for (const s of specs) {
        console.log(`${s.name} [R:${s.hasRequirements} D:${s.hasDesign} T:${s.hasTasks}]`);
      }
      break;
    }
    case "validate": {
      const specName = args[2];
      const specPath = join(workspace, ".aether", "specs", specName);
      const result = validateSpecByPath(specPath);
      console.log(`Valid: ${result.valid}`);
      result.errors.forEach(e => console.error(`  ERROR: ${e}`));
      result.warnings.forEach(w => console.warn(`  WARN: ${w}`));
      break;
    }
    case "done":
    case "fail": {
      const specName = args[2];
      const taskId = args[3];
      const status = subCmd === "done" ? "done" : "failed";
      const specPath = join(workspace, ".aether", "specs", specName);
      updateTaskStatus(specPath, taskId, status);
      console.log(`Task ${taskId} marked as ${status}`);
      break;
    }
  }
  break;
```

### 3. Agent Integration

When an agent is working on a spec, the executor can:

```typescript
// Load spec context for the agent's system prompt
const spec = loadSpec(specPath);
const taskContext = `Active tasks: ${spec.tasks
  .flatMap(t => t.subtasks.filter(s => s.status === 'pending'))
  .map(s => `${s.id}: ${s.title}`)
  .join(', ')}`;

// After task completion, update status
updateTaskStatus(specPath, taskId, 'done');
```

### 4. Spec Validation in CI

```typescript
// Validate all specs in the workspace
const specs = listSpecs(workspace);
let allValid = true;
for (const spec of specs) {
  const result = validateSpecByPath(spec.path);
  if (!result.valid) {
    allValid = false;
    console.error(`Spec ${spec.name} has errors:`);
    result.errors.forEach(e => console.error(`  ${e}`));
  }
}
process.exit(allValid ? 0 : 1);
```
