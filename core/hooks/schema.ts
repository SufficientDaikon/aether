/**
 * Hook Definition Schema — types and validation for AETHER hook files.
 */

// ── Event types ──────────────────────────────────────────────────────
export const HOOK_EVENTS = [
  'file_save',
  'file_create',
  'file_delete',
  'file_rename',
  'git_commit',
  'git_push',
  'build_success',
  'build_fail',
  'terminal_error',
  'test_fail',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export const ACTION_MODES = ['background', 'interactive', 'notify'] as const;
export type ActionMode = (typeof ACTION_MODES)[number];

// ── Hook Definition ──────────────────────────────────────────────────
export interface HookTrigger {
  event: HookEvent;
  pattern?: string;
  exclude?: string | string[];
}

export interface HookCondition {
  fileSize?: { max: number };
  branch?: string | string[];
  modifiedOnly?: boolean;
}

export interface HookAction {
  agent: string;
  prompt: string;
  context?: string[];
  output?: string;
  mode: ActionMode;
  timeout?: number;
}

export interface HookDefinition {
  name: string;
  description?: string;
  enabled: boolean;
  trigger: HookTrigger;
  condition?: HookCondition;
  action: HookAction;
  debounce?: number;
  maxConcurrent?: number;
}

// ── Dispatch types ───────────────────────────────────────────────────
export type DispatchStatus = 'success' | 'failure' | 'timeout' | 'cancelled';

export interface DispatchResult {
  hookName: string;
  agentId: string;
  status: DispatchStatus;
  duration: number;
  output?: string;
  error?: string;
}

export interface HookTaskRequest {
  id: string;
  task: string;
  from: string;
  to?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  context?: Record<string, unknown>;
}

// ── Hook file event (passed to hooks on trigger) ─────────────────────
export interface HookFileEvent {
  type: HookEvent;
  filePath?: string;
  commitMessage?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ── Defaults ─────────────────────────────────────────────────────────
export const HOOK_DEFAULTS = {
  enabled: true,
  debounce: 2000,
  maxConcurrent: 1,
  actionMode: 'background' as ActionMode,
  actionTimeout: 60_000,
  maxQueuedPerHook: 10,
} as const;

// ── Validation ───────────────────────────────────────────────────────
export interface ValidationError {
  field: string;
  message: string;
}

export function validateHookDefinition(raw: unknown): {
  valid: boolean;
  errors: ValidationError[];
  hook?: HookDefinition;
} {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: [{ field: 'root', message: 'Hook definition must be an object' }] };
  }

  const obj = raw as Record<string, unknown>;

  // name
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push({ field: 'name', message: 'name is required and must be a non-empty string' });
  }

  // trigger
  if (!obj.trigger || typeof obj.trigger !== 'object') {
    errors.push({ field: 'trigger', message: 'trigger is required and must be an object' });
  } else {
    const trigger = obj.trigger as Record<string, unknown>;
    if (!HOOK_EVENTS.includes(trigger.event as HookEvent)) {
      errors.push({
        field: 'trigger.event',
        message: `trigger.event must be one of: ${HOOK_EVENTS.join(', ')}`,
      });
    }
    if (trigger.pattern !== undefined && typeof trigger.pattern !== 'string') {
      errors.push({ field: 'trigger.pattern', message: 'trigger.pattern must be a string' });
    }
    if (trigger.exclude !== undefined) {
      if (typeof trigger.exclude !== 'string' && !Array.isArray(trigger.exclude)) {
        errors.push({ field: 'trigger.exclude', message: 'trigger.exclude must be a string or string[]' });
      }
      if (Array.isArray(trigger.exclude) && !trigger.exclude.every((e: unknown) => typeof e === 'string')) {
        errors.push({ field: 'trigger.exclude', message: 'trigger.exclude array must contain only strings' });
      }
    }
  }

  // action
  if (!obj.action || typeof obj.action !== 'object') {
    errors.push({ field: 'action', message: 'action is required and must be an object' });
  } else {
    const action = obj.action as Record<string, unknown>;
    if (typeof action.agent !== 'string' || action.agent.trim() === '') {
      errors.push({ field: 'action.agent', message: 'action.agent is required and must be a non-empty string' });
    }
    if (typeof action.prompt !== 'string' || action.prompt.trim() === '') {
      errors.push({ field: 'action.prompt', message: 'action.prompt is required and must be a non-empty string' });
    }
    if (action.mode !== undefined && !ACTION_MODES.includes(action.mode as ActionMode)) {
      errors.push({
        field: 'action.mode',
        message: `action.mode must be one of: ${ACTION_MODES.join(', ')}`,
      });
    }
    if (action.timeout !== undefined && (typeof action.timeout !== 'number' || action.timeout <= 0)) {
      errors.push({ field: 'action.timeout', message: 'action.timeout must be a positive number' });
    }
    if (action.context !== undefined) {
      if (!Array.isArray(action.context) || !action.context.every((c: unknown) => typeof c === 'string')) {
        errors.push({ field: 'action.context', message: 'action.context must be a string[]' });
      }
    }
    if (action.output !== undefined && typeof action.output !== 'string') {
      errors.push({ field: 'action.output', message: 'action.output must be a string' });
    }
  }

  // condition (optional)
  if (obj.condition !== undefined) {
    if (typeof obj.condition !== 'object') {
      errors.push({ field: 'condition', message: 'condition must be an object' });
    } else {
      const cond = obj.condition as Record<string, unknown>;
      if (cond.fileSize !== undefined) {
        if (typeof cond.fileSize !== 'object' || typeof (cond.fileSize as Record<string, unknown>)?.max !== 'number') {
          errors.push({ field: 'condition.fileSize', message: 'condition.fileSize must be { max: number }' });
        }
      }
      if (cond.branch !== undefined) {
        if (typeof cond.branch !== 'string' && !Array.isArray(cond.branch)) {
          errors.push({ field: 'condition.branch', message: 'condition.branch must be a string or string[]' });
        }
      }
      if (cond.modifiedOnly !== undefined && typeof cond.modifiedOnly !== 'boolean') {
        errors.push({ field: 'condition.modifiedOnly', message: 'condition.modifiedOnly must be a boolean' });
      }
    }
  }

  // debounce (optional)
  if (obj.debounce !== undefined && (typeof obj.debounce !== 'number' || obj.debounce < 0)) {
    errors.push({ field: 'debounce', message: 'debounce must be a non-negative number' });
  }

  // maxConcurrent (optional)
  if (obj.maxConcurrent !== undefined && (typeof obj.maxConcurrent !== 'number' || obj.maxConcurrent < 1)) {
    errors.push({ field: 'maxConcurrent', message: 'maxConcurrent must be a positive number' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Build the validated HookDefinition with defaults applied
  const trigger = obj.trigger as Record<string, unknown>;
  const action = obj.action as Record<string, unknown>;

  const hook: HookDefinition = {
    name: (obj.name as string).trim(),
    description: typeof obj.description === 'string' ? obj.description : undefined,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : HOOK_DEFAULTS.enabled,
    trigger: {
      event: trigger.event as HookEvent,
      pattern: trigger.pattern as string | undefined,
      exclude: trigger.exclude as string | string[] | undefined,
    },
    condition: obj.condition as HookCondition | undefined,
    action: {
      agent: (action.agent as string).trim(),
      prompt: action.prompt as string,
      context: action.context as string[] | undefined,
      output: action.output as string | undefined,
      mode: (action.mode as ActionMode) ?? HOOK_DEFAULTS.actionMode,
      timeout: (action.timeout as number) ?? HOOK_DEFAULTS.actionTimeout,
    },
    debounce: (obj.debounce as number) ?? HOOK_DEFAULTS.debounce,
    maxConcurrent: (obj.maxConcurrent as number) ?? HOOK_DEFAULTS.maxConcurrent,
  };

  return { valid: true, errors: [], hook };
}

/** Interpolate template variables in prompt strings. */
export function interpolatePrompt(
  prompt: string,
  event: HookFileEvent,
): string {
  let result = prompt;
  if (event.filePath) {
    result = result.replace(/\$\{filePath\}/g, event.filePath);
  }
  if (event.commitMessage) {
    result = result.replace(/\$\{commitMessage\}/g, event.commitMessage);
  }
  return result;
}
