// ─────────────────────────────────────────────────────────────
// Specs Executor Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  toKebabCase,
  createSpec,
  listSpecs,
  loadSpec,
  validateSpecByPath,
  updateTaskStatus,
} from "../../core/specs/executor.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aether-specs-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── toKebabCase ──────────────────────────────────────────────

describe("toKebabCase", () => {
  it("should convert spaces to hyphens", () => {
    expect(toKebabCase("User Authentication")).toBe("user-authentication");
  });

  it("should handle multiple spaces and special chars", () => {
    expect(toKebabCase("My  Cool Feature!")).toBe("my-cool-feature");
  });

  it("should strip leading/trailing hyphens", () => {
    expect(toKebabCase(" -hello- ")).toBe("hello");
  });

  it("should handle already kebab-case", () => {
    expect(toKebabCase("already-kebab")).toBe("already-kebab");
  });

  it("should handle CamelCase by lowering", () => {
    expect(toKebabCase("MyFeature")).toBe("myfeature");
  });
});

// ── createSpec ───────────────────────────────────────────────

describe("createSpec", () => {
  it("should create spec directory with all template files", () => {
    const info = createSpec(tmpDir, "User Auth", "Authentication system");
    expect(info.name).toBe("user-auth");
    expect(info.hasRequirements).toBe(true);
    expect(info.hasDesign).toBe(true);
    expect(info.hasTasks).toBe(true);

    expect(existsSync(join(info.path, "requirements.md"))).toBe(true);
    expect(existsSync(join(info.path, "design.md"))).toBe(true);
    expect(existsSync(join(info.path, "tasks.md"))).toBe(true);
  });

  it("should fill template placeholders", () => {
    const info = createSpec(tmpDir, "Data Pipeline", "ETL pipeline");
    const req = readFileSync(join(info.path, "requirements.md"), "utf-8");
    expect(req).toContain("Data Pipeline");
    expect(req).toContain("data-pipeline");
    expect(req).toContain("ETL pipeline");
  });

  it("should throw when spec already exists", () => {
    createSpec(tmpDir, "Existing");
    expect(() => createSpec(tmpDir, "Existing")).toThrow(/already exists/);
  });

  it("should normalize name to kebab-case", () => {
    const info = createSpec(tmpDir, "My Cool Feature!");
    expect(info.name).toBe("my-cool-feature");
  });
});

// ── listSpecs ────────────────────────────────────────────────

describe("listSpecs", () => {
  it("should return empty when no specs exist", () => {
    expect(listSpecs(tmpDir)).toHaveLength(0);
  });

  it("should list created specs", () => {
    createSpec(tmpDir, "Spec One");
    createSpec(tmpDir, "Spec Two");

    const specs = listSpecs(tmpDir);
    expect(specs).toHaveLength(2);
    expect(specs[0].name).toBe("spec-one");
    expect(specs[1].name).toBe("spec-two");
  });

  it("should report which files exist", () => {
    const info = createSpec(tmpDir, "Full Spec");
    const specs = listSpecs(tmpDir);
    expect(specs[0].hasRequirements).toBe(true);
    expect(specs[0].hasDesign).toBe(true);
    expect(specs[0].hasTasks).toBe(true);
  });
});

// ── loadSpec & validateSpecByPath ────────────────────────────

describe("loadSpec", () => {
  it("should load and parse a spec from disk", () => {
    const specDir = join(tmpDir, ".aether", "specs", "test-spec");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "requirements.md"),
      `## R01 — Core Feature

**User Story:** As a user, I want the feature.

**Acceptance Criteria:**

- AC-01.1: WHEN triggered, THE system SHALL respond
`,
    );

    writeFileSync(
      join(specDir, "tasks.md"),
      `## 1. Build it

- [ ] 1.1 Do the thing

_Requirements: R01_
`,
    );

    writeFileSync(join(specDir, "design.md"), "# Design\n\nArchitecture here.");

    const spec = loadSpec(specDir);
    expect(spec.requirements).toHaveLength(1);
    expect(spec.tasks).toHaveLength(1);
    expect(spec.designContent).toContain("Architecture");
  });

  it("should handle missing files gracefully", () => {
    const specDir = join(tmpDir, ".aether", "specs", "empty-spec");
    mkdirSync(specDir, { recursive: true });

    const spec = loadSpec(specDir);
    expect(spec.requirements).toHaveLength(0);
    expect(spec.tasks).toHaveLength(0);
    expect(spec.designContent).toBe("");
  });
});

describe("validateSpecByPath", () => {
  it("should validate a valid spec", () => {
    const specDir = join(tmpDir, ".aether", "specs", "valid");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "requirements.md"),
      `## R01 — Feature

**Acceptance Criteria:**
- AC-01.1: WHEN invoked, THE system SHALL work
`,
    );

    writeFileSync(
      join(specDir, "tasks.md"),
      `## 1. Build

- [ ] 1.1 Implement
_Requirements: R01_
`,
    );

    const result = validateSpecByPath(specDir);
    expect(result.valid).toBe(true);
  });
});

// ── updateTaskStatus ─────────────────────────────────────────

describe("updateTaskStatus", () => {
  it("should mark a pending subtask as done", () => {
    const specDir = join(tmpDir, "spec");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "tasks.md"),
      `## 1. Build

- [ ] 1.1 First task
- [ ] 1.2 Second task

_Requirements: R01_
`,
    );

    updateTaskStatus(specDir, "1.1", "done");

    const content = readFileSync(join(specDir, "tasks.md"), "utf-8");
    expect(content).toContain("[x] 1.1 First task");
    expect(content).toContain("[ ] 1.2 Second task");
  });

  it("should mark a task as failed", () => {
    const specDir = join(tmpDir, "spec");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "tasks.md"),
      `## 1. Build

- [ ] 1.1 Failing task

_Requirements: R01_
`,
    );

    updateTaskStatus(specDir, "1.1", "failed");

    const content = readFileSync(join(specDir, "tasks.md"), "utf-8");
    expect(content).toContain("[!] 1.1 Failing task");
  });

  it("should throw for non-existent task", () => {
    const specDir = join(tmpDir, "spec");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "tasks.md"),
      `## 1. Build

- [ ] 1.1 Only task
`,
    );

    expect(() => updateTaskStatus(specDir, "9.9", "done")).toThrow(/not found/);
  });

  it("should throw when tasks.md is missing", () => {
    const specDir = join(tmpDir, "empty-spec");
    mkdirSync(specDir, { recursive: true });
    expect(() => updateTaskStatus(specDir, "1.1", "done")).toThrow(/not found/);
  });

  it("should change done back to pending", () => {
    const specDir = join(tmpDir, "spec");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "tasks.md"),
      `## 1. Build

- [x] 1.1 Completed task
`,
    );

    updateTaskStatus(specDir, "1.1", "pending");

    const content = readFileSync(join(specDir, "tasks.md"), "utf-8");
    expect(content).toContain("[ ] 1.1 Completed task");
  });
});
