/**
 * Input sanitization for issue automation.
 * Standalone copy — does NOT import from core/.
 * Strips prompt injection and dangerous patterns from user-supplied text.
 */

// Patterns that could be prompt injection attacks
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (previous|all|prior|above) instructions?/gi,
  /you are now/gi,
  /forget (everything|all|your instructions)/gi,
  /system\s*prompt/gi,
  /\[INST\]|\[\/INST\]/g,
  /<\|(?:im_start|im_end|endoftext)\|>/g,
  /###\s*(?:Human|Assistant|System):/gi,
  /\bJAILBREAK\b/gi,
  /DAN\s*mode/gi,
];

// Homoglyph normalization map (common lookalikes → ASCII)
const HOMOGLYPH_MAP: Record<string, string> = {
  "а": "a", "е": "e", "і": "i", "о": "o", "р": "p", "с": "c",
  "у": "y", "х": "x", "ё": "e", "ї": "i", "ä": "a", "ö": "o",
  "ü": "u", "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
  "ñ": "n", "ç": "c", "β": "b", "ɑ": "a", "ℓ": "l", "℮": "e",
};

/** Normalize homoglyphs in a string */
export function normalizeHomoglyphs(text: string): string {
  return text
    .split("")
    .map((ch) => HOMOGLYPH_MAP[ch] ?? ch)
    .join("");
}

/** Strip known prompt injection patterns */
export function stripInjections(text: string): string {
  let result = text;
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/** Truncate text to maxLength with a note */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + `\n...[truncated at ${maxLength} chars]`;
}

/** Full sanitization pipeline for issue title/body */
export function sanitizeIssueText(
  text: string,
  maxLength: number = 10_000
): string {
  if (!text || typeof text !== "string") return "";
  let result = normalizeHomoglyphs(text);
  result = stripInjections(result);
  result = truncate(result, maxLength);
  return result;
}

/** Wrap user-supplied text in XML-style delimiters to isolate from prompt */
export function delimit(content: string, tag: string = "user_content"): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

/** Sanitize and delimit in one step */
export function sanitizeAndDelimit(
  text: string,
  tag: string = "user_content",
  maxLength: number = 10_000
): string {
  return delimit(sanitizeIssueText(text, maxLength), tag);
}
