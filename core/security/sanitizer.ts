/**
 * Input Sanitization (R04.1 + R04.6)
 * Pure, stateless sanitizer for user-supplied prompt content.
 */

import { DEFAULT_PATTERNS, type DangerousPattern } from './patterns.js';

// R04.6 — Max input length constants
export const MAX_TITLE_LENGTH = 500;
export const MAX_BODY_LENGTH = 10_000;
export const MAX_COMMENTS_LENGTH = 3_000;
export const MAX_FILE_CONTENT_LENGTH = 50_000;

export interface SanitizeOptions {
  maxLength?: number;
  field?: string;
  customPatterns?: RegExp[];
  stripBackticks?: boolean;
  collapseNewlines?: boolean;
}

export interface SanitizeResult {
  sanitized: string;
  truncated: boolean;
  patternsDetected: string[];
  originalLength: number;
}

const TRUNCATION_SUFFIX = '[Content truncated for security]';

/**
 * Sanitize user-provided prompt input.
 *
 * 1. Truncate to maxLength (if set)
 * 2. Detect & replace dangerous patterns
 * 3. Replace backticks with single quotes (unless opted out)
 * 4. Collapse 4+ consecutive newlines to 3
 */
export function sanitizePromptInput(
  input: string,
  options: SanitizeOptions = {},
): SanitizeResult {
  const {
    maxLength,
    customPatterns,
    stripBackticks = true,
    collapseNewlines = true,
  } = options;

  const originalLength = input.length;
  let text = input;
  let truncated = false;

  // 1. Truncate
  if (maxLength !== undefined && text.length > maxLength) {
    text = text.slice(0, maxLength) + TRUNCATION_SUFFIX;
    truncated = true;
  }

  // 2. Dangerous pattern detection + replacement
  const patternsDetected: string[] = [];
  const allPatterns: DangerousPattern[] = [...DEFAULT_PATTERNS];

  if (customPatterns) {
    for (const cp of customPatterns) {
      allPatterns.push({
        name: `custom:${cp.source}`,
        pattern: cp,
        severity: 'medium',
        replacement: '[REDACTED]',
      });
    }
  }

  for (const dp of allPatterns) {
    // Reset lastIndex for global regexes
    dp.pattern.lastIndex = 0;
    if (dp.pattern.test(text)) {
      patternsDetected.push(dp.name);
      dp.pattern.lastIndex = 0;
      text = text.replace(dp.pattern, dp.replacement);
    }
  }

  // 3. Strip backticks
  if (stripBackticks) {
    text = text.replace(/`/g, "'");
  }

  // 4. Collapse 4+ consecutive newlines to 3
  if (collapseNewlines) {
    text = text.replace(/\n{4,}/g, '\n\n\n');
  }

  return { sanitized: text, truncated, patternsDetected, originalLength };
}
