# Prompt Security — Integration Notes

## Module Location

All security primitives live in `core/security/` and are exported from `core/security/index.ts`.

```ts
import {
  sanitizePromptInput,
  buildDelimitedPrompt,
  checkConfidence,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_COMMENTS_LENGTH,
  MAX_FILE_CONTENT_LENGTH,
} from '../core/security/index.js';
```

## Where to Wire In

### 1. `providers/manager.ts` — Sanitize all user inputs before sending to LLM

Before constructing any prompt that includes user-supplied content (issue title, body, comments, file content), sanitize each field:

```ts
const titleResult = sanitizePromptInput(issue.title, {
  maxLength: MAX_TITLE_LENGTH,
  field: 'title',
});
const bodyResult = sanitizePromptInput(issue.body, {
  maxLength: MAX_BODY_LENGTH,
  field: 'body',
});
```

Log `patternsDetected` for audit trails when non-empty.

### 2. `providers/manager.ts` — Use delimited prompts

Replace raw string concatenation with `buildDelimitedPrompt`:

```ts
const prompt = buildDelimitedPrompt(
  systemInstructions,
  [
    { name: 'Issue Title', content: titleResult.sanitized },
    { name: 'Issue Body', content: bodyResult.sanitized },
  ],
  'Classify this issue by type and priority.',
  ['Only use the provided labels', 'Do not invent information'],
);
```

### 3. `core/executor.ts` — Confidence gating before actions

Before the executor performs a classified action, gate it:

```ts
const gate = checkConfidence('classification', result.confidence);
if (!gate.allowed) {
  log.warn(`Action blocked: ${gate.reason}`);
  return { status: 'skipped', reason: gate.reason };
}
```

### 4. Custom Patterns (optional)

Place a JSON file at `.aether/security-patterns.json` and load at startup:

```ts
import { loadCustomPatterns } from '../core/security/index.js';
const extraPatterns = loadCustomPatterns('.aether/security-patterns.json');
```

Pass them via `sanitizePromptInput(input, { customPatterns: extraPatterns.map(p => p.pattern) })`.

## Design Decisions

- **Pure functions only** — no global state, no side effects, easy to test and mock.
- **Zero external dependencies** — only `fs.readFileSync` for optional config loading.
- **Regex patterns use `gi` flags** — case-insensitive, global replacement.
- **Backtick stripping** defaults to on (prevents markdown/JSON injection) but can be disabled.
- **Newline collapsing** prevents prompt padding attacks that exploit token boundaries.
