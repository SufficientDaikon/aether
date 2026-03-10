// ─────────────────────────────────────────────────────────────
// Steering Loader Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFrontMatter,
  loadSteeringFile,
  loadSteering,
} from "../../core/steering/loader.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aether-steering-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── parseFrontMatter ─────────────────────────────────────────

describe("parseFrontMatter", () => {
  it("should return empty meta and full body when no front matter", () => {
    const content = "# Hello\n\nSome content.";
    const { meta, body } = parseFrontMatter(content);
    expect(meta).toEqual({});
    expect(body).toBe(content);
  });

  it("should parse scope, priority, and tags", () => {
    const content = `---
scope: frontend
priority: 8
tags: [react, ui, components]
---

# Frontend Guidelines`;

    const { meta, body } = parseFrontMatter(content);
    expect(meta.scope).toBe("frontend");
    expect(meta.priority).toBe(8);
    expect(meta.tags).toEqual(["react", "ui", "components"]);
    expect(body).toContain("# Frontend Guidelines");
  });

  it("should handle missing closing delimiter gracefully", () => {
    const content = "---\nscope: global\nNo closing delimiter";
    const { meta, body } = parseFrontMatter(content);
    expect(meta).toEqual({});
    expect(body).toBe(content);
  });

  it("should default to empty when front matter has no recognized keys", () => {
    const content = `---
author: John
version: 1.0
---

Body content`;

    const { meta, body } = parseFrontMatter(content);
    expect(meta.scope).toBeUndefined();
    expect(meta.priority).toBeUndefined();
    expect(body).toContain("Body content");
  });

  it("should reject priority outside 1-10 range", () => {
    const content = `---
priority: 15
---
Body`;
    const { meta } = parseFrontMatter(content);
    expect(meta.priority).toBeUndefined();
  });

  it("should handle tags without brackets", () => {
    const content = `---
tags: react, vue, angular
---
Body`;
    const { meta } = parseFrontMatter(content);
    expect(meta.tags).toEqual(["react", "vue", "angular"]);
  });

  it("should handle leading whitespace before front matter", () => {
    const content = `  \n---
scope: backend
---
Body`;
    const { meta } = parseFrontMatter(content);
    expect(meta.scope).toBe("backend");
  });
});

// ── loadSteeringFile ─────────────────────────────────────────

describe("loadSteeringFile", () => {
  it("should load a file with front matter", () => {
    const filePath = join(tmpDir, "test.md");
    writeFileSync(
      filePath,
      `---
scope: security
priority: 9
tags: [auth]
---

# Security Rules

Never store passwords in plain text.`,
    );

    const file = loadSteeringFile(filePath);
    expect(file.meta.scope).toBe("security");
    expect(file.meta.priority).toBe(9);
    expect(file.meta.tags).toEqual(["auth"]);
    expect(file.content).toContain("# Security Rules");
    expect(file.filename).toBe("test.md");
  });

  it("should use defaults for files without front matter", () => {
    const filePath = join(tmpDir, "plain.md");
    writeFileSync(filePath, "# Plain\n\nJust content.");

    const file = loadSteeringFile(filePath);
    expect(file.meta.scope).toBe("global");
    expect(file.meta.priority).toBe(5);
    expect(file.meta.tags).toEqual([]);
  });
});

// ── loadSteering ─────────────────────────────────────────────

describe("loadSteering", () => {
  it("should load from .aether/steering/ directory", () => {
    const steeringDir = join(tmpDir, ".aether", "steering");
    mkdirSync(steeringDir, { recursive: true });
    writeFileSync(
      join(steeringDir, "project.md"),
      `---
scope: global
priority: 10
---

# Project Rules`,
    );
    writeFileSync(
      join(steeringDir, "frontend.md"),
      `---
scope: frontend
priority: 7
---

# Frontend Rules`,
    );

    const result = loadSteering(tmpDir);
    expect(result.source).toBe("steering-dir");
    expect(result.files).toHaveLength(2);
    expect(result.files[0].filename).toBe("frontend.md");
    expect(result.files[1].filename).toBe("project.md");
  });

  it("should fallback to CLAUDE.md when no steering dir", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "# Claude Instructions");

    const result = loadSteering(tmpDir);
    expect(result.source).toBe("fallback");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("CLAUDE.md");
    expect(result.files[0].meta.priority).toBe(3);
  });

  it("should fallback to config.json steering section", () => {
    const aetherDir = join(tmpDir, ".aether");
    mkdirSync(aetherDir, { recursive: true });
    writeFileSync(
      join(aetherDir, "config.json"),
      JSON.stringify({ steering: "Always use TypeScript strict mode." }),
    );

    const result = loadSteering(tmpDir);
    expect(result.source).toBe("fallback");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toBe("Always use TypeScript strict mode.");
  });

  it("should merge steering dir with fallbacks", () => {
    const steeringDir = join(tmpDir, ".aether", "steering");
    mkdirSync(steeringDir, { recursive: true });
    writeFileSync(join(steeringDir, "rules.md"), "# Rules");
    writeFileSync(join(tmpDir, "CLAUDE.md"), "# Claude");

    const result = loadSteering(tmpDir);
    expect(result.source).toBe("merged");
    expect(result.files).toHaveLength(2);
  });

  it("should return empty files when nothing exists", () => {
    const result = loadSteering(tmpDir);
    expect(result.source).toBe("fallback");
    expect(result.files).toHaveLength(0);
  });

  it("should ignore config.json without steering key", () => {
    const aetherDir = join(tmpDir, ".aether");
    mkdirSync(aetherDir, { recursive: true });
    writeFileSync(
      join(aetherDir, "config.json"),
      JSON.stringify({ agents: {} }),
    );

    const result = loadSteering(tmpDir);
    expect(result.files).toHaveLength(0);
  });
});
