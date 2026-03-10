import { describe, it, expect } from 'bun:test';
import { EventBus } from '../../core/hooks/event-bus.js';
import type { HookSystemEvent } from '../../core/hooks/event-bus.js';
import type { HookDefinition, HookFileEvent } from '../../core/hooks/schema.js';

const mockHook: HookDefinition = {
  name: 'test-hook',
  enabled: true,
  trigger: { event: 'file_save' },
  action: { agent: 'a', prompt: 'p', mode: 'background', timeout: 60000 },
  debounce: 2000,
  maxConcurrent: 1,
};

const mockEvent: HookFileEvent = {
  type: 'file_save',
  filePath: 'test.ts',
  timestamp: Date.now(),
};

describe('EventBus', () => {
  it('delivers events to subscribers', () => {
    const bus = new EventBus();
    const received: HookSystemEvent[] = [];
    bus.on('hook:triggered', (e) => received.push(e));

    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('hook:triggered');
  });

  it('does not deliver events of different type', () => {
    const bus = new EventBus();
    const received: HookSystemEvent[] = [];
    bus.on('hook:triggered', (e) => received.push(e));

    bus.emit({ type: 'hook:error', hookName: 'x', error: 'fail' });
    expect(received).toHaveLength(0);
  });

  it('supports onAll for catching all events', () => {
    const bus = new EventBus();
    const received: HookSystemEvent[] = [];
    bus.onAll((e) => received.push(e));

    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    bus.emit({ type: 'hook:error', hookName: 'x', error: 'fail' });

    expect(received).toHaveLength(2);
  });

  it('returns unsubscribe function from on()', () => {
    const bus = new EventBus();
    const received: HookSystemEvent[] = [];
    const unsub = bus.on('hook:triggered', (e) => received.push(e));

    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    expect(received).toHaveLength(1);

    unsub();
    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    expect(received).toHaveLength(1); // no new event
  });

  it('returns unsubscribe function from onAll()', () => {
    const bus = new EventBus();
    const received: HookSystemEvent[] = [];
    const unsub = bus.onAll((e) => received.push(e));

    bus.emit({ type: 'hook:error', hookName: 'x', error: 'fail' });
    unsub();
    bus.emit({ type: 'hook:error', hookName: 'x', error: 'fail' });

    expect(received).toHaveLength(1);
  });

  it('supports multiple subscribers for same event', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('hook:triggered', () => count++);
    bus.on('hook:triggered', () => count++);

    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    expect(count).toBe(2);
  });

  it('swallows handler errors without affecting other handlers', () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('hook:triggered', () => {
      throw new Error('boom');
    });
    bus.on('hook:triggered', () => received.push('ok'));

    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    expect(received).toEqual(['ok']);
  });

  it('clear() removes all listeners', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('hook:triggered', () => count++);
    bus.onAll(() => count++);

    bus.clear();
    bus.emit({ type: 'hook:triggered', hook: mockHook, event: mockEvent });
    expect(count).toBe(0);
  });

  it('listenerCount() returns correct counts', () => {
    const bus = new EventBus();

    expect(bus.listenerCount()).toBe(0);
    expect(bus.listenerCount('hook:triggered')).toBe(0);

    bus.on('hook:triggered', () => {});
    expect(bus.listenerCount('hook:triggered')).toBe(1);

    bus.onAll(() => {});
    // Type-specific count includes allHandlers
    expect(bus.listenerCount('hook:triggered')).toBe(2);
    // Total count
    expect(bus.listenerCount()).toBe(2);
  });
});
