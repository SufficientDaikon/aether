// ─────────────────────────────────────────────────────────────
// Steering Composer Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "bun:test";
import {
  estimateTokens,
  scopeMatchesAgent,
  compose,
} from "../../core/steering/composer.ts";
import type { SteeringFile } from "../../core/steering/loader.ts";

// ── estimateTokens ───────────────────────────────────────────

describe("estimateTokens", () => {
  it("should estimate tokens as words * 1.3", () => {
    const text = "one two three four five";
    expect(estimateTokens(text)).toBe(Math.ceil(5 * 1.3)); // 7
  });

  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should handle multiple spaces and newlines", () => {
    const text = "hello   world\n\nfoo  bar";
    expect(estimateTokens(text)).toBe(Math.ceil(4 * 1.3)); // 6
  });
});

// ── scopeMatchesAgent ────────────────────────────────────────

describe("scopeMatchesAgent", () => {
  it("should always match global scope", () => {
    expect(scopeMatchesAgent("global", "react-specialist")).toBe(true);
    expect(scopeMatchesAgent("global", "cortex-0")).toBe(true);
  });

  it("should match exact agent ID", () => {
    expect(scopeMatchesAgent("react-specialist", "react-specialist")).toBe(true);
  });

  it("should match frontend category agents", () => {
    expect(scopeMatchesAgent("frontend", "react-specialist")).toBe(true);
    expect(scopeMatchesAgent("frontend", "ui-designer")).toBe(true);
    expect(scopeMatchesAgent("frontend", "ux-psychologist")).toBe(true);
  });

  it("should match backend category agents", () => {
    expect(scopeMatchesAgent("backend", "postgres-db-architect")).toBe(true);
    expect(scopeMatchesAgent("backend", "bun-runtime-master")).toBe(true);
    expect(scopeMatchesAgent("backend", "redis-state-guard")).toBe(true);
  });

  it("should match security category agents", () => {
    expect(scopeMatchesAgent("security", "code-hardener")).toBe(true);
    expect(scopeMatchesAgent("security", "vuln-hunter")).toBe(true);
    expect(scopeMatchesAgent("security", "threat-architect")).toBe(true);
    expect(scopeMatchesAgent("security", "cyber-sentinel")).toBe(true);
  });

  it("should match testing category agents", () => {
    expect(scopeMatchesAgent("testing", "playwright-tester")).toBe(true);
    expect(scopeMatchesAgent("testing", "qa-audit-director")).toBe(true);
  });

  it("should not match unrelated agents", () => {
    expect(scopeMatchesAgent("frontend", "postgres-db-architect")).toBe(false);
    expect(scopeMatchesAgent("security", "react-specialist")).toBe(false);
  });

  it("should do partial match for custom scopes", () => {
    expect(scopeMatchesAgent("mcp", "mcp-server-creator")).toBe(true);
    expect(scopeMatchesAgent("forge", "forge-0")).toBe(true);
  });
});

// ── compose ──────────────────────────────────────────────────

function makeFile(
  filename: string,
  scope: string,
  priority: number,
  content: string,
): SteeringFile {
  return {
    path: `/mock/${filename}`,
    filename,
    meta: { scope, priority, tags: [] },
    content,
    rawContent: content,
  };
}

describe("compose", () => {
  const files: SteeringFile[] = [
    makeFile("global.md", "global", 5, "Global rules apply everywhere."),
    makeFile("frontend.md", "frontend", 8, "Use React best practices."),
    makeFile("security.md", "security", 9, "Always sanitize inputs."),
    makeFile("low-priority.md", "global", 1, "This is low priority content that might get dropped."),
  ];

  it("should include global and matching scope files", () => {
    const result = compose(files, "react-specialist");
    expect(result.sources).toContain("/mock/global.md");
    expect(result.sources).toContain("/mock/frontend.md");
    expect(result.sources).not.toContain("/mock/security.md");
  });

  it("should order by priority (highest first)", () => {
    const result = compose(files, "react-specialist");
    expect(result.content.indexOf("React")).toBeLessThan(
      result.content.indexOf("Global"),
    );
  });

  it("should include all matching files when no token limit", () => {
    const result = compose(files, "react-specialist");
    expect(result.truncated).toBe(false);
    expect(result.sources).toHaveLength(3); // frontend + global + low-priority
  });

  it("should truncate when exceeding token limit", () => {
    const result = compose(files, "react-specialist", 15);
    expect(result.truncated).toBe(true);
    // Should keep highest priority and drop low priority
    expect(result.sources).toContain("/mock/frontend.md");
  });

  it("should return empty for no matching files", () => {
    const result = compose([], "any-agent");
    expect(result.content).toBe("");
    expect(result.sources).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("should handle security agent scope", () => {
    const result = compose(files, "vuln-hunter");
    expect(result.sources).toContain("/mock/security.md");
    expect(result.sources).toContain("/mock/global.md");
    expect(result.sources).not.toContain("/mock/frontend.md");
  });

  it("should separate file contents with dividers", () => {
    const result = compose(files, "react-specialist");
    expect(result.content).toContain("---");
  });

  it("should report total tokens", () => {
    const result = compose(files, "react-specialist");
    expect(result.totalTokens).toBeGreaterThan(0);
  });
});
