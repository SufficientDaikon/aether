# Powers System — Integration Notes

This document explains how to wire the Powers (plugin) system into the rest of AETHER.

## Architecture Overview

The Powers system is self-contained in `core/powers/` and returns **pending actions** rather than directly modifying configuration files. The integration layer is responsible for applying these actions.

```
┌─────────────────┐    ┌──────────────┐    ┌───────────────┐
│  PowerInstaller  │───▶│ InstallResult │───▶│  Integration  │
│  .install()      │    │ pendingActions│    │    Layer      │
│  .remove()       │    └──────────────┘    │               │
└─────────────────┘                         │ • MCP config  │
                                            │ • Steering    │
┌─────────────────┐    ┌──────────────┐    │ • Hooks       │
│  PowerRegistry   │───▶│ActivationRes │───▶│ • Prompts     │
│  .activateFor    │    │ .activated[] │    └───────────────┘
│   Context()      │    │ .reasons     │
└─────────────────┘    └──────────────┘
```

## 1. Wiring MCP Config

When `InstallResult.pendingActions.mcpRegistration` is present, add the MCP server to `.aether/config.json`:

```typescript
import { readFile, writeFile } from "node:fs/promises";

async function applyMcpRegistration(
  configPath: string,
  reg: InstallResult["pendingActions"]["mcpRegistration"]
) {
  if (!reg) return;
  const config = JSON.parse(await readFile(configPath, "utf-8"));
  config.mcpServers = config.mcpServers || {};
  config.mcpServers[reg.name] = {
    command: reg.command,
    args: reg.args,
    env: reg.env,
    ...(reg.config ? { config: reg.config } : {}),
  };
  await writeFile(configPath, JSON.stringify(config, null, 2));
}
```

For removal, delete the key from `config.mcpServers`.

## 2. Wiring Activation into Agent Prompt Building

Call `PowerRegistry.activateForContext()` before building the agent prompt:

```typescript
import { PowerRegistry, type ConversationContext } from "./core/powers/index.ts";

const registry = new PowerRegistry();
await registry.loadInstalled(".aether/powers");

const context: ConversationContext = {
  messages: conversation.messages.map(m => m.content),
  openFiles: editor.getOpenFiles(),
  explicitPowers: userSelectedPowers,
};

const { activated, reasons } = registry.activateForContext(context);

// Inject steering content into system prompt
for (const power of activated) {
  if (power.manifest.steering) {
    for (const file of power.manifest.steering) {
      const steeringPath = join(power.installPath, file);
      const content = await readFile(steeringPath, "utf-8");
      systemPrompt += `\n\n<!-- Power: ${power.manifest.name} -->\n${content}`;
    }
  }
}
```

## 3. Wiring Hooks

Pass `pendingActions.hookFiles` to the hooks system for registration:

```typescript
// On install:
for (const hookFile of result.pendingActions.hookFiles) {
  await hooksSystem.register(hookFile);
}

// On remove:
for (const hookFile of result.pendingActions.hookFiles) {
  await hooksSystem.unregister(hookFile);
}
```

## 4. Adding CLI Commands

Add subcommands to the AETHER CLI in `bin/aether.ts`:

```typescript
import { PowerInstaller, PowerRegistry } from "../core/powers/index.ts";

// aether power install <source>
case "power": {
  const subcommand = args[1]; // install | remove | list | search
  const powersDir = join(workspaceRoot, ".aether", "powers");
  const installer = new PowerInstaller();
  const registry = new PowerRegistry();

  switch (subcommand) {
    case "install": {
      const source = args[2];
      const result = await installer.install(source, powersDir);
      console.log(`Installed ${result.power.manifest.name}@${result.power.manifest.version}`);
      // Apply pending actions (MCP config, hooks, etc.)
      break;
    }
    case "remove": {
      const name = args[2];
      const result = await installer.remove(name, powersDir);
      if (result.warnings.length) result.warnings.forEach(w => console.warn(`⚠ ${w}`));
      console.log(`Removed ${name}`);
      break;
    }
    case "list": {
      await registry.loadInstalled(powersDir);
      for (const p of registry.getInstalled()) {
        console.log(`  ${p.manifest.name}@${p.manifest.version} — ${p.manifest.description}`);
      }
      break;
    }
    case "search": {
      const query = args[2];
      await registry.loadInstalled(powersDir);
      for (const p of registry.search(query)) {
        console.log(`  ${p.manifest.name} — ${p.manifest.description}`);
      }
      break;
    }
  }
  break;
}
```

## 5. Steering System Integration

Pass `pendingActions.steeringFiles` to the steering system:

```typescript
// On install:
for (const steeringFile of result.pendingActions.steeringFiles) {
  await steeringSystem.register(steeringFile);
}

// On remove:
for (const steeringFile of result.pendingActions.steeringFiles) {
  await steeringSystem.unregister(steeringFile);
}
```

## 6. File Structure After Installation

```
.aether/
├── config.json           # MCP servers added here
├── powers/
│   ├── registry.json     # Tracks installed powers & metadata
│   ├── react-power/
│   │   ├── power.json
│   │   ├── steering.md
│   │   └── hooks/
│   └── postgres-power/
│       ├── power.json
│       └── steering.md
```

## Key Design Decisions

- **No direct config mutation**: The installer returns `pendingActions` instead of modifying `.aether/config.json`. This keeps the powers system decoupled and testable.
- **Zero external dependencies**: All matching (keywords, globs) is implemented with built-in RegExp.
- **Rollback on failure**: If installation fails after copying files, the copied directory is cleaned up.
- **Dependent power warnings**: Removal warns (but does not block) when other powers depend on the removed one.
