/**
 * DebounceManager — debounce and rate-limit hook executions.
 */

import type { HookFileEvent } from './schema.js';
import { HOOK_DEFAULTS } from './schema.js';
import type { EventBus } from './event-bus.js';

interface PendingExecution {
  timer: ReturnType<typeof setTimeout>;
  event: HookFileEvent;
  callback: () => Promise<void>;
}

interface QueueEntry {
  event: HookFileEvent;
  callback: () => Promise<void>;
}

export class DebounceManager {
  private pending = new Map<string, PendingExecution>();
  private queues = new Map<string, QueueEntry[]>();
  private running = new Set<string>();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Schedule a hook execution with debounce.
   * If the hook fires again within debounceMs, the timer resets.
   * If the hook is already running, the event is queued.
   */
  schedule(
    hookName: string,
    event: HookFileEvent,
    debounceMs: number,
    callback: () => Promise<void>,
  ): void {
    const effectiveDebounce = debounceMs ?? HOOK_DEFAULTS.debounce;

    // If currently running, queue instead
    if (this.running.has(hookName)) {
      this.enqueue(hookName, event, callback);
      return;
    }

    // Clear any existing pending timer
    const existing = this.pending.get(hookName);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.pending.delete(hookName);
      this.execute(hookName, callback);
    }, effectiveDebounce);

    this.pending.set(hookName, { timer, event, callback });

    this.eventBus?.emit({ type: 'hook:debounced', hookName, event });
  }

  private enqueue(
    hookName: string,
    event: HookFileEvent,
    callback: () => Promise<void>,
  ): void {
    if (!this.queues.has(hookName)) {
      this.queues.set(hookName, []);
    }
    const queue = this.queues.get(hookName)!;

    if (queue.length >= HOOK_DEFAULTS.maxQueuedPerHook) {
      queue.shift();
      this.eventBus?.emit({ type: 'hook:queue_overflow', hookName, dropped: 1 });
    }

    queue.push({ event, callback });
  }

  private async execute(hookName: string, callback: () => Promise<void>): Promise<void> {
    this.running.add(hookName);
    try {
      await callback();
    } finally {
      this.running.delete(hookName);
      this.processQueue(hookName);
    }
  }

  private processQueue(hookName: string): void {
    const queue = this.queues.get(hookName);
    if (!queue || queue.length === 0) return;

    const next = queue.shift()!;
    if (queue.length === 0) {
      this.queues.delete(hookName);
    }

    this.execute(hookName, next.callback);
  }

  /** Cancel a pending debounce for a hook. */
  cancel(hookName: string): boolean {
    const existing = this.pending.get(hookName);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(hookName);
      return true;
    }
    return false;
  }

  /** Check if a hook is currently running. */
  isRunning(hookName: string): boolean {
    return this.running.has(hookName);
  }

  /** Check if a hook has a pending debounce. */
  isPending(hookName: string): boolean {
    return this.pending.has(hookName);
  }

  /** Get queue length for a hook. */
  queueLength(hookName: string): number {
    return this.queues.get(hookName)?.length ?? 0;
  }

  /** Clear all pending timers and queues. */
  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    this.queues.clear();
    this.running.clear();
  }
}
