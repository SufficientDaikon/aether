import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HookRegistry } from '../../core/hooks/registry.js';
import { EventBus } from '../../core/hooks/event-bus.js';
import type { HookDefinition } from '../../core/hooks/schema.js';

// ── Helper ───────────────────────────────────────────────────────────
function makeHookJson(overrides?: Partial<HookDefinition>): string {
  return JSON.stringify({
    name: 'test-hook',
    trigger: { event: 'file_save', pattern: 'src/**/*.ts' },
    action: { agent: 'test-agent', prompt: 'test prompt', mode: 'background' },
    ...overrides,
  });
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'aether-hooks-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Loading tests ────────────────────────────────────────────────────
describe('HookRegistry.loadFromDirectory', () => {
  it('loads a valid JSON hook file', async () => {
    await writeFile(join(tempDir, 'test.json'), makeHookJson());
    const registry = new HookRegistry();
    const result = await registry.loadFromDirectory(tempDir);

    expect(result.loaded).toEqual(['test-hook']);
    expect(result.errors).toHaveLength(0);
    expect(registry.size).toBe(1);
  });

  it('loads multiple hook files', async () => {
    await writeFile(join(tempDir, 'a.json'), makeHookJson({ name: 'hook-a' }));
    await writeFile(join(tempDir, 'b.json'), makeHookJson({ name: 'hook-b' }));
    const registry = new HookRegistry();
    const result = await registry.loadFromDirectory(tempDir);

    expect(result.loaded).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it('reports errors for invalid hook files', async () => {
    await writeFile(join(tempDir, 'bad.json'), '{"name": ""}');
    const registry = new HookRegistry();
    const result = await registry.loadFromDirectory(tempDir);

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('reports error for malformed JSON', async () => {
    await writeFile(join(tempDir, 'bad.json'), '{not json}');
    const registry = new HookRegistry();
    const result = await registry.loadFromDirectory(tempDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Parse error');
  });

  it('ignores non-hook files', async () => {
    await writeFile(join(tempDir, 'readme.md'), '# hello');
    await writeFile(join(tempDir, 'test.json'), makeHookJson());
    const registry = new HookRegistry();
    const result = await registry.loadFromDirectory(tempDir);

    expect(result.loaded).toEqual(['test-hook']);
  });

  it('handles non-existent directory', async () => {
    const registry = new HookRegistry();
    const result = await registry.loadFromDirectory('/nonexistent/path');

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});

// ── Reload tests ─────────────────────────────────────────────────────
describe('HookRegistry.reload', () => {
  it('re-scans the directory', async () => {
    await writeFile(join(tempDir, 'a.json'), makeHookJson({ name: 'hook-a' }));
    const registry = new HookRegistry();
    await registry.loadFromDirectory(tempDir);
    expect(registry.size).toBe(1);

    await writeFile(join(tempDir, 'b.json'), makeHookJson({ name: 'hook-b' }));
    await registry.reload();
    expect(registry.size).toBe(2);
  });

  it('errors if loadFromDirectory was never called', async () => {
    const registry = new HookRegistry();
    const result = await registry.reload();
    expect(result.errors).toHaveLength(1);
  });
});

// ── Matching tests ───────────────────────────────────────────────────
describe('HookRegistry.getMatchingHooks', () => {
  it('matches by event type', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'file-hook',
      enabled: true,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save')).toHaveLength(1);
    expect(registry.getMatchingHooks('git_commit')).toHaveLength(0);
  });

  it('matches by glob pattern', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'ts-hook',
      enabled: true,
      trigger: { event: 'file_save', pattern: 'src/**/*.ts' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save', 'src/foo.ts')).toHaveLength(1);
    expect(registry.getMatchingHooks('file_save', 'src/bar/baz.ts')).toHaveLength(1);
    expect(registry.getMatchingHooks('file_save', 'lib/foo.ts')).toHaveLength(0);
  });

  it('excludes by exclude pattern (string)', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'exclude-hook',
      enabled: true,
      trigger: { event: 'file_save', pattern: '**/*.ts', exclude: '**/*.test.ts' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save', 'src/foo.ts')).toHaveLength(1);
    expect(registry.getMatchingHooks('file_save', 'src/foo.test.ts')).toHaveLength(0);
  });

  it('excludes by exclude pattern (array)', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'multi-exclude',
      enabled: true,
      trigger: { event: 'file_save', pattern: '**/*.ts', exclude: ['**/*.test.ts', '**/*.spec.ts'] },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save', 'src/foo.ts')).toHaveLength(1);
    expect(registry.getMatchingHooks('file_save', 'src/foo.test.ts')).toHaveLength(0);
    expect(registry.getMatchingHooks('file_save', 'src/foo.spec.ts')).toHaveLength(0);
  });

  it('skips disabled hooks', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'disabled-hook',
      enabled: false,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save')).toHaveLength(0);
  });

  it('returns multiple matching hooks', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'hook-a',
      enabled: true,
      trigger: { event: 'file_save', pattern: '**/*.ts' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });
    registry.register({
      name: 'hook-b',
      enabled: true,
      trigger: { event: 'file_save', pattern: '**/*.ts' },
      action: { agent: 'b', prompt: 'q', mode: 'notify', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save', 'src/x.ts')).toHaveLength(2);
  });
});

// ── Enable/Disable tests ─────────────────────────────────────────────
describe('HookRegistry.enableHook / disableHook', () => {
  it('disables and re-enables a hook', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'toggle-hook',
      enabled: true,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.getMatchingHooks('file_save')).toHaveLength(1);

    registry.disableHook('toggle-hook');
    expect(registry.getMatchingHooks('file_save')).toHaveLength(0);
    expect(registry.getHook('toggle-hook')!.enabled).toBe(false);

    registry.enableHook('toggle-hook');
    expect(registry.getMatchingHooks('file_save')).toHaveLength(1);
  });

  it('returns false for unknown hook name', async () => {
    const registry = new HookRegistry();
    expect(registry.enableHook('nope')).toBe(false);
    expect(registry.disableHook('nope')).toBe(false);
  });
});

// ── List/Remove tests ────────────────────────────────────────────────
describe('HookRegistry.listHooks / removeHook', () => {
  it('lists all hooks', () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'h1',
      enabled: true,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });
    registry.register({
      name: 'h2',
      enabled: true,
      trigger: { event: 'git_commit' },
      action: { agent: 'b', prompt: 'q', mode: 'notify', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    const hooks = registry.listHooks();
    expect(hooks).toHaveLength(2);
    expect(hooks.map((h) => h.name).sort()).toEqual(['h1', 'h2']);
  });

  it('removes a hook', () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'removable',
      enabled: true,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(registry.removeHook('removable')).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.removeHook('removable')).toBe(false);
  });
});

// ── EventBus integration ─────────────────────────────────────────────
describe('HookRegistry events', () => {
  it('emits hook:registered on register', () => {
    const bus = new EventBus();
    const registry = new HookRegistry(bus);
    const events: string[] = [];
    bus.on('hook:registered', () => events.push('registered'));

    registry.register({
      name: 'evt-hook',
      enabled: true,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    expect(events).toEqual(['registered']);
  });

  it('emits hook:enabled and hook:disabled', () => {
    const bus = new EventBus();
    const registry = new HookRegistry(bus);
    const events: string[] = [];
    bus.on('hook:enabled', () => events.push('enabled'));
    bus.on('hook:disabled', () => events.push('disabled'));

    registry.register({
      name: 'evt-hook',
      enabled: true,
      trigger: { event: 'file_save' },
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
      debounce: 2000,
      maxConcurrent: 1,
    });

    registry.disableHook('evt-hook');
    registry.enableHook('evt-hook');

    expect(events).toEqual(['disabled', 'enabled']);
  });
});
