// ─────────────────────────────────────────────────────────────
// Specs Executor — file-system operations for spec management
// (create, list, validate, update task status)
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import {
  parseRequirements,
  parseTasks,
  validateSpec,
  type ParsedSpec,
  type ValidationResult,
  type TaskStatus,
} from "./parser.ts";
import { getRequirementsTemplate, getDesignTemplate, getTasksTemplate } from "./templates.ts";

/** Convert a name to kebab-case */
export function toKebabCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Spec directory info */
export interface SpecInfo {
  name: string;
  path: string;
  hasRequirements: boolean;
  hasDesign: boolean;
  hasTasks: boolean;
}

/** Get the specs base directory */
function specsDir(workspace: string): string {
  return join(workspace, ".aether", "specs");
}

/**
 * Create a new spec from templates.
 * Creates .aether/specs/{kebab-name}/ with requirements.md, design.md, tasks.md
 */
export function createSpec(
  workspace: string,
  name: string,
  description?: string,
): SpecInfo {
  const kebabName = toKebabCase(name);
  const specPath = join(specsDir(workspace), kebabName);

  if (existsSync(specPath)) {
    throw new Error(`Spec "${kebabName}" already exists at ${specPath}`);
  }

  mkdirSync(specPath, { recursive: true });

  const placeholders = {
    SPEC_NAME: name,
    SPEC_SLUG: kebabName,
    DESCRIPTION: description || "TODO: Add description",
    DATE: new Date().toISOString().split("T")[0],
  };

  writeFileSync(join(specPath, "requirements.md"), fillTemplate(getRequirementsTemplate(), placeholders));
  writeFileSync(join(specPath, "design.md"), fillTemplate(getDesignTemplate(), placeholders));
  writeFileSync(join(specPath, "tasks.md"), fillTemplate(getTasksTemplate(), placeholders));

  return {
    name: kebabName,
    path: specPath,
    hasRequirements: true,
    hasDesign: true,
    hasTasks: true,
  };
}

/** Fill template placeholders */
function fillTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
  }
  return result;
}

/**
 * List all specs in the workspace.
 */
export function listSpecs(workspace: string): SpecInfo[] {
  const dir = specsDir(workspace);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => {
      const p = join(dir, name);
      return existsSync(p) && statSync(p).isDirectory();
    })
    .sort()
    .map((name) => {
      const p = join(dir, name);
      return {
        name,
        path: p,
        hasRequirements: existsSync(join(p, "requirements.md")),
        hasDesign: existsSync(join(p, "design.md")),
        hasTasks: existsSync(join(p, "tasks.md")),
      };
    });
}

/**
 * Load and parse a spec from disk.
 */
export function loadSpec(specPath: string): ParsedSpec {
  const reqPath = join(specPath, "requirements.md");
  const designPath = join(specPath, "design.md");
  const tasksPath = join(specPath, "tasks.md");

  const requirements = existsSync(reqPath)
    ? parseRequirements(readFileSync(reqPath, "utf-8"))
    : [];

  const designContent = existsSync(designPath)
    ? readFileSync(designPath, "utf-8")
    : "";

  const tasks = existsSync(tasksPath)
    ? parseTasks(readFileSync(tasksPath, "utf-8"))
    : [];

  return { requirements, tasks, designContent };
}

/**
 * Validate a spec by path.
 */
export function validateSpecByPath(specPath: string): ValidationResult {
  const spec = loadSpec(specPath);
  return validateSpec(spec);
}

/** Status to checkbox marker */
const STATUS_TO_MARKER: Record<TaskStatus, string> = {
  pending: " ",
  done: "x",
  failed: "!",
  checkpoint: "*",
  optional: "?",
};

/**
 * Update a task's status in tasks.md.
 * Finds the task by ID and changes its checkbox marker.
 */
export function updateTaskStatus(
  specPath: string,
  taskId: string,
  newStatus: TaskStatus,
): void {
  const tasksPath = join(specPath, "tasks.md");
  if (!existsSync(tasksPath)) {
    throw new Error(`tasks.md not found at ${tasksPath}`);
  }

  const content = readFileSync(tasksPath, "utf-8");
  const marker = STATUS_TO_MARKER[newStatus];
  const lines = content.split("\n");
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match header task: ## 1. [x] Title or ## 1. Title (no checkbox — skip)
    const headerMatch = line.match(
      /^(##\s+\d+\.?\s*)\[([ x!X?*])\](\s*.+)$/,
    );
    if (headerMatch) {
      // Extract the task ID from the header
      const idMatch = line.match(/^##\s+(\d+)/);
      if (idMatch && idMatch[1] === taskId) {
        lines[i] = `${headerMatch[1]}[${marker}]${headerMatch[3]}`;
        updated = true;
        continue;
      }
    }

    // Match subtask: - [x] 1.1 Title or * [ ] 1.2 Title
    const subMatch = line.match(
      /^(\s*[-*+]\s*)\[([ x!X?*])\](\s*(?:\d+(?:\.\d+)*)\s*\.?\s*.+)$/,
    );
    if (subMatch) {
      const subIdMatch = line.match(/\[.\]\s*(\d+(?:\.\d+)*)/);
      if (subIdMatch && subIdMatch[1] === taskId) {
        lines[i] = `${subMatch[1]}[${marker}]${subMatch[3]}`;
        updated = true;
        continue;
      }
    }
  }

  if (!updated) {
    throw new Error(`Task "${taskId}" not found in ${tasksPath}`);
  }

  writeFileSync(tasksPath, lines.join("\n"));
}
