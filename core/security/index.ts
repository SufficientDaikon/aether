/**
 * Prompt Security — barrel export
 */

export {
  type DangerousPattern,
  DEFAULT_PATTERNS,
  loadCustomPatterns,
} from './patterns.js';

export {
  type SanitizeOptions,
  type SanitizeResult,
  sanitizePromptInput,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_COMMENTS_LENGTH,
  MAX_FILE_CONTENT_LENGTH,
} from './sanitizer.js';

export {
  type DelimitedField,
  buildDelimitedPrompt,
} from './delimiter.js';

export {
  type ConfidenceConfig,
  type ConfidenceResult,
  DEFAULT_CONFIDENCE_CONFIG,
  checkConfidence,
} from './confidence.js';
