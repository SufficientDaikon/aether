/**
 * Minimal YAML subset parser for AETHER hook files.
 *
 * Supports: key: value, nested objects (indentation), arrays (- item),
 * booleans, numbers, quoted strings, and inline arrays [a, b].
 *
 * For production reliability, .hook.json is the canonical format.
 * This parser handles the YAML subset needed for hook template files.
 */

export function parseYaml(input: string): Record<string, unknown> {
  const lines = input.split(/\r?\n/);
  return parseBlock(lines, 0, 0).value as Record<string, unknown>;
}

interface ParseResult {
  value: unknown;
  endIndex: number;
}

function parseBlock(lines: string[], startIndex: number, baseIndent: number): ParseResult {
  const result: Record<string, unknown> = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const indent = getIndent(line);

    // If dedented past our block, stop
    if (indent < baseIndent) {
      break;
    }

    // Auto-detect base indent on first real line
    if (indent > baseIndent && Object.keys(result).length === 0) {
      baseIndent = indent;
    } else if (indent > baseIndent) {
      break;
    }

    const trimmed = line.trim();

    // Array item at this level — shouldn't happen in object context
    if (trimmed.startsWith('- ')) {
      break;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.substring(0, colonIdx).trim();
    const rawValue = trimmed.substring(colonIdx + 1).trim();

    if (rawValue === '' || rawValue === '|') {
      // Check if next lines are array items or nested object
      const nextNonEmpty = findNextNonEmpty(lines, i + 1);
      if (nextNonEmpty !== -1) {
        const nextIndent = getIndent(lines[nextNonEmpty]);
        const nextTrimmed = lines[nextNonEmpty].trim();
        if (nextIndent > indent && nextTrimmed.startsWith('- ')) {
          const arrResult = parseArray(lines, nextNonEmpty, nextIndent);
          result[key] = arrResult.value;
          i = arrResult.endIndex;
          continue;
        } else if (nextIndent > indent) {
          const blockResult = parseBlock(lines, nextNonEmpty, nextIndent);
          result[key] = blockResult.value;
          i = blockResult.endIndex;
          continue;
        }
      }
      result[key] = rawValue === '' ? null : '';
      i++;
      continue;
    }

    result[key] = parseValue(rawValue);
    i++;
  }

  return { value: result, endIndex: i };
}

function parseArray(lines: string[], startIndex: number, baseIndent: number): ParseResult {
  const result: unknown[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) break;

    const itemValue = trimmed.substring(2).trim();

    if (itemValue.includes(':') && !itemValue.startsWith('"') && !itemValue.startsWith("'")) {
      // Inline key:value in array item — check for nested block
      const nextNonEmpty = findNextNonEmpty(lines, i + 1);
      if (nextNonEmpty !== -1 && getIndent(lines[nextNonEmpty]) > indent + 2) {
        const colonIdx = itemValue.indexOf(':');
        const k = itemValue.substring(0, colonIdx).trim();
        const v = itemValue.substring(colonIdx + 1).trim();
        const obj: Record<string, unknown> = {};
        obj[k] = v === '' ? null : parseValue(v);

        const blockResult = parseBlock(lines, nextNonEmpty, getIndent(lines[nextNonEmpty]));
        Object.assign(obj, blockResult.value);
        result.push(obj);
        i = blockResult.endIndex;
        continue;
      }
      result.push(parseValue(itemValue));
    } else {
      result.push(parseValue(itemValue));
    }
    i++;
  }

  return { value: result, endIndex: i };
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;

  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Inline array [a, b, c]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => parseValue(s.trim()));
  }

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;

  return raw;
}

function getIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count++;
    else if (ch === '\t') count += 2;
    else break;
  }
  return count;
}

function findNextNonEmpty(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return i;
  }
  return -1;
}
