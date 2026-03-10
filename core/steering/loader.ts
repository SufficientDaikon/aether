// ─────────────────────────────────────────────────────────────
// Steering Loader — loads .md steering files from .aether/steering/
// with fallback to CLAUDE.md / .aether/config.json
// ─────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/** Parsed YAML front matter from a steering file */
export interface SteeringMeta {
  scope: string;
  priority: number;
  tags: string[];
}

/** A loaded steering file with its metadata and content */
export interface SteeringFile {
  path: string;
  filename: string;
  meta: SteeringMeta;
  content: string;
  rawContent: string;
}

const DEFAULT_META: SteeringMeta = {
  scope: "global",
  priority: 5,
  tags: [],
};

/**
 * Parse optional YAML front matter delimited by --- lines.
 * Returns the metadata and the remaining markdown body.
 */
export function parseFrontMatter(raw: string): { meta: Partial<SteeringMeta>; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { meta: {}, body: raw };
  }

  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) {
    return { meta: {}, body: raw };
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trimStart();
  const meta: Partial<SteeringMeta> = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === "scope") {
      meta.scope = val;
    } else if (key === "priority") {
      const num = parseInt(val, 10);
      if (!isNaN(num) && num >= 1 && num <= 10) {
        meta.priority = num;
      }
    } else if (key === "tags") {
      // Parse [tag1, tag2] or tag1, tag2
      const cleaned = val.replace(/^\[|\]$/g, "");
      meta.tags = cleaned.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  return { meta, body };
}

/**
 * Load a single .md file as a SteeringFile.
 */
export function loadSteeringFile(filePath: string): SteeringFile {
  const rawContent = readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontMatter(rawContent);

  return {
    path: filePath,
    filename: basename(filePath),
    meta: { ...DEFAULT_META, ...meta },
    content: body,
    rawContent,
  };
}

/**
 * Load all .md files from a directory (non-recursive).
 */
function loadMdFilesFromDir(dirPath: string): SteeringFile[] {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return [];

  const entries = readdirSync(dirPath).filter((f) => f.endsWith(".md")).sort();
  return entries.map((f) => loadSteeringFile(join(dirPath, f)));
}

/**
 * Load CLAUDE.md as a fallback steering file (global scope, priority 3).
 */
function loadClaudeMd(workspace: string): SteeringFile | null {
  const claudePath = join(workspace, "CLAUDE.md");
  if (!existsSync(claudePath)) return null;

  const rawContent = readFileSync(claudePath, "utf-8");
  return {
    path: claudePath,
    filename: "CLAUDE.md",
    meta: { scope: "global", priority: 3, tags: ["fallback"] },
    content: rawContent,
    rawContent,
  };
}

/**
 * Load .aether/config.json steering section as a fallback.
 */
function loadConfigSteering(workspace: string): SteeringFile | null {
  const configPath = join(workspace, ".aether", "config.json");
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (!config.steering) return null;

    const content =
      typeof config.steering === "string"
        ? config.steering
        : JSON.stringify(config.steering, null, 2);

    return {
      path: configPath,
      filename: "config.json",
      meta: { scope: "global", priority: 2, tags: ["fallback", "config"] },
      content,
      rawContent: raw,
    };
  } catch {
    return null;
  }
}

export interface LoadSteeringResult {
  files: SteeringFile[];
  source: "steering-dir" | "fallback" | "merged";
}

/**
 * Load steering files from workspace.
 *
 * Strategy:
 *  1. If .aether/steering/ exists → load from there
 *  2. Fallback to CLAUDE.md and .aether/config.json
 *  3. If both exist → merge (steering dir wins on conflict via higher default priority)
 */
export function loadSteering(workspace: string): LoadSteeringResult {
  const steeringDir = join(workspace, ".aether", "steering");
  const steeringFiles = loadMdFilesFromDir(steeringDir);

  const fallbackFiles: SteeringFile[] = [];
  const claude = loadClaudeMd(workspace);
  if (claude) fallbackFiles.push(claude);
  const configSteering = loadConfigSteering(workspace);
  if (configSteering) fallbackFiles.push(configSteering);

  if (steeringFiles.length > 0 && fallbackFiles.length > 0) {
    // Merge: steering dir files + fallback files that don't conflict
    return { files: [...steeringFiles, ...fallbackFiles], source: "merged" };
  }

  if (steeringFiles.length > 0) {
    return { files: steeringFiles, source: "steering-dir" };
  }

  return { files: fallbackFiles, source: "fallback" };
}
