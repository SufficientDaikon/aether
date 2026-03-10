import { describe, it, expect } from 'bun:test';
import {
  validateHookDefinition,
  interpolatePrompt,
  HOOK_EVENTS,
  HOOK_DEFAULTS,
  type HookFileEvent,
} from '../../core/hooks/schema.js';

// ── Helper: minimal valid hook object ────────────────────────────────
function validHook(overrides?: Record<string, unknown>) {
  return {
    name: 'test-hook',
    trigger: { event: 'file_save', pattern: '**/*.ts' },
    action: { agent: 'test-agent', prompt: 'Do something with ${filePath}', mode: 'background' },
    ...overrides,
  };
}

// ── Validation tests ─────────────────────────────────────────────────
describe('validateHookDefinition', () => {
  it('accepts a minimal valid hook', () => {
    const result = validateHookDefinition(validHook());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.hook).toBeDefined();
    expect(result.hook!.name).toBe('test-hook');
  });

  it('applies default values', () => {
    const result = validateHookDefinition(validHook());
    expect(result.hook!.enabled).toBe(HOOK_DEFAULTS.enabled);
    expect(result.hook!.debounce).toBe(HOOK_DEFAULTS.debounce);
    expect(result.hook!.maxConcurrent).toBe(HOOK_DEFAULTS.maxConcurrent);
    expect(result.hook!.action.mode).toBe(HOOK_DEFAULTS.actionMode);
    expect(result.hook!.action.timeout).toBe(HOOK_DEFAULTS.actionTimeout);
  });

  it('preserves explicit values over defaults', () => {
    const result = validateHookDefinition(
      validHook({ enabled: false, debounce: 5000, maxConcurrent: 3 }),
    );
    expect(result.hook!.enabled).toBe(false);
    expect(result.hook!.debounce).toBe(5000);
    expect(result.hook!.maxConcurrent).toBe(3);
  });

  it('rejects non-object input', () => {
    const result = validateHookDefinition('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('root');
  });

  it('rejects null input', () => {
    const result = validateHookDefinition(null);
    expect(result.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const { name, ...rest } = validHook();
    const result = validateHookDefinition(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects empty name', () => {
    const result = validateHookDefinition(validHook({ name: '  ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects missing trigger', () => {
    const { trigger, ...rest } = validHook();
    const result = validateHookDefinition({ ...rest, name: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'trigger')).toBe(true);
  });

  it('rejects invalid trigger event', () => {
    const result = validateHookDefinition(
      validHook({ trigger: { event: 'invalid_event' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'trigger.event')).toBe(true);
  });

  it('validates all event types', () => {
    for (const event of HOOK_EVENTS) {
      const result = validateHookDefinition(
        validHook({ trigger: { event } }),
      );
      expect(result.valid).toBe(true);
    }
  });

  it('rejects missing action', () => {
    const { action, ...rest } = validHook();
    const result = validateHookDefinition({ ...rest, name: 'x', trigger: { event: 'file_save' } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'action')).toBe(true);
  });

  it('rejects missing action.agent', () => {
    const result = validateHookDefinition(
      validHook({ action: { prompt: 'test', mode: 'background' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'action.agent')).toBe(true);
  });

  it('rejects missing action.prompt', () => {
    const result = validateHookDefinition(
      validHook({ action: { agent: 'test', mode: 'background' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'action.prompt')).toBe(true);
  });

  it('rejects invalid action.mode', () => {
    const result = validateHookDefinition(
      validHook({ action: { agent: 'test', prompt: 'test', mode: 'invalid' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'action.mode')).toBe(true);
  });

  it('rejects negative debounce', () => {
    const result = validateHookDefinition(validHook({ debounce: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'debounce')).toBe(true);
  });

  it('rejects zero maxConcurrent', () => {
    const result = validateHookDefinition(validHook({ maxConcurrent: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'maxConcurrent')).toBe(true);
  });

  it('rejects negative action.timeout', () => {
    const result = validateHookDefinition(
      validHook({ action: { agent: 'a', prompt: 'p', mode: 'background', timeout: -100 } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'action.timeout')).toBe(true);
  });

  it('accepts trigger with exclude as string', () => {
    const result = validateHookDefinition(
      validHook({ trigger: { event: 'file_save', exclude: '*.test.ts' } }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts trigger with exclude as array', () => {
    const result = validateHookDefinition(
      validHook({ trigger: { event: 'file_save', exclude: ['*.test.ts', '*.spec.ts'] } }),
    );
    expect(result.valid).toBe(true);
  });

  it('validates condition.fileSize', () => {
    const result = validateHookDefinition(
      validHook({ condition: { fileSize: { max: 1024 } } }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid condition.fileSize', () => {
    const result = validateHookDefinition(
      validHook({ condition: { fileSize: 'big' } }),
    );
    expect(result.valid).toBe(false);
  });

  it('validates condition.branch as string', () => {
    const result = validateHookDefinition(
      validHook({ condition: { branch: 'main' } }),
    );
    expect(result.valid).toBe(true);
  });

  it('validates condition.branch as array', () => {
    const result = validateHookDefinition(
      validHook({ condition: { branch: ['main', 'develop'] } }),
    );
    expect(result.valid).toBe(true);
  });

  it('validates action.context as string array', () => {
    const result = validateHookDefinition(
      validHook({
        action: { agent: 'a', prompt: 'p', mode: 'background', context: ['src/', 'lib/'] },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const result = validateHookDefinition({
      trigger: { event: 'bad' },
      action: { mode: 'invalid' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});

// ── Interpolation tests ──────────────────────────────────────────────
describe('interpolatePrompt', () => {
  it('replaces ${filePath}', () => {
    const event: HookFileEvent = { type: 'file_save', filePath: 'src/foo.ts', timestamp: Date.now() };
    const result = interpolatePrompt('Check ${filePath} for issues', event);
    expect(result).toBe('Check src/foo.ts for issues');
  });

  it('replaces ${commitMessage}', () => {
    const event: HookFileEvent = { type: 'git_commit', commitMessage: 'fix: bug', timestamp: Date.now() };
    const result = interpolatePrompt('Log: ${commitMessage}', event);
    expect(result).toBe('Log: fix: bug');
  });

  it('replaces multiple occurrences', () => {
    const event: HookFileEvent = { type: 'file_save', filePath: 'a.ts', timestamp: Date.now() };
    const result = interpolatePrompt('${filePath} and ${filePath}', event);
    expect(result).toBe('a.ts and a.ts');
  });

  it('leaves unmatched variables as-is', () => {
    const event: HookFileEvent = { type: 'file_save', timestamp: Date.now() };
    const result = interpolatePrompt('${filePath} ${commitMessage}', event);
    expect(result).toBe('${filePath} ${commitMessage}');
  });
});
