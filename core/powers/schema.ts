// -----------------------------------------------------------------
// AETHER Powers — Manifest Schema & Validation
// -----------------------------------------------------------------

/** MCP server configuration for a power */
export interface PowerMcpConfig {
  server: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

/** Activation rules that determine when a power becomes active */
export interface PowerActivation {
  keywords: string[];
  filePatterns?: string[];
  /** If true, only activate via explicit selection */
  manual?: boolean;
}

/** Dependency declarations */
export interface PowerDependencies {
  powers?: string[];
  npm?: Record<string, string>;
}

/** Complete power.json manifest */
export interface PowerManifest {
  name: string;
  version: string;
  description: string;
  provider: string;
  homepage?: string;
  license?: string;
  mcp?: PowerMcpConfig;
  steering?: string[];
  hooks?: string[];
  activation: PowerActivation;
  dependencies?: PowerDependencies;
}

/** An installed power with resolved paths */
export interface InstalledPower {
  manifest: PowerManifest;
  /** Absolute path to the power directory */
  installPath: string;
  /** When the power was installed */
  installedAt: string;
}

// -----------------------------------------------------------------
// Validation
// -----------------------------------------------------------------

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

export function validateManifest(data: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Manifest must be a JSON object"] };
  }

  const m = data as Record<string, unknown>;

  // Required string fields
  for (const field of ["name", "version", "description", "provider"] as const) {
    if (typeof m[field] !== "string" || (m[field] as string).trim() === "") {
      errors.push(`"${field}" is required and must be a non-empty string`);
    }
  }

  // Name format
  if (typeof m.name === "string" && !KEBAB_CASE_RE.test(m.name)) {
    errors.push(`"name" must be kebab-case (e.g. "my-power")`);
  }

  // Version format
  if (typeof m.version === "string" && !SEMVER_RE.test(m.version)) {
    errors.push(`"version" must be valid semver (e.g. "1.0.0")`);
  }

  // Activation (required)
  if (!m.activation || typeof m.activation !== "object" || Array.isArray(m.activation)) {
    errors.push(`"activation" is required and must be an object`);
  } else {
    const act = m.activation as Record<string, unknown>;
    if (!Array.isArray(act.keywords)) {
      errors.push(`"activation.keywords" must be an array of strings`);
    } else if (act.keywords.some((k: unknown) => typeof k !== "string")) {
      errors.push(`"activation.keywords" entries must be strings`);
    }
    if (act.filePatterns !== undefined) {
      if (!Array.isArray(act.filePatterns)) {
        errors.push(`"activation.filePatterns" must be an array of strings`);
      } else if (act.filePatterns.some((p: unknown) => typeof p !== "string")) {
        errors.push(`"activation.filePatterns" entries must be strings`);
      }
    }
    if (act.manual !== undefined && typeof act.manual !== "boolean") {
      errors.push(`"activation.manual" must be a boolean`);
    }
  }

  // Optional: mcp
  if (m.mcp !== undefined) {
    if (typeof m.mcp !== "object" || Array.isArray(m.mcp) || m.mcp === null) {
      errors.push(`"mcp" must be an object`);
    } else {
      const mcp = m.mcp as Record<string, unknown>;
      if (typeof mcp.server !== "string" || mcp.server.trim() === "") {
        errors.push(`"mcp.server" is required when mcp is specified`);
      }
    }
  }

  // Optional: steering
  if (m.steering !== undefined) {
    if (!Array.isArray(m.steering)) {
      errors.push(`"steering" must be an array of strings`);
    } else if (m.steering.some((s: unknown) => typeof s !== "string")) {
      errors.push(`"steering" entries must be strings`);
    }
  }

  // Optional: hooks
  if (m.hooks !== undefined) {
    if (!Array.isArray(m.hooks)) {
      errors.push(`"hooks" must be an array of strings`);
    } else if (m.hooks.some((h: unknown) => typeof h !== "string")) {
      errors.push(`"hooks" entries must be strings`);
    }
  }

  return { valid: errors.length === 0, errors };
}
