// -----------------------------------------------------------------
// AETHER Powers — Dynamic Activation
// -----------------------------------------------------------------

import type { InstalledPower } from "./schema.ts";

/** Context supplied when evaluating which powers should be active */
export interface ConversationContext {
  messages: string[];
  openFiles: string[];
  explicitPowers?: string[];
}

/** Result of activation evaluation */
export interface ActivationResult {
  activated: InstalledPower[];
  reasons: Map<string, string>;
}

// -----------------------------------------------------------------
// Glob-like pattern matching (simple subset: *, **, ?)
// -----------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/" || pattern[i] === "\\") i++;
        continue;
      }
      re += "[^/\\\\]*";
    } else if (ch === "?") {
      re += "[^/\\\\]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
    i++;
  }
  return new RegExp("^" + re + "$", "i");
}

// -----------------------------------------------------------------
// DynamicActivator
// -----------------------------------------------------------------

export class DynamicActivator {
  /**
   * Evaluate which powers should be activated given the current context.
   */
  evaluate(powers: InstalledPower[], context: ConversationContext): ActivationResult {
    const activated: InstalledPower[] = [];
    const reasons = new Map<string, string>();

    for (const power of powers) {
      const { activation } = power.manifest;
      const isManual = activation.manual === true;

      // 1. Explicit selection always wins
      if (context.explicitPowers?.includes(power.manifest.name)) {
        activated.push(power);
        reasons.set(power.manifest.name, "explicit selection");
        continue;
      }

      // If manual-only, skip automatic checks
      if (isManual) continue;

      // 2. Keyword matching (case-insensitive word boundary)
      const keywordMatch = this.matchKeywords(activation.keywords, context.messages);
      if (keywordMatch) {
        activated.push(power);
        reasons.set(power.manifest.name, `keyword match: "${keywordMatch}"`);
        continue;
      }

      // 3. File pattern matching
      if (activation.filePatterns && activation.filePatterns.length > 0) {
        const fileMatch = this.matchFilePatterns(activation.filePatterns, context.openFiles);
        if (fileMatch) {
          activated.push(power);
          reasons.set(power.manifest.name, `file pattern match: "${fileMatch}"`);
          continue;
        }
      }
    }

    return { activated, reasons };
  }

  /** Check if any keyword appears in any message (case-insensitive word boundary) */
  private matchKeywords(keywords: string[], messages: string[]): string | null {
    const joinedMessages = messages.join(" ");
    for (const keyword of keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      if (re.test(joinedMessages)) {
        return keyword;
      }
    }
    return null;
  }

  /** Check if any open file matches any of the glob patterns */
  private matchFilePatterns(patterns: string[], files: string[]): string | null {
    for (const pattern of patterns) {
      const re = globToRegex(pattern);
      for (const file of files) {
        const normalized = file.replace(/\\/g, "/");
        if (re.test(normalized) || re.test(file)) {
          return pattern;
        }
      }
    }
    return null;
  }
}
