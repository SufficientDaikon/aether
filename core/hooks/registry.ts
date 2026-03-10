/**
 * HookRegistry — loads, manages, and matches hook definitions.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import {
  type HookDefinition,
  type HookEvent,
  type HookFileEvent,
  validateHookDefinition,
} from './schema.js';
import { parseYaml } from './yaml-parser.js';
import { EventBus } from './event-bus.js';

export class HookRegistry {
  private hooks = new Map<string, HookDefinition>();
  private hooksDir: string = '';
  private eventBus: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus ?? new EventBus();
  }

  /** Load all hook files from a directory. Supports .json and .yaml/.yml. */
  async loadFromDirectory(hooksDir: string): Promise<{
    loaded: string[];
    errors: { file: string; error: string }[];
  }> {
    this.hooksDir = hooksDir;
    const loaded: string[] = [];
    const errors: { file: string; error: string }[] = [];

    let entries: string[];
    try {
      entries = await readdir(hooksDir);
    } catch {
      return { loaded, errors: [{ file: hooksDir, error: 'Directory not found or not readable' }] };
    }

    const hookFiles = entries.filter((f) => {
      const ext = extname(f).toLowerCase();
      return ext === '.json' || ext === '.yaml' || ext === '.yml';
    });

    for (const file of hookFiles) {
      const filePath = join(hooksDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const ext = extname(file).toLowerCase();

        let parsed: unknown;
        if (ext === '.json') {
          parsed = JSON.parse(content);
        } else {
          parsed = parseYaml(content);
        }

        const result = validateHookDefinition(parsed);
        if (result.valid && result.hook) {
          this.hooks.set(result.hook.name, result.hook);
          loaded.push(result.hook.name);
          this.eventBus.emit({ type: 'hook:registered', hook: result.hook });
        } else {
          const msgs = result.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
          errors.push({ file, error: `Validation failed: ${msgs}` });
        }
      } catch (err) {
        errors.push({ file, error: `Parse error: ${(err as Error).message}` });
      }
    }

    return { loaded, errors };
  }

  /** Hot-reload — re-scan the hooks directory. */
  async reload(): Promise<{
    loaded: string[];
    errors: { file: string; error: string }[];
  }> {
    if (!this.hooksDir) {
      return { loaded: [], errors: [{ file: '', error: 'No hooks directory set. Call loadFromDirectory first.' }] };
    }
    this.hooks.clear();
    return this.loadFromDirectory(this.hooksDir);
  }

  /** Register a hook definition directly (e.g., from code). */
  register(hook: HookDefinition): void {
    this.hooks.set(hook.name, hook);
    this.eventBus.emit({ type: 'hook:registered', hook });
  }

  /** Get all hooks whose trigger matches the given event and optional file path. */
  getMatchingHooks(event: HookEvent, filePath?: string): HookDefinition[] {
    const matched: HookDefinition[] = [];

    for (const hook of this.hooks.values()) {
      if (!hook.enabled) continue;
      if (hook.trigger.event !== event) continue;

      // Glob pattern matching
      if (filePath && hook.trigger.pattern) {
        const glob = new Bun.Glob(hook.trigger.pattern);
        if (!glob.match(filePath)) continue;
      }

      // Exclude patterns
      if (filePath && hook.trigger.exclude) {
        const excludes = Array.isArray(hook.trigger.exclude)
          ? hook.trigger.exclude
          : [hook.trigger.exclude];
        let excluded = false;
        for (const pattern of excludes) {
          const glob = new Bun.Glob(pattern);
          if (glob.match(filePath)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
      }

      matched.push(hook);
    }

    return matched;
  }

  /** Enable a hook by name. Returns false if hook not found. */
  enableHook(name: string): boolean {
    const hook = this.hooks.get(name);
    if (!hook) return false;
    hook.enabled = true;
    this.eventBus.emit({ type: 'hook:enabled', hookName: name });
    return true;
  }

  /** Disable a hook by name. Returns false if hook not found. */
  disableHook(name: string): boolean {
    const hook = this.hooks.get(name);
    if (!hook) return false;
    hook.enabled = false;
    this.eventBus.emit({ type: 'hook:disabled', hookName: name });
    return true;
  }

  /** Get a hook by name. */
  getHook(name: string): HookDefinition | undefined {
    return this.hooks.get(name);
  }

  /** List all registered hooks. */
  listHooks(): HookDefinition[] {
    return Array.from(this.hooks.values());
  }

  /** Remove a hook by name. */
  removeHook(name: string): boolean {
    const existed = this.hooks.delete(name);
    if (existed) {
      this.eventBus.emit({ type: 'hook:unregistered', hookName: name });
    }
    return existed;
  }

  /** Get the EventBus instance. */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /** Number of registered hooks. */
  get size(): number {
    return this.hooks.size;
  }
}
