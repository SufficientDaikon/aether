// ─────────────────────────────────────────────────────────────
// Specs Parser Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "bun:test";
import {
  parseWhenShall,
  parseRequirements,
  parseTasks,
  validateSpec,
  type ParsedSpec,
} from "../../core/specs/parser.ts";

// ── parseWhenShall ───────────────────────────────────────────

describe("parseWhenShall", () => {
  it("should parse standard WHEN/SHALL format", () => {
    const result = parseWhenShall(
      "WHEN user clicks submit, THE form SHALL validate all fields",
      "AC-01",
    );
    expect(result).not.toBeNull();
    expect(result!.when).toBe("user clicks submit");
    expect(result!.component).toBe("form");
    expect(result!.shall).toBe("validate all fields");
  });

  it("should parse without THE keyword", () => {
    const result = parseWhenShall(
      "WHEN input is empty, validator SHALL reject the input",
      "AC-02",
    );
    expect(result).not.toBeNull();
    expect(result!.component).toBe("validator");
    expect(result!.shall).toBe("reject the input");
  });

  it("should be case-insensitive", () => {
    const result = parseWhenShall(
      "when user logs in, the auth module shall create a session",
      "AC-03",
    );
    expect(result).not.toBeNull();
    expect(result!.when).toBe("user logs in");
    expect(result!.component).toBe("auth module");
    expect(result!.shall).toBe("create a session");
  });

  it("should return null for non-matching text", () => {
    expect(parseWhenShall("This is just a regular sentence.", "AC-04")).toBeNull();
    expect(parseWhenShall("WHEN only with no SHALL", "AC-05")).toBeNull();
  });

  it("should handle complex triggers", () => {
    const result = parseWhenShall(
      "WHEN the user provides a file path that does not exist, THE loader SHALL throw a descriptive error",
      "AC-06",
    );
    expect(result).not.toBeNull();
    expect(result!.when).toBe("the user provides a file path that does not exist");
    expect(result!.shall).toBe("throw a descriptive error");
  });
});

// ── parseRequirements ────────────────────────────────────────

describe("parseRequirements", () => {
  const sampleRequirements = `# Feature Requirements

## R01 — User Authentication

**User Story:** As a user, I want to log in securely so that my data is protected.

**Acceptance Criteria:**

- AC-01.1: WHEN user provides valid credentials, THE auth system SHALL grant access
- AC-01.2: WHEN user provides invalid credentials, THE auth system SHALL deny access and show error

## R02 — Data Validation

**User Story:** As a developer, I want input validation so that bad data is rejected.

**Acceptance Criteria:**

- AC-02.1: WHEN required fields are missing, THE validator SHALL return validation errors
- AC-02.2: WHEN all fields are valid, THE validator SHALL accept the input
`;

  it("should parse multiple requirements", () => {
    const reqs = parseRequirements(sampleRequirements);
    expect(reqs).toHaveLength(2);
  });

  it("should parse requirement IDs and titles", () => {
    const reqs = parseRequirements(sampleRequirements);
    expect(reqs[0].id).toBe("R01");
    expect(reqs[0].title).toBe("User Authentication");
    expect(reqs[1].id).toBe("R02");
    expect(reqs[1].title).toBe("Data Validation");
  });

  it("should parse user stories", () => {
    const reqs = parseRequirements(sampleRequirements);
    expect(reqs[0].userStory).toContain("log in securely");
  });

  it("should parse acceptance criteria", () => {
    const reqs = parseRequirements(sampleRequirements);
    expect(reqs[0].acceptanceCriteria).toHaveLength(2);
    expect(reqs[0].acceptanceCriteria[0].when).toBe("user provides valid credentials");
    expect(reqs[0].acceptanceCriteria[0].component).toBe("auth system");
    expect(reqs[0].acceptanceCriteria[0].shall).toBe("grant access");
  });

  it("should handle colon separator in headers", () => {
    const content = `## R01: My Feature

**User Story:** As a user, I want a feature.

**Acceptance Criteria:**

- AC-01.1: WHEN invoked, THE system SHALL respond
`;
    const reqs = parseRequirements(content);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("R01");
    expect(reqs[0].title).toBe("My Feature");
  });

  it("should handle dotted requirement IDs", () => {
    const content = `## R07.1 — Steering Loader

**User Story:** As an agent, I need steering context.

**Acceptance Criteria:**

- AC-07.1.1: WHEN workspace has steering dir, THE loader SHALL read all md files
`;
    const reqs = parseRequirements(content);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("R07.1");
  });

  it("should handle verified criteria with [x]", () => {
    const content = `## R01 — Feature

**Acceptance Criteria:**

- [x] AC-01.1: WHEN triggered, THE system SHALL work
- [ ] AC-01.2: WHEN broken, THE system SHALL error
`;
    const reqs = parseRequirements(content);
    const criteria = reqs[0].acceptanceCriteria;
    expect(criteria).toHaveLength(2);
    expect(criteria[0].verified).toBe(true);
    expect(criteria[1].verified).toBe(false);
  });

  it("should return empty for non-requirement content", () => {
    const content = "# Just a Title\n\nSome text without requirements.";
    const reqs = parseRequirements(content);
    expect(reqs).toHaveLength(0);
  });
});

// ── parseTasks ───────────────────────────────────────────────

describe("parseTasks", () => {
  const sampleTasks = `# Project Tasks

## 1. Setup

- [x] 1.1 Initialize project
- [x] 1.2 Configure TypeScript
- [ ] 1.3 Set up CI

_Requirements: R01_

## 2. Implementation

- [x] 2.1 Build parser
- [ ] 2.2 Build executor
- [!] 2.3 Fix broken test

_Requirements: R01, R02_

## 3. Testing

- [ ] 3.1 Unit tests
- [ ] 3.2 Integration tests

_Requirements: R02_
`;

  it("should parse top-level tasks", () => {
    const tasks = parseTasks(sampleTasks);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe("1");
    expect(tasks[0].title).toBe("Setup");
    expect(tasks[1].id).toBe("2");
    expect(tasks[2].id).toBe("3");
  });

  it("should parse subtasks with correct statuses", () => {
    const tasks = parseTasks(sampleTasks);
    const setup = tasks[0];
    expect(setup.subtasks).toHaveLength(3);
    expect(setup.subtasks[0].status).toBe("done");
    expect(setup.subtasks[0].id).toBe("1.1");
    expect(setup.subtasks[1].status).toBe("done");
    expect(setup.subtasks[2].status).toBe("pending");
  });

  it("should parse failed status", () => {
    const tasks = parseTasks(sampleTasks);
    const impl = tasks[1];
    expect(impl.subtasks[2].status).toBe("failed");
    expect(impl.subtasks[2].title).toBe("Fix broken test");
  });

  it("should parse requirement references", () => {
    const tasks = parseTasks(sampleTasks);
    expect(tasks[0].requirementRefs).toEqual(["R01"]);
    expect(tasks[1].requirementRefs).toEqual(["R01", "R02"]);
    expect(tasks[2].requirementRefs).toEqual(["R02"]);
  });

  it("should propagate requirement refs to subtasks", () => {
    const tasks = parseTasks(sampleTasks);
    expect(tasks[0].subtasks[0].requirementRefs).toEqual(["R01"]);
    expect(tasks[1].subtasks[0].requirementRefs).toEqual(["R01", "R02"]);
  });

  it("should handle tasks without subtasks", () => {
    const content = `## 1. Simple task

_Requirements: R01_
`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subtasks).toHaveLength(0);
    expect(tasks[0].requirementRefs).toEqual(["R01"]);
  });

  it("should handle tasks without requirement refs", () => {
    const content = `## 1. Orphan task

- [ ] 1.1 Do something
`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].requirementRefs).toEqual([]);
  });

  it("should return empty for non-task content", () => {
    const content = "# Just a Title\n\nSome content.";
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(0);
  });
});

// ── validateSpec ─────────────────────────────────────────────

describe("validateSpec", () => {
  it("should validate a well-formed spec as valid", () => {
    const spec: ParsedSpec = {
      requirements: [
        {
          id: "R01",
          title: "Feature",
          userStory: "As a user...",
          acceptanceCriteria: [],
        },
      ],
      tasks: [
        {
          id: "1",
          title: "Build",
          status: "pending",
          subtasks: [],
          requirementRefs: ["R01"],
        },
      ],
      designContent: "",
    };

    const result = validateSpec(spec);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should error on tasks without requirement refs", () => {
    const spec: ParsedSpec = {
      requirements: [
        { id: "R01", title: "Feature", userStory: "", acceptanceCriteria: [] },
      ],
      tasks: [
        {
          id: "1",
          title: "Orphan",
          status: "pending",
          subtasks: [],
          requirementRefs: [],
        },
      ],
      designContent: "",
    };

    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Task 1"))).toBe(true);
  });

  it("should error on unreferenced requirements", () => {
    const spec: ParsedSpec = {
      requirements: [
        { id: "R01", title: "Used", userStory: "", acceptanceCriteria: [] },
        { id: "R02", title: "Unused", userStory: "", acceptanceCriteria: [] },
      ],
      tasks: [
        {
          id: "1",
          title: "Build",
          status: "pending",
          subtasks: [],
          requirementRefs: ["R01"],
        },
      ],
      designContent: "",
    };

    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("R02"))).toBe(true);
  });

  it("should warn on orphan requirement IDs", () => {
    const spec: ParsedSpec = {
      requirements: [
        { id: "R01", title: "Feature", userStory: "", acceptanceCriteria: [] },
      ],
      tasks: [
        {
          id: "1",
          title: "Build",
          status: "pending",
          subtasks: [],
          requirementRefs: ["R01", "R99"],
        },
      ],
      designContent: "",
    };

    const result = validateSpec(spec);
    expect(result.valid).toBe(true); // warnings don't make it invalid
    expect(result.warnings.some((w) => w.includes("R99"))).toBe(true);
  });

  it("should accept tasks with subtask refs", () => {
    const spec: ParsedSpec = {
      requirements: [
        { id: "R01", title: "Feature", userStory: "", acceptanceCriteria: [] },
      ],
      tasks: [
        {
          id: "1",
          title: "Build",
          status: "pending",
          subtasks: [
            {
              id: "1.1",
              title: "Sub",
              status: "pending",
              subtasks: [],
              requirementRefs: ["R01"],
            },
          ],
          requirementRefs: [],
        },
      ],
      designContent: "",
    };

    const result = validateSpec(spec);
    expect(result.valid).toBe(true);
  });
});
