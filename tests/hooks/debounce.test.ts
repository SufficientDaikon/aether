import { describe, it, expect, afterEach } from 'bun:test';
import { DebounceManager } from '../../core/hooks/debounce.js';
import { EventBus } from '../../core/hooks/event-bus.js';
import type { HookFileEvent } from '../../core/hooks/schema.js';

function makeEvent(filePath = 'test.ts'): HookFileEvent {
  return { type: 'file_save', filePath, timestamp: Date.now() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let manager: DebounceManager;

afterEach(() => {
  manager?.dispose();
});

describe('DebounceManager', () => {
  it('executes callback after debounce period', async () => {
    manager = new DebounceManager();
    let executed = false;

    manager.schedule('hook-a', makeEvent(), 50, async () => {
      executed = true;
    });

    expect(executed).toBe(false);
    expect(manager.isPending('hook-a')).toBe(true);

    await sleep(80);
    expect(executed).toBe(true);
    expect(manager.isPending('hook-a')).toBe(false);
  });

  it('resets timer on repeated calls within debounce window', async () => {
    manager = new DebounceManager();
    let count = 0;

    const cb = async () => {
      count++;
    };

    manager.schedule('hook-a', makeEvent(), 80, cb);
    await sleep(40);
    manager.schedule('hook-a', makeEvent(), 80, cb);
    await sleep(40);
    manager.schedule('hook-a', makeEvent(), 80, cb);

    // At this point ~80ms have passed, but timer was reset twice
    await sleep(100);
    expect(count).toBe(1); // Only one execution
  });

  it('cancel() prevents execution', async () => {
    manager = new DebounceManager();
    let executed = false;

    manager.schedule('hook-a', makeEvent(), 50, async () => {
      executed = true;
    });

    expect(manager.cancel('hook-a')).toBe(true);
    await sleep(80);
    expect(executed).toBe(false);
  });

  it('cancel() returns false if nothing pending', () => {
    manager = new DebounceManager();
    expect(manager.cancel('nonexistent')).toBe(false);
  });

  it('queues events while hook is running', async () => {
    manager = new DebounceManager();
    const execOrder: number[] = [];
    let resolveFirst: (() => void) | undefined;

    // First execution blocks until we resolve
    manager.schedule('hook-a', makeEvent(), 10, async () => {
      execOrder.push(1);
      await new Promise<void>((r) => {
        resolveFirst = r;
      });
    });

    await sleep(30); // Let first execution start
    expect(manager.isRunning('hook-a')).toBe(true);

    // Schedule while running — goes to queue
    manager.schedule('hook-a', makeEvent(), 10, async () => {
      execOrder.push(2);
    });

    expect(manager.queueLength('hook-a')).toBe(1);

    // Resolve first execution
    resolveFirst?.();
    await sleep(30);

    expect(execOrder).toEqual([1, 2]);
  });

  it('enforces max queue size and drops oldest', async () => {
    const bus = new EventBus();
    manager = new DebounceManager(bus);
    let overflowCount = 0;
    bus.on('hook:queue_overflow', () => overflowCount++);

    let resolveBlock: (() => void) | undefined;

    // Start a blocking execution
    manager.schedule('hook-a', makeEvent(), 10, async () => {
      await new Promise<void>((r) => {
        resolveBlock = r;
      });
    });

    await sleep(30);

    // Queue 12 events (max is 10)
    for (let i = 0; i < 12; i++) {
      manager.schedule('hook-a', makeEvent(), 10, async () => {});
    }

    expect(manager.queueLength('hook-a')).toBe(10);
    expect(overflowCount).toBe(2);

    resolveBlock?.();
    await sleep(50);
  });

  it('emits hook:debounced event', async () => {
    const bus = new EventBus();
    manager = new DebounceManager(bus);
    let debouncedCount = 0;
    bus.on('hook:debounced', () => debouncedCount++);

    manager.schedule('hook-a', makeEvent(), 50, async () => {});
    expect(debouncedCount).toBe(1);
  });

  it('dispose() clears everything', async () => {
    manager = new DebounceManager();
    let executed = false;

    manager.schedule('hook-a', makeEvent(), 50, async () => {
      executed = true;
    });

    manager.dispose();
    await sleep(80);

    expect(executed).toBe(false);
    expect(manager.isPending('hook-a')).toBe(false);
    expect(manager.isRunning('hook-a')).toBe(false);
  });

  it('isRunning / isPending / queueLength work correctly', async () => {
    manager = new DebounceManager();

    expect(manager.isRunning('x')).toBe(false);
    expect(manager.isPending('x')).toBe(false);
    expect(manager.queueLength('x')).toBe(0);
  });
});
