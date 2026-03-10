// ─────────────────────────────────────────────────────────────
// Specs Parser — parses requirements.md and tasks.md into
// structured data for spec-driven development
// ─────────────────────────────────────────────────────────────

/** A single acceptance criterion in WHEN/SHALL format */
export interface AcceptanceCriterion {
  id: string;
  when: string;
  shall: string;
  component: string;
  verified: boolean;
}

/** A parsed requirement from requirements.md */
export interface Requirement {
  id: string;
  title: string;
  userStory: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

/** Task status markers */
export type TaskStatus = "pending" | "done" | "failed" | "checkpoint" | "optional";

/** A node in the task tree */
export interface TaskNode {
  id: string;
  title: string;
  status: TaskStatus;
  subtasks: TaskNode[];
  requirementRefs: string[];
}

/** Full parsed spec */
export interface ParsedSpec {
  requirements: Requirement[];
  tasks: TaskNode[];
  designContent: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Requirements Parser ──────────────────────────────────────

/**
 * Parse a WHEN/SHALL acceptance criterion string.
 * Format: "WHEN <trigger>, THE <component> SHALL <behavior>"
 * Also handles: "WHEN <trigger>, <component> SHALL <behavior>"
 */
export function parseWhenShall(
  text: string,
  fallbackId: string,
): AcceptanceCriterion | null {
  // Flexible regex: WHEN ... , (THE)? <component> SHALL <behavior>
  const re = /WHEN\s+(.+?),\s*(?:THE\s+)?(.+?)\s+SHALL\s+(.+)/i;
  const match = text.match(re);
  if (!match) return null;

  return {
    id: fallbackId,
    when: match[1].trim(),
    shall: match[3].trim(),
    component: match[2].trim(),
    verified: false,
  };
}

/**
 * Parse requirements.md content into structured requirements.
 *
 * Expected format:
 * ## R01.1 — Title
 * or ## R01.1: Title
 * or ## R01.1 Title
 *
 * **User Story:** or **As a...** paragraph
 *
 * **Acceptance Criteria:**
 * - AC-01.1.1: WHEN x, THE y SHALL z
 * - [x] AC-01.1.2: WHEN... (verified)
 */
export function parseRequirements(content: string): Requirement[] {
  const requirements: Requirement[] = [];
  // Split by requirement headings (## R followed by ID)
  const sections = content.split(/^##\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split("\n");
    const headerLine = lines[0].trim();

    // Match requirement ID (e.g., R01.1, R1, R07.3)
    const idMatch = headerLine.match(/^(R[\d]+(?:\.[\d]+)?)\s*[—:\-–]\s*(.+)/i);
    if (!idMatch) {
      // Also try: just "R01.1 Title" without separator
      const simpleMatch = headerLine.match(/^(R[\d]+(?:\.[\d]+)?)\s+(.+)/i);
      if (!simpleMatch) continue;
      const req = parseRequirementSection(simpleMatch[1], simpleMatch[2], lines.slice(1));
      requirements.push(req);
      continue;
    }

    const req = parseRequirementSection(idMatch[1], idMatch[2].trim(), lines.slice(1));
    requirements.push(req);
  }

  return requirements;
}

function parseRequirementSection(
  id: string,
  title: string,
  bodyLines: string[],
): Requirement {
  const body = bodyLines.join("\n");
  let userStory = "";
  const criteria: AcceptanceCriterion[] = [];

  // Extract user story — look for "As a..." or "User Story:" block
  const storyMatch = body.match(
    /(?:\*\*User Story:?\*\*\s*\n?|As a\s)(.+?)(?=\n\n|\n\*\*|$)/is,
  );
  if (storyMatch) {
    userStory = storyMatch[0].replace(/\*\*User Story:?\*\*\s*/i, "").trim();
  }

  // Extract acceptance criteria
  const acSection = body.match(
    /(?:\*\*Acceptance Criteria:?\*\*|### Acceptance Criteria)\s*\n([\s\S]*?)(?=\n##|\n\*\*[A-Z]|$)/i,
  );
  const acText = acSection ? acSection[1] : body;

  // Match criterion lines: - AC-xx or - [x] AC-xx or numbered bullets
  const acLineRe = /[-*]\s*(?:\[([ x!])\]\s*)?(?:(AC[-_]?[\w.]+):?\s*)?(.+)/gi;
  let acMatch: RegExpExecArray | null;
  let acIdx = 0;

  while ((acMatch = acLineRe.exec(acText)) !== null) {
    const checkMark = acMatch[1];
    const acId = acMatch[2] || `${id}.AC${++acIdx}`;
    const acContent = acMatch[3].trim();

    const parsed = parseWhenShall(acContent, acId);
    if (parsed) {
      parsed.id = acId;
      parsed.verified = checkMark === "x";
      criteria.push(parsed);
    }
  }

  return { id, title, userStory, acceptanceCriteria: criteria };
}

// ── Tasks Parser ─────────────────────────────────────────────

const STATUS_MAP: Record<string, TaskStatus> = {
  " ": "pending",
  x: "done",
  X: "done",
  "!": "failed",
  "?": "optional",
  "*": "checkpoint",
};

/**
 * Parse tasks.md content into a tree of TaskNode objects.
 *
 * Expected format:
 * ## 1. Task Title
 * - [x] 1.1 Subtask one
 * - [ ] 1.2 Subtask two
 * _Requirements: R01.1, R01.2_
 */
export function parseTasks(content: string): TaskNode[] {
  const tasks: TaskNode[] = [];
  // Split into top-level task sections
  const sections = content.split(/^##\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split("\n");
    const headerLine = lines[0].trim();

    // Match: "1. Task Title" or "1 Task Title" or "1. [x] Task Title"
    const headerMatch = headerLine.match(
      /^(\d+)\.?\s*(?:\[([ x!?*])\]\s*)?(.+)/i,
    );
    if (!headerMatch) continue;

    const taskId = headerMatch[1];
    const headerStatus = headerMatch[2]
      ? STATUS_MAP[headerMatch[2]] || "pending"
      : "pending";
    const title = headerMatch[3].trim();

    const { subtasks, reqRefs } = parseSubtasks(lines.slice(1), taskId);

    tasks.push({
      id: taskId,
      title,
      status: headerStatus,
      subtasks,
      requirementRefs: reqRefs,
    });
  }

  return tasks;
}

function parseSubtasks(
  lines: string[],
  parentId: string,
): { subtasks: TaskNode[]; reqRefs: string[] } {
  const subtasks: TaskNode[] = [];
  let reqRefs: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for requirement references: _Requirements: R01.1, R01.2_
    const reqMatch = trimmed.match(
      /^[_*]?Requirements?:?\s*([^_*]+)[_*]?$/i,
    );
    if (reqMatch) {
      reqRefs = reqMatch[1]
        .split(/[,;]\s*/)
        .map((r) => r.trim())
        .filter(Boolean);
      continue;
    }

    // Match subtask line: - [x] 1.1 Title or * [ ] 1.2 Title
    const subMatch = trimmed.match(
      /^[-*+]\s*\[([ x!X?*])\]\s*(?:(\d+(?:\.\d+)*)\s*\.?\s*)?(.+)/,
    );
    if (subMatch) {
      const status = STATUS_MAP[subMatch[1]] || "pending";
      const subId = subMatch[2] || `${parentId}.${subtasks.length + 1}`;
      const subTitle = subMatch[3].trim();

      subtasks.push({
        id: subId,
        title: subTitle,
        status,
        subtasks: [],
        requirementRefs: [],
      });
    }
  }

  // Assign collected reqRefs to all subtasks and parent
  for (const st of subtasks) {
    st.requirementRefs = [...reqRefs];
  }

  return { subtasks, reqRefs };
}

// ── Spec Validation ──────────────────────────────────────────

/** Collect all requirement refs from a task tree */
function collectReqRefs(tasks: TaskNode[]): Set<string> {
  const refs = new Set<string>();
  for (const task of tasks) {
    for (const ref of task.requirementRefs) refs.add(ref);
    for (const sub of task.subtasks) {
      for (const ref of sub.requirementRefs) refs.add(ref);
    }
    // Recurse deeper if needed
    const subRefs = collectReqRefs(task.subtasks);
    for (const ref of subRefs) refs.add(ref);
  }
  return refs;
}

/** Collect all task+subtask nodes that have at least one requirementRef */
function collectTasksWithRefs(tasks: TaskNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.requirementRefs.length > 0) {
      map.set(task.id, task.requirementRefs);
    }
    for (const sub of task.subtasks) {
      if (sub.requirementRefs.length > 0) {
        map.set(sub.id, sub.requirementRefs);
      }
    }
  }
  return map;
}

/**
 * Validate a parsed spec for completeness and consistency.
 *
 * Checks:
 *  - Every task group should reference at least one requirement
 *  - Every requirement should be referenced by at least one task
 *  - No orphan requirement IDs in task refs
 */
export function validateSpec(spec: ParsedSpec): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const reqIds = new Set(spec.requirements.map((r) => r.id));
  const taskReqRefs = collectReqRefs(spec.tasks);
  const taskMap = collectTasksWithRefs(spec.tasks);

  // Check for tasks without requirement references
  for (const task of spec.tasks) {
    const hasRefs =
      task.requirementRefs.length > 0 ||
      task.subtasks.some((s) => s.requirementRefs.length > 0);
    if (!hasRefs) {
      errors.push(
        `Task ${task.id} ("${task.title}") does not reference any requirement`,
      );
    }
  }

  // Check for unreferenced requirements
  for (const req of spec.requirements) {
    if (!taskReqRefs.has(req.id)) {
      errors.push(
        `Requirement ${req.id} ("${req.title}") is not referenced by any task`,
      );
    }
  }

  // Check for orphan requirement IDs in task refs
  for (const ref of taskReqRefs) {
    if (!reqIds.has(ref)) {
      warnings.push(
        `Task references unknown requirement "${ref}"`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
