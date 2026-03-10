# Hooks System — Integration Notes

## Architecture

```
core/hooks/
├── schema.ts        # Types, validation, defaults, prompt interpolation
├── yaml-parser.ts   # Minimal YAML parser (for hook template files)
├── event-bus.ts     # Typed pub/sub event system
├── debounce.ts      # Debounce + rate limiting + queue management
├── dispatcher.ts    # Prepares HookTaskRequest, manages dispatch lifecycle
├── registry.ts      # Loads, stores, matches, enables/disables hooks
└── index.ts         # Barrel export
```

## How to Wire File Watchers (VS Code Extension)

In the VS Code extension, use `vscode.workspace.onDidSaveTextDocument` and similar events
to feed the hook system:

```typescript
import { HookRegistry, DebounceManager, BackgroundDispatcher, EventBus } from './core/hooks';
import type { HookFileEvent } from './core/hooks';

// Initialize
const bus = new EventBus();
const registry = new HookRegistry(bus);
const debounce = new DebounceManager(bus);
const dispatcher = new BackgroundDispatcher(bus);

// Load hooks from .aether/hooks/
await registry.loadFromDirectory(path.join(workspaceRoot, '.aether', 'hooks'));

// Wire VS Code events
vscode.workspace.onDidSaveTextDocument((doc) => {
  const filePath = vscode.workspace.asRelativePath(doc.uri);
  const event: HookFileEvent = { type: 'file_save', filePath, timestamp: Date.now() };
  const hooks = registry.getMatchingHooks('file_save', filePath);

  for (const hook of hooks) {
    debounce.schedule(hook.name, event, hook.debounce ?? 2000, async () => {
      await dispatcher.dispatch(hook, event);
    });
  }
});

vscode.workspace.onDidCreateFiles((e) => {
  for (const file of e.files) {
    const filePath = vscode.workspace.asRelativePath(file);
    const event: HookFileEvent = { type: 'file_create', filePath, timestamp: Date.now() };
    // ... same pattern
  }
});

vscode.workspace.onDidDeleteFiles((e) => { /* file_delete */ });
vscode.workspace.onDidRenameFiles((e) => { /* file_rename */ });
```

For `git_commit` and `git_push`, use a `fs.watch` on the `.git` directory or
shell out to `git log` on a timer.

## How to Wire Dispatcher to core/executor.ts

The dispatcher does NOT call the executor directly. Register a callback:

```typescript
import { BackgroundDispatcher } from './core/hooks';
import { submitTask } from './core/executor'; // existing AETHER executor

const dispatcher = new BackgroundDispatcher(bus);

dispatcher.onDispatch(async (request) => {
  // Map HookTaskRequest to AETHER's TaskRequest
  const result = await submitTask({
    id: request.id,
    description: request.task,
    requester: request.from,       // "hook-system"
    target: request.to ?? 'general',
    priority: request.priority,
    context: request.context ?? {},
  });

  return {
    output: result.output,
    error: result.error,
  };
});
```

## How to Add CLI Commands

Add these to `bin/aether.ts` command routing:

### `hooks list`
```typescript
import { HookRegistry } from './core/hooks';

const registry = new HookRegistry();
await registry.loadFromDirectory('.aether/hooks');
const hooks = registry.listHooks();

for (const hook of hooks) {
  console.log(`${hook.enabled ? '✓' : '✗'} ${hook.name} — ${hook.trigger.event} ${hook.trigger.pattern ?? '*'}`);
}
```

### `hooks enable <name>` / `hooks disable <name>`
```typescript
registry.enableHook(name);  // returns boolean
registry.disableHook(name); // returns boolean
```

### `hooks test <name>`
Dry-run a hook with a synthetic event:
```typescript
const hook = registry.getHook(name);
if (!hook) { console.error('Hook not found'); return; }

const event: HookFileEvent = {
  type: hook.trigger.event,
  filePath: 'test/example.ts',
  timestamp: Date.now(),
};

const dispatcher = new BackgroundDispatcher();
const result = await dispatcher.dispatch(hook, event);
console.log(`Status: ${result.status}, Output: ${result.output}`);
```

## Hook File Formats

**Canonical: JSON** (`.json` extension)
- Reliable parsing, no ambiguity
- Example: `templates/hooks/auto-test.yaml` (actually JSON content with .yaml extension for discoverability)

**Optional: YAML** (`.yaml` / `.yml`)
- Parsed by `core/hooks/yaml-parser.ts` (minimal subset)
- Supports: key-value, nested objects, arrays (`- item`), booleans, numbers, inline arrays

## Event Flow

```
File Event → Registry.getMatchingHooks() → DebounceManager.schedule() → BackgroundDispatcher.dispatch()
                                                                              ↓
                                                                     onDispatch callback
                                                                              ↓
                                                                     core/executor.ts
```

## Key Design Decisions

1. **Zero external deps** — uses only Bun builtins (`Bun.Glob`, `fs/promises`, timers)
2. **Dispatcher is decoupled** — `onDispatch()` callback pattern lets the integration layer wire actual execution
3. **JSON as canonical format** — YAML parser is optional; JSON is more reliable for machine-generated hooks
4. **Debounce + queue** — prevents rapid-fire hook execution; max 10 queued per hook
5. **Timeout vs Cancel distinction** — dispatcher tracks whether abort was from timeout or manual cancel
