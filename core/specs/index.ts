// ─────────────────────────────────────────────────────────────
// Specs Module — barrel export
// ─────────────────────────────────────────────────────────────

export {
  parseWhenShall,
  parseRequirements,
  parseTasks,
  validateSpec,
  type AcceptanceCriterion,
  type Requirement,
  type TaskStatus,
  type TaskNode,
  type ParsedSpec,
  type ValidationResult,
} from "./parser.ts";

export {
  toKebabCase,
  createSpec,
  listSpecs,
  loadSpec,
  validateSpecByPath,
  updateTaskStatus,
  type SpecInfo,
} from "./executor.ts";

export {
  getRequirementsTemplate,
  getDesignTemplate,
  getTasksTemplate,
} from "./templates.ts";
