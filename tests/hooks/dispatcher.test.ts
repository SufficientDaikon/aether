import { describe, it, expect, afterEach } from 'bun:test';
import { BackgroundDispatcher } from '../../core/hooks/dispatcher.js';
import { EventBus } from '../../core/hooks/event-bus.js';
import type { HookDefinition, HookFileEvent, HookTaskRequest } from '../../core/hooks/schema.js';

function makeHook(overrides?: Partial<HookDefinition>): HookDefinition {
  return {
    name: 'test-hook',
    enabled: true,
    trigger: { event: 'file_save', pattern: '**/*.ts' },
    action: {
      agent: 'test-agent',
      prompt: 'Analyze ${filePath}',
      mode: 'background',
      timeout: 5000,
    },
    debounce: 2000,
    maxConcurrent: 1,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<HookFileEvent>): HookFileEvent {
  return {
    type: 'file_save',
    filePath: 'src/index.ts',
    timestamp: Date.now(),
    ...overrides,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let dispatcher: BackgroundDispatcher;

afterEach(() => {
  dispatcher?.cancelAll();
});

describe('BackgroundDispatcher', () => {
  it('dispatches and returns success in dry-run mode (no callbacks)', async () => {
    dispatcher = new BackgroundDispatcher();
    const result = await dispatcher.dispatch(makeHook(), makeEvent());

    expect(result.status).toBe('success');
    expect(result.hookName).toBe('test-hook');
    expect(result.agentId).toBe('test-agent');
    expect(result.output).toContain('dry-run');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('interpolates prompt variables in the task request', async () => {
    dispatcher = new BackgroundDispatcher();
    const requests: HookTaskRequest[] = [];

    dispatcher.onDispatch(async (req) => {
      requests.push(req);
      return { output: 'ok' };
    });

    await dispatcher.dispatch(makeHook(), makeEvent({ filePath: 'src/foo.ts' }));

    expect(requests).toHaveLength(1);
    expect(requests[0].task).toBe('Analyze src/foo.ts');
    expect(requests[0].from).toBe('hook-system');
    expect(requests[0].to).toBe('test-agent');
    expect(requests[0].priority).toBe(3);
  });

  it('returns failure when callback throws', async () => {
    dispatcher = new BackgroundDispatcher();
    dispatcher.onDispatch(async () => {
      throw new Error('agent crashed');
    });

    const result = await dispatcher.dispatch(makeHook(), makeEvent());
    expect(result.status).toBe('failure');
    expect(result.error).toBe('agent crashed');
  });

  it('returns failure when callback returns error', async () => {
    dispatcher = new BackgroundDispatcher();
    dispatcher.onDispatch(async () => {
      return { error: 'something went wrong' };
    });

    const result = await dispatcher.dispatch(makeHook(), makeEvent());
    expect(result.status).toBe('failure');
    expect(result.error).toBe('something went wrong');
  });

  it('handles timeout correctly', async () => {
    dispatcher = new BackgroundDispatcher();
    dispatcher.onDispatch(async () => {
      await sleep(3000); // longer than timeout
      return { output: 'late' };
    });

    const hook = makeHook({
      action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 100 },
    });

    const result = await dispatcher.dispatch(hook, makeEvent());
    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');
  });

  it('onDispatch returns unsubscribe function', async () => {
    dispatcher = new BackgroundDispatcher();
    let callCount = 0;

    const unsub = dispatcher.onDispatch(async () => {
      callCount++;
      return {};
    });

    await dispatcher.dispatch(makeHook(), makeEvent());
    expect(callCount).toBe(1);

    unsub();
    // With no callbacks, falls through to dry-run mode
    const result = await dispatcher.dispatch(makeHook(), makeEvent());
    expect(result.output).toContain('dry-run');
    expect(callCount).toBe(1);
  });

  it('tracks running dispatches', async () => {
    dispatcher = new BackgroundDispatcher();
    let resolveDispatch: (() => void) | undefined;

    dispatcher.onDispatch(async () => {
      await new Promise<void>((r) => {
        resolveDispatch = r;
      });
      return { output: 'done' };
    });

    expect(dispatcher.runningCount).toBe(0);

    const promise = dispatcher.dispatch(makeHook(), makeEvent());
    await sleep(10);

    expect(dispatcher.runningCount).toBe(1);
    expect(dispatcher.getRunning()).toHaveLength(1);

    resolveDispatch?.();
    await promise;

    expect(dispatcher.runningCount).toBe(0);
  });

  it('emits hook:dispatched and hook:completed events', async () => {
    const bus = new EventBus();
    dispatcher = new BackgroundDispatcher(bus);
    const events: string[] = [];

    bus.on('hook:dispatched', () => events.push('dispatched'));
    bus.on('hook:completed', () => events.push('completed'));

    await dispatcher.dispatch(makeHook(), makeEvent());

    expect(events).toEqual(['dispatched', 'completed']);
  });

  it('includes context metadata in task request', async () => {
    dispatcher = new BackgroundDispatcher();
    const requests: HookTaskRequest[] = [];

    dispatcher.onDispatch(async (req) => {
      requests.push(req);
      return {};
    });

    await dispatcher.dispatch(
      makeHook(),
      makeEvent({ metadata: { branch: 'main', user: 'test' } }),
    );

    expect(requests[0].context).toMatchObject({
      hookName: 'test-hook',
      event: 'file_save',
      branch: 'main',
      user: 'test',
    });
  });

  it('cancelAll cancels running dispatches', async () => {
    dispatcher = new BackgroundDispatcher();
    dispatcher.onDispatch(async () => {
      await sleep(5000);
      return {};
    });

    const p1 = dispatcher.dispatch(makeHook({ name: 'h1' }), makeEvent());
    const p2 = dispatcher.dispatch(makeHook({ name: 'h2' }), makeEvent());

    await sleep(10);
    const cancelled = dispatcher.cancelAll();
    expect(cancelled).toBe(2);

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both should be cancelled or timed out
    expect(['cancelled', 'timeout']).toContain(r1.status);
    expect(['cancelled', 'timeout']).toContain(r2.status);
  });
});
