/**
 * AETHER Hooks System — event-driven automation for agent orchestration.
 *
 * @module core/hooks
 */

export { EventBus } from './event-bus.js';
export type { HookSystemEvent, HookSystemEventType } from './event-bus.js';

export { HookRegistry } from './registry.js';
export { DebounceManager } from './debounce.js';
export { BackgroundDispatcher } from './dispatcher.js';
export { parseYaml } from './yaml-parser.js';

export {
  HOOK_EVENTS,
  ACTION_MODES,
  HOOK_DEFAULTS,
  validateHookDefinition,
  interpolatePrompt,
} from './schema.js';

export type {
  HookEvent,
  ActionMode,
  HookTrigger,
  HookCondition,
  HookAction,
  HookDefinition,
  HookFileEvent,
  HookTaskRequest,
  DispatchResult,
  DispatchStatus,
  ValidationError,
} from './schema.js';
