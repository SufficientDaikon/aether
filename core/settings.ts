// -----------------------------------------------------------------
// AETHER Settings Manager
//
// Persistent, validated settings file that surfaces ALL tunable
// knobs across AETHER's subsystems into .aether/settings.json.
// Separate from config.json (auto-generated). Settings is the
// user-editable file where humans tune behavior.
// -----------------------------------------------------------------

import type { AetherSettings, WorkspaceProfile } from "./types.ts";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// -----------------------------------------------------------------
// Default Settings
// -----------------------------------------------------------------

const DEFAULT_SETTINGS: AetherSettings = {
  methodology: {
    mode: "tdd",
    specDir: "specs/",
    autoImplement: true,
    autoTest: true,
    testCommand: "bun test",
  },
  agents: {
    maxConcurrent: 10,
    tiers: {
      master: { maxAgents: 1 },
      manager: { maxAgents: 3 },
      worker: { maxAgents: 10 },
    },
    defaultTier: "worker",
  },
  execution: {
    maxDepth: 3,
    defaultTimeoutMs: 120_000,
    maxTokens: 4096,
    temperature: 0.7,
    enableEscalation: true,
    enableSubTasks: true,
    useInteractionNet: false,
    useRAGContext: false,
    ragTopK: 3,
    useMemoryHighway: false,
  },
  escalation: {
    threshold: 3,
    windowMs: 300_000,
  },
  routing: {
    confidenceThreshold: 0.6,
    activeContext: "default",
    contexts: { default: ["*"] },
    contextFallback: true,
    cache: {
      enabled: true,
      maxSize: 200,
      ttlMs: 300_000,
    },
  },
  conversation: {
    maxMessages: 100,
  },
  handoff: {
    maxChainLength: 5,
  },
  progress: {
    maxTokenBudget: 500_000,
    maxWallClockMs: 600_000,
    stallThresholdMs: 60_000,
    loopSimilarityThreshold: 0.9,
    maxConsecutiveSimilar: 3,
  },
  highway: {
    enableRAG: true,
    enableDedup: true,
    dedupWindowMs: 5_000,
    maxRetainedMessages: 10_000,
    kvTTL: 3_600_000,
    indexMinPriority: 1,
  },
  acp: {
    defaultRequestTimeoutMs: 30_000,
    maxRetries: 3,
    trackCommGraph: true,
    trackAcknowledgments: true,
    maxDeadLetters: 100,
  },
  logging: {
    level: "info",
    maxRetainedEntries: 5000,
    forwardToSynapse: true,
  },
  sharedState: {
    cleanupIntervalMs: 300_000,
    maxTransitionsPerSession: 1000,
    publishChanges: true,
    persistSessions: true,
  },
  server: {
    port: 9999,
    host: "localhost",
  },
};

// -----------------------------------------------------------------
// Validation Rules
// -----------------------------------------------------------------

interface ValidationRule {
  path: string;
  check: (value: unknown) => string | null;
}

const VALIDATION_RULES: ValidationRule[] = [
  // Methodology
  {
    path: "methodology.mode",
    check: (v) =>
      ["tdd", "sdd", "hybrid"].includes(v as string)
        ? null
        : `methodology.mode must be "tdd", "sdd", or "hybrid" (got "${v}")`,
  },
  {
    path: "methodology.specDir",
    check: (v) =>
      typeof v === "string" && v.length > 0
        ? null
        : "methodology.specDir must be a non-empty string",
  },
  // Agents
  {
    path: "agents.maxConcurrent",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 100
        ? null
        : "agents.maxConcurrent must be between 1 and 100",
  },
  {
    path: "agents.tiers",
    check: (v) => {
      if (typeof v !== "object" || v === null || Array.isArray(v))
        return "agents.tiers must be an object";
      for (const [key, entry] of Object.entries(v as Record<string, unknown>)) {
        if (typeof entry !== "object" || entry === null)
          return `agents.tiers.${key} must be an object`;
        const e = entry as Record<string, unknown>;
        if (e.maxAgents !== undefined && (typeof e.maxAgents !== "number" || e.maxAgents < 1 || e.maxAgents > 200))
          return `agents.tiers.${key}.maxAgents must be between 1 and 200`;
      }
      return null;
    },
  },
  {
    path: "agents.defaultTier",
    check: (v) =>
      typeof v === "string" && (v as string).length > 0
        ? null
        : `agents.defaultTier must be a non-empty string (got "${v}")`,
  },
  // Execution
  {
    path: "execution.maxDepth",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 10
        ? null
        : "execution.maxDepth must be between 1 and 10",
  },
  {
    path: "execution.defaultTimeoutMs",
    check: (v) =>
      typeof v === "number" && v >= 1000 && v <= 3_600_000
        ? null
        : "execution.defaultTimeoutMs must be between 1000 and 3600000",
  },
  {
    path: "execution.maxTokens",
    check: (v) =>
      typeof v === "number" && v >= 100 && v <= 1_000_000
        ? null
        : "execution.maxTokens must be between 100 and 1000000",
  },
  {
    path: "execution.temperature",
    check: (v) =>
      typeof v === "number" && v >= 0 && v <= 2
        ? null
        : "execution.temperature must be between 0 and 2",
  },
  // Escalation
  {
    path: "escalation.threshold",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 100
        ? null
        : "escalation.threshold must be between 1 and 100",
  },
  {
    path: "escalation.windowMs",
    check: (v) =>
      typeof v === "number" && v >= 1000
        ? null
        : "escalation.windowMs must be at least 1000",
  },
  // Routing
  {
    path: "routing.confidenceThreshold",
    check: (v) =>
      typeof v === "number" && v >= 0 && v <= 1
        ? null
        : "routing.confidenceThreshold must be between 0 and 1",
  },
  {
    path: "routing.activeContext",
    check: (v) =>
      typeof v === "string" && v.length > 0
        ? null
        : "routing.activeContext must be a non-empty string",
  },
  {
    path: "routing.contexts",
    check: (v) => {
      if (typeof v !== "object" || v === null || Array.isArray(v))
        return "routing.contexts must be an object";
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (!Array.isArray(val))
          return `routing.contexts.${key} must be an array of agent IDs`;
        for (const item of val) {
          if (typeof item !== "string")
            return `routing.contexts.${key} must contain only strings`;
        }
      }
      return null;
    },
  },
  {
    path: "routing.cache.enabled",
    check: (v) =>
      typeof v === "boolean"
        ? null
        : "routing.cache.enabled must be a boolean",
  },
  {
    path: "routing.cache.maxSize",
    check: (v) =>
      typeof v === "number" && v >= 10 && v <= 10_000
        ? null
        : "routing.cache.maxSize must be between 10 and 10000",
  },
  {
    path: "routing.cache.ttlMs",
    check: (v) =>
      typeof v === "number" && v >= 1000 && v <= 3_600_000
        ? null
        : "routing.cache.ttlMs must be between 1000 and 3600000",
  },
  // Conversation
  {
    path: "conversation.maxMessages",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 10_000
        ? null
        : "conversation.maxMessages must be between 1 and 10000",
  },
  // Handoff
  {
    path: "handoff.maxChainLength",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 50
        ? null
        : "handoff.maxChainLength must be between 1 and 50",
  },
  // Progress
  {
    path: "progress.maxTokenBudget",
    check: (v) =>
      typeof v === "number" && v >= 1000
        ? null
        : "progress.maxTokenBudget must be at least 1000",
  },
  {
    path: "progress.maxWallClockMs",
    check: (v) =>
      typeof v === "number" && v >= 1000
        ? null
        : "progress.maxWallClockMs must be at least 1000",
  },
  {
    path: "progress.stallThresholdMs",
    check: (v) =>
      typeof v === "number" && v >= 1000
        ? null
        : "progress.stallThresholdMs must be at least 1000",
  },
  {
    path: "progress.loopSimilarityThreshold",
    check: (v) =>
      typeof v === "number" && v >= 0 && v <= 1
        ? null
        : "progress.loopSimilarityThreshold must be between 0 and 1",
  },
  {
    path: "progress.maxConsecutiveSimilar",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 100
        ? null
        : "progress.maxConsecutiveSimilar must be between 1 and 100",
  },
  // Logging
  {
    path: "logging.level",
    check: (v) =>
      ["debug", "info", "warn", "error"].includes(v as string)
        ? null
        : `logging.level must be "debug", "info", "warn", or "error" (got "${v}")`,
  },
  {
    path: "logging.maxRetainedEntries",
    check: (v) =>
      typeof v === "number" && v >= 100 && v <= 100_000
        ? null
        : "logging.maxRetainedEntries must be between 100 and 100000",
  },
  // Server
  {
    path: "server.port",
    check: (v) =>
      typeof v === "number" && v >= 1 && v <= 65535
        ? null
        : "server.port must be between 1 and 65535",
  },
  {
    path: "server.host",
    check: (v) =>
      typeof v === "string" && v.length > 0
        ? null
        : "server.host must be a non-empty string",
  },
];

// -----------------------------------------------------------------
// Settings Manager
// -----------------------------------------------------------------

export class SettingsManager {
  private settingsPath: string;
  private aetherDir: string;
  private currentSettings: AetherSettings | null = null;

  constructor(aetherDir: string) {
    this.aetherDir = aetherDir;
    this.settingsPath = join(aetherDir, "settings.json");
  }

  /** Get the default settings object */
  static defaults(): AetherSettings {
    return structuredClone(DEFAULT_SETTINGS);
  }

  /** Check if settings file exists */
  exists(): boolean {
    return existsSync(this.settingsPath);
  }

  /** Get the path to the settings file */
  getPath(): string {
    return this.settingsPath;
  }

  /**
   * Load settings from .aether/settings.json.
   * Deep-merges user overrides with defaults so missing keys get defaults.
   */
  load(): AetherSettings {
    const defaults = SettingsManager.defaults();

    if (!this.exists()) {
      this.currentSettings = defaults;
      return defaults;
    }

    try {
      const raw = readFileSync(this.settingsPath, "utf-8");
      const userSettings = JSON.parse(raw);

      // ── Migration: old tier format → new tier format ──
      migrateTierSettings(userSettings);

      const merged = deepMerge(defaults, userSettings) as AetherSettings;
      this.currentSettings = merged;
      return merged;
    } catch {
      // Corrupt settings file — return defaults
      this.currentSettings = defaults;
      return defaults;
    }
  }

  /** Save settings to .aether/settings.json */
  save(settings: AetherSettings): void {
    if (!existsSync(this.aetherDir)) {
      mkdirSync(this.aetherDir, { recursive: true });
    }
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2) + "\n");
    this.currentSettings = settings;
  }

  /**
   * Get a nested value by dot-path.
   * Example: get("execution.maxDepth") → 3
   */
  get<T = unknown>(path: string): T | undefined {
    if (!this.currentSettings) this.load();
    return getByPath(this.currentSettings!, path) as T | undefined;
  }

  /**
   * Set a nested value by dot-path, then save.
   * Example: set("execution.maxDepth", 5)
   */
  set(path: string, value: unknown): void {
    if (!this.currentSettings) this.load();
    setByPath(this.currentSettings!, path, value);
    this.save(this.currentSettings!);
  }

  /**
   * Reset settings to defaults.
   * If section is provided, only that top-level section is reset.
   */
  reset(section?: string): void {
    const defaults = SettingsManager.defaults();

    if (!section) {
      this.save(defaults);
      return;
    }

    if (!this.currentSettings) this.load();

    // Check if section exists in defaults
    if (section in defaults) {
      (this.currentSettings as Record<string, unknown>)[section] = (
        defaults as Record<string, unknown>
      )[section];
      this.save(this.currentSettings!);
    }
  }

  /**
   * Validate a settings object.
   * Checks types, ranges, and enum values.
   */
  validate(settings: Partial<AetherSettings>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    for (const rule of VALIDATION_RULES) {
      const value = getByPath(settings as Record<string, unknown>, rule.path);
      if (value === undefined) continue; // Skip missing fields (partial)

      const error = rule.check(value);
      if (error) errors.push(error);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Auto-detect test command from a workspace profile.
   */
  static detectTestCommand(workspace: WorkspaceProfile): string {
    const pm = workspace.packageManager;
    const tests = workspace.testFramework;

    // Bun runtime
    if (pm === "bun") {
      return "bun test";
    }

    // Specific test frameworks
    if (tests.includes("vitest")) {
      if (pm === "pnpm") return "pnpm vitest";
      if (pm === "yarn") return "yarn vitest";
      return "npx vitest";
    }

    if (tests.includes("jest")) {
      if (pm === "pnpm") return "pnpm jest";
      if (pm === "yarn") return "yarn jest";
      return "npx jest";
    }

    if (tests.includes("playwright")) {
      if (pm === "pnpm") return "pnpm playwright test";
      if (pm === "yarn") return "yarn playwright test";
      return "npx playwright test";
    }

    if (tests.includes("mocha")) {
      if (pm === "pnpm") return "pnpm mocha";
      if (pm === "yarn") return "yarn mocha";
      return "npx mocha";
    }

    if (tests.includes("cypress")) {
      if (pm === "pnpm") return "pnpm cypress run";
      if (pm === "yarn") return "yarn cypress run";
      return "npx cypress run";
    }

    // Generic fallback based on package manager
    if (pm === "pnpm") return "pnpm test";
    if (pm === "yarn") return "yarn test";
    if (pm === "npm") return "npm test";

    return "npm test";
  }
}

// -----------------------------------------------------------------
// Migration: Old tier format → New tier format
// -----------------------------------------------------------------

/**
 * Detect old-style { maxMasters, maxManagers, maxWorkers } and convert
 * to new { master: { maxAgents }, manager: { maxAgents }, worker: { maxAgents } }.
 * Mutates the object in-place.
 */
function migrateTierSettings(settings: Record<string, unknown>): void {
  const agents = settings.agents as Record<string, unknown> | undefined;
  if (!agents?.tiers || typeof agents.tiers !== "object") return;

  const tiers = agents.tiers as Record<string, unknown>;

  // Detect old format: has maxMasters/maxManagers/maxWorkers
  if ("maxMasters" in tiers || "maxManagers" in tiers || "maxWorkers" in tiers) {
    const migrated: Record<string, { maxAgents: number }> = {};

    if (typeof tiers.maxMasters === "number") {
      migrated.master = { maxAgents: tiers.maxMasters };
    }
    if (typeof tiers.maxManagers === "number") {
      migrated.manager = { maxAgents: tiers.maxManagers };
    }
    if (typeof tiers.maxWorkers === "number") {
      migrated.worker = { maxAgents: tiers.maxWorkers };
    }

    agents.tiers = migrated;
  }
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

/** Deep-merge two objects. Source values override target. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

/** Get a value from a nested object by dot-path. */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/** Set a value in a nested object by dot-path. */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      current[part] === null ||
      current[part] === undefined ||
      typeof current[part] !== "object"
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}
