// ─────────────────────────────────────────────────────────────
// AETHER Guardrails Pipeline
//
// Pre/post LLM safety pipeline. Validates inputs before sending
// to the model and outputs after receiving. Configurable per-agent
// or global.
// ─────────────────────────────────────────────────────────────

import type {
  AgentDefinition,
  GuardResult,
  PreGuard,
  PostGuard,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────
// Guardrails Pipeline
// ─────────────────────────────────────────────────────────────

export class GuardrailsPipeline {
  private preGuards: PreGuard[] = [];
  private postGuards: PostGuard[] = [];

  /** Add a pre-LLM guard */
  addPreGuard(guard: PreGuard): this {
    this.preGuards.push(guard);
    return this;
  }

  /** Add a post-LLM guard */
  addPostGuard(guard: PostGuard): this {
    this.postGuards.push(guard);
    return this;
  }

  /** Remove a guard by ID */
  removeGuard(guardId: string): this {
    this.preGuards = this.preGuards.filter((g) => g.id !== guardId);
    this.postGuards = this.postGuards.filter((g) => g.id !== guardId);
    return this;
  }

  /**
   * Run all pre-guards on a prompt before sending to LLM.
   * Returns the first blocking result, or an allowed result with
   * any modifications accumulated.
   */
  runPre(prompt: string, agent: AgentDefinition): GuardResult {
    let currentPrompt = prompt;

    for (const guard of this.preGuards) {
      const result = guard.check(currentPrompt, agent);
      if (!result.allowed) {
        return result;
      }
      if (result.modified) {
        currentPrompt = result.modified;
      }
    }

    return currentPrompt !== prompt
      ? { allowed: true, modified: currentPrompt, guardId: "pipeline" }
      : { allowed: true, guardId: "pipeline" };
  }

  /**
   * Run all post-guards on LLM output.
   * Returns the first blocking result, or an allowed result with
   * any modifications accumulated.
   */
  runPost(output: string, agent: AgentDefinition): GuardResult {
    let currentOutput = output;

    for (const guard of this.postGuards) {
      const result = guard.check(currentOutput, agent);
      if (!result.allowed) {
        return result;
      }
      if (result.modified) {
        currentOutput = result.modified;
      }
    }

    return currentOutput !== output
      ? { allowed: true, modified: currentOutput, guardId: "pipeline" }
      : { allowed: true, guardId: "pipeline" };
  }

  /** Get all registered guard IDs */
  getGuardIds(): { pre: string[]; post: string[] } {
    return {
      pre: this.preGuards.map((g) => g.id),
      post: this.postGuards.map((g) => g.id),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Built-in Pre-Guards
// ─────────────────────────────────────────────────────────────

/** Detects common prompt injection patterns */
export class PromptInjectionGuard implements PreGuard {
  id = "prompt-injection";

  private patterns: RegExp[] = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /disregard\s+(all\s+)?prior\s+(instructions|rules)/i,
    /you\s+are\s+now\s+(?:a|an)\s+(?:different|new)\s+(?:ai|assistant|model)/i,
    /system\s*:\s*you\s+are/i,
    /\bDAN\b.*\bjailbreak/i,
    /pretend\s+(?:you\s+)?(?:are|to\s+be)\s+(?:a|an)\s+AI\s+(?:without|with\s+no)\s+(?:rules|restrictions)/i,
    /override\s+(?:your\s+)?(?:system|safety)\s+(?:prompt|instructions)/i,
  ];

  check(prompt: string, _agent: AgentDefinition): GuardResult {
    for (const pattern of this.patterns) {
      if (pattern.test(prompt)) {
        return {
          allowed: false,
          reason: `Potential prompt injection detected: ${pattern.source}`,
          guardId: this.id,
        };
      }
    }
    return { allowed: true, guardId: this.id };
  }
}

/** Caps prompt length to prevent context window abuse */
export class LengthGuard implements PreGuard {
  id = "length";
  private maxLength: number;

  constructor(maxLength: number = 50_000) {
    this.maxLength = maxLength;
  }

  check(prompt: string, _agent: AgentDefinition): GuardResult {
    if (prompt.length > this.maxLength) {
      return {
        allowed: false,
        reason: `Prompt exceeds max length: ${prompt.length} > ${this.maxLength}`,
        guardId: this.id,
      };
    }
    return { allowed: true, guardId: this.id };
  }
}

/** Scans for API keys, passwords, and PII before sending to LLM */
export class SensitiveDataGuard implements PreGuard {
  id = "sensitive-data";

  private patterns: Array<{ name: string; pattern: RegExp }> = [
    { name: "AWS key", pattern: /AKIA[0-9A-Z]{16}/ },
    { name: "GitHub token", pattern: /ghp_[A-Za-z0-9]{36}/ },
    {
      name: "Generic API key",
      pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9\-_.]{20,}['"]/i,
    },
    { name: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9\-_.]{20,}/ },
    {
      name: "Private key",
      pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    },
    {
      name: "Password assignment",
      pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    },
  ];

  check(prompt: string, _agent: AgentDefinition): GuardResult {
    for (const { name, pattern } of this.patterns) {
      if (pattern.test(prompt)) {
        return {
          allowed: false,
          reason: `Sensitive data detected in prompt: ${name}`,
          guardId: this.id,
        };
      }
    }
    return { allowed: true, guardId: this.id };
  }
}

// ─────────────────────────────────────────────────────────────
// Built-in Post-Guards
// ─────────────────────────────────────────────────────────────

/** Scans generated code for dangerous patterns */
export class CodeSafetyGuard implements PostGuard {
  id = "code-safety";

  private patterns: Array<{ name: string; pattern: RegExp }> = [
    { name: "rm -rf /", pattern: /rm\s+-rf\s+\// },
    {
      name: "eval() with user input",
      pattern: /eval\s*\(\s*(?:req|request|input|user|params)/,
    },
    {
      name: "SQL injection risk",
      pattern: /(?:query|execute)\s*\(\s*['"`].*\$\{/,
    },
    { name: "chmod 777", pattern: /chmod\s+777/ },
    { name: "curl pipe to shell", pattern: /curl\s+.*\|\s*(?:ba)?sh/ },
    { name: "exec with concatenation", pattern: /exec\s*\(\s*['"`].*\+/ },
  ];

  check(output: string, _agent: AgentDefinition): GuardResult {
    const warnings: string[] = [];

    for (const { name, pattern } of this.patterns) {
      if (pattern.test(output)) {
        warnings.push(name);
      }
    }

    if (warnings.length > 0) {
      return {
        allowed: true, // Warn but allow — code review is advisory
        reason: `Code safety warnings: ${warnings.join(", ")}`,
        guardId: this.id,
      };
    }
    return { allowed: true, guardId: this.id };
  }
}

/** Validates output doesn't exceed reasonable length */
export class OutputLengthGuard implements PostGuard {
  id = "output-length";
  private maxLength: number;

  constructor(maxLength: number = 100_000) {
    this.maxLength = maxLength;
  }

  check(output: string, _agent: AgentDefinition): GuardResult {
    if (output.length > this.maxLength) {
      return {
        allowed: true,
        modified: output.slice(0, this.maxLength) + "\n\n[Output truncated]",
        reason: `Output truncated from ${output.length} to ${this.maxLength} chars`,
        guardId: this.id,
      };
    }
    return { allowed: true, guardId: this.id };
  }
}

// ─────────────────────────────────────────────────────────────
// Factory: Default Pipeline
// ─────────────────────────────────────────────────────────────

/** Creates a guardrails pipeline with all built-in guards */
export function createDefaultGuardrails(): GuardrailsPipeline {
  return new GuardrailsPipeline()
    .addPreGuard(new PromptInjectionGuard())
    .addPreGuard(new LengthGuard())
    .addPreGuard(new SensitiveDataGuard())
    .addPostGuard(new CodeSafetyGuard())
    .addPostGuard(new OutputLengthGuard());
}
