/**
 * BackgroundDispatcher — prepares and dispatches hook tasks.
 *
 * Does NOT call the executor directly. Instead, prepares HookTaskRequest objects
 * and invokes registered dispatch callbacks. The integration layer wires actual execution.
 */

import {
  type HookDefinition,
  type HookFileEvent,
  type HookTaskRequest,
  type DispatchResult,
  interpolatePrompt,
} from './schema.js';
import type { EventBus } from './event-bus.js';

type DispatchCallback = (request: HookTaskRequest) => Promise<{ output?: string; error?: string }>;

let idCounter = 0;
function generateId(): string {
  return `hook-${Date.now()}-${++idCounter}`;
}

export class BackgroundDispatcher {
  private eventBus?: EventBus;
  private dispatchCallbacks: DispatchCallback[] = [];
  private runningDispatches = new Map<string, AbortController>();
  private timedOut = new Set<string>();

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  /** Register a callback that will handle actual task execution. */
  onDispatch(callback: DispatchCallback): () => void {
    this.dispatchCallbacks.push(callback);
    return () => {
      const idx = this.dispatchCallbacks.indexOf(callback);
      if (idx !== -1) this.dispatchCallbacks.splice(idx, 1);
    };
  }

  /** Dispatch a hook in response to an event. Returns the result. */
  async dispatch(hook: HookDefinition, event: HookFileEvent): Promise<DispatchResult> {
    const startTime = Date.now();
    const taskId = generateId();
    const abortController = new AbortController();

    this.runningDispatches.set(taskId, abortController);

    // Prepare the TaskRequest
    const prompt = interpolatePrompt(hook.action.prompt, event);
    const request: HookTaskRequest = {
      id: taskId,
      task: prompt,
      from: 'hook-system',
      to: hook.action.agent,
      priority: 3,
      context: {
        hookName: hook.name,
        event: event.type,
        filePath: event.filePath,
        commitMessage: event.commitMessage,
        mode: hook.action.mode,
        ...(event.metadata ?? {}),
      },
    };

    this.eventBus?.emit({ type: 'hook:dispatched', hook, event });

    // Timeout handling
    const timeout = hook.action.timeout ?? 60_000;
    const timeoutId = setTimeout(() => {
      this.timedOut.add(taskId);
      abortController.abort();
    }, timeout);

    try {
      // If no callbacks registered, just log and succeed
      if (this.dispatchCallbacks.length === 0) {
        const duration = Date.now() - startTime;
        const result: DispatchResult = {
          hookName: hook.name,
          agentId: hook.action.agent,
          status: 'success',
          duration,
          output: `[dry-run] Task prepared: ${request.id}`,
        };
        this.eventBus?.emit({ type: 'hook:completed', result });
        return result;
      }

      // Execute through callbacks (first one wins)
      const callbackResult = await Promise.race([
        this.executeCallbacks(request),
        this.waitForAbort(abortController.signal, timeout),
      ]);

      const duration = Date.now() - startTime;

      if (abortController.signal.aborted) {
        const isTimeout = this.timedOut.has(taskId);
        const result: DispatchResult = {
          hookName: hook.name,
          agentId: hook.action.agent,
          status: isTimeout ? 'timeout' : 'cancelled',
          duration,
          error: isTimeout ? `Hook timed out after ${timeout}ms` : 'Hook execution was cancelled',
        };
        this.eventBus?.emit({ type: 'hook:completed', result });
        return result;
      }

      const result: DispatchResult = {
        hookName: hook.name,
        agentId: hook.action.agent,
        status: callbackResult?.error ? 'failure' : 'success',
        duration,
        output: callbackResult?.output,
        error: callbackResult?.error,
      };
      this.eventBus?.emit({ type: 'hook:completed', result });
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;

      if (abortController.signal.aborted) {
        const isTimeout = this.timedOut.has(taskId);
        const result: DispatchResult = {
          hookName: hook.name,
          agentId: hook.action.agent,
          status: isTimeout ? 'timeout' : 'cancelled',
          duration,
          error: isTimeout ? `Hook timed out after ${timeout}ms` : 'Hook execution was cancelled',
        };
        this.eventBus?.emit({ type: 'hook:completed', result });
        return result;
      }

      const result: DispatchResult = {
        hookName: hook.name,
        agentId: hook.action.agent,
        status: 'failure',
        duration,
        error: (err as Error).message,
      };
      this.eventBus?.emit({ type: 'hook:completed', result });
      return result;
    } finally {
      clearTimeout(timeoutId);
      this.timedOut.delete(taskId);
      this.runningDispatches.delete(taskId);
    }
  }

  /** Cancel a running dispatch by task ID. */
  cancel(taskId: string): boolean {
    const controller = this.runningDispatches.get(taskId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /** Cancel all running dispatches. */
  cancelAll(): number {
    let count = 0;
    for (const controller of this.runningDispatches.values()) {
      controller.abort();
      count++;
    }
    return count;
  }

  /** Get IDs of currently running dispatches. */
  getRunning(): string[] {
    return Array.from(this.runningDispatches.keys());
  }

  /** Number of currently running dispatches. */
  get runningCount(): number {
    return this.runningDispatches.size;
  }

  private async executeCallbacks(
    request: HookTaskRequest,
  ): Promise<{ output?: string; error?: string }> {
    // Execute the first registered callback
    for (const cb of this.dispatchCallbacks) {
      try {
        return await cb(request);
      } catch (err) {
        return { error: (err as Error).message };
      }
    }
    return { output: 'No dispatch handler executed' };
  }

  private waitForAbort(signal: AbortSignal, timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      const check = () => {
        if (signal.aborted) {
          reject(new Error('Aborted'));
        }
      };
      signal.addEventListener('abort', check);
      // Fallback timeout (shouldn't trigger if abort works)
      setTimeout(() => {
        check();
      }, timeout + 100);
    });
  }
}
