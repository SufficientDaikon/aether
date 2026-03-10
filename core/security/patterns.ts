/**
 * Dangerous Pattern Registry (R04.2)
 * Detects prompt injection attempts via configurable pattern matching.
 */

import { readFileSync } from 'fs';

export interface DangerousPattern {
  name: string;
  pattern: RegExp;
  severity: 'high' | 'medium' | 'low';
  replacement: string;
}

export const DEFAULT_PATTERNS: DangerousPattern[] = [
  {
    name: 'ignore-instructions',
    pattern: /ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?/gi,
    severity: 'high',
    replacement: '[REDACTED]',
  },
  {
    name: 'disregard-instructions',
    pattern: /disregard\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?/gi,
    severity: 'high',
    replacement: '[REDACTED]',
  },
  {
    name: 'forget-instructions',
    pattern: /forget\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?/gi,
    severity: 'high',
    replacement: '[REDACTED]',
  },
  {
    name: 'new-instructions',
    pattern: /new\s+instructions?:/gi,
    severity: 'high',
    replacement: '[REDACTED]',
  },
  {
    name: 'system-role',
    pattern: /system:/gi,
    severity: 'medium',
    replacement: '[REDACTED]',
  },
  {
    name: 'assistant-role',
    pattern: /assistant:/gi,
    severity: 'medium',
    replacement: '[REDACTED]',
  },
  {
    name: 'system-tag',
    pattern: /\[SYSTEM\]/gi,
    severity: 'medium',
    replacement: '[REDACTED]',
  },
  {
    name: 'assistant-tag',
    pattern: /\[ASSISTANT\]/gi,
    severity: 'medium',
    replacement: '[REDACTED]',
  },
  {
    name: 'im-start',
    pattern: /<\|im_start\|>/gi,
    severity: 'high',
    replacement: '',
  },
  {
    name: 'im-end',
    pattern: /<\|im_end\|>/gi,
    severity: 'high',
    replacement: '',
  },
];

/**
 * Load custom patterns from a JSON config file.
 * Expected format: array of { name, pattern (string), flags?, severity, replacement }
 */
export function loadCustomPatterns(configPath: string): DangerousPattern[] {
  const raw = readFileSync(configPath, 'utf-8');
  const entries = JSON.parse(raw) as Array<{
    name: string;
    pattern: string;
    flags?: string;
    severity: 'high' | 'medium' | 'low';
    replacement: string;
  }>;

  return entries.map((e) => ({
    name: e.name,
    pattern: new RegExp(e.pattern, e.flags ?? 'gi'),
    severity: e.severity,
    replacement: e.replacement,
  }));
}
