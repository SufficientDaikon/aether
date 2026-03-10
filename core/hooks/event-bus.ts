/**
 * EventBus — typed pub/sub for hook system events.
 */

import type { HookFileEvent, HookDefinition, DispatchResult } from './schema.js';

export type HookSystemEvent =
  | { type: 'hook:triggered'; hook: HookDefinition; event: HookFileEvent }
  | { type: 'hook:dispatched'; hook: HookDefinition; event: HookFileEvent }
  | { type: 'hook:completed'; result: DispatchResult }
  | { type: 'hook:error'; hookName: string; error: string }
  | { type: 'hook:debounced'; hookName: string; event: HookFileEvent }
  | { type: 'hook:queue_overflow'; hookName: string; dropped: number }
  | { type: 'hook:registered'; hook: HookDefinition }
  | { type: 'hook:unregistered'; hookName: string }
  | { type: 'hook:enabled'; hookName: string }
  | { type: 'hook:disabled'; hookName: string };

export type HookSystemEventType = HookSystemEvent['type'];

type EventHandler<T extends HookSystemEvent = HookSystemEvent> = (event: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private allHandlers = new Set<EventHandler<HookSystemEvent>>();

  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on<T extends HookSystemEventType>(
    type: T,
    handler: EventHandler<Extract<HookSystemEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /** Subscribe to ALL events. Returns unsubscribe function. */
  onAll(handler: EventHandler<HookSystemEvent>): () => void {
    this.allHandlers.add(handler);
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  /** Emit an event to matching subscribers. */
  emit(event: HookSystemEvent): void {
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch {
          // Swallow handler errors to prevent cascading failures
        }
      }
    }
    for (const handler of this.allHandlers) {
      try {
        handler(event);
      } catch {
        // Swallow
      }
    }
  }

  /** Remove all listeners. */
  clear(): void {
    this.handlers.clear();
    this.allHandlers.clear();
  }

  /** Get count of listeners for a given event type. */
  listenerCount(type?: HookSystemEventType): number {
    if (type) {
      return (this.handlers.get(type)?.size ?? 0) + this.allHandlers.size;
    }
    let total = this.allHandlers.size;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }
}
