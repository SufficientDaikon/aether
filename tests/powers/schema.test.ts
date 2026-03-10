import { describe, it, expect } from "bun:test";
import { validateManifest } from "../../core/powers/schema.ts";

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-power",
    version: "1.0.0",
    description: "A test power",
    provider: "aether-team",
    activation: { keywords: ["test"] },
    ...overrides,
  };
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe("Powers › Schema Validation", () => {
  it("accepts a minimal valid manifest", () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a fully-populated manifest", () => {
    const result = validateManifest(validManifest({
      homepage: "https://example.com",
      license: "MIT",
      mcp: { server: "@scope/mcp-server", command: "node", args: ["--stdio"], env: { KEY: "val" }, config: { x: 1 } },
      steering: ["steering.md"],
      hooks: ["hooks/on-change.hook.json"],
      activation: { keywords: ["react", "component"], filePatterns: ["**/*.tsx"], manual: false },
      dependencies: { powers: ["other-power"], npm: { lodash: "^4.0.0" } },
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Required fields ---------------------------------------------------

  it("rejects null input", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Manifest must be a JSON object");
  });

  it("rejects array input", () => {
    const result = validateManifest([]);
    expect(result.valid).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = validManifest();
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"name"'))).toBe(true);
  });

  it("rejects missing version", () => {
    const { version: _, ...rest } = validManifest();
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"version"'))).toBe(true);
  });

  it("rejects missing description", () => {
    const { description: _, ...rest } = validManifest();
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"description"'))).toBe(true);
  });

  it("rejects missing provider", () => {
    const { provider: _, ...rest } = validManifest();
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"provider"'))).toBe(true);
  });

  it("rejects missing activation", () => {
    const { activation: _, ...rest } = validManifest();
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"activation"'))).toBe(true);
  });

  // Name format -------------------------------------------------------

  it("rejects non-kebab-case names", () => {
    expect(validateManifest(validManifest({ name: "MyPower" })).valid).toBe(false);
    expect(validateManifest(validManifest({ name: "my_power" })).valid).toBe(false);
    expect(validateManifest(validManifest({ name: "my power" })).valid).toBe(false);
    expect(validateManifest(validManifest({ name: "123-power" })).valid).toBe(false);
  });

  it("accepts valid kebab-case names", () => {
    expect(validateManifest(validManifest({ name: "my-power" })).valid).toBe(true);
    expect(validateManifest(validManifest({ name: "a" })).valid).toBe(true);
    expect(validateManifest(validManifest({ name: "power123" })).valid).toBe(true);
  });

  // Version format ----------------------------------------------------

  it("rejects invalid semver", () => {
    expect(validateManifest(validManifest({ version: "1.0" })).valid).toBe(false);
    expect(validateManifest(validManifest({ version: "v1.0.0" })).valid).toBe(false);
    expect(validateManifest(validManifest({ version: "latest" })).valid).toBe(false);
  });

  it("accepts valid semver with prerelease", () => {
    expect(validateManifest(validManifest({ version: "1.0.0-beta.1" })).valid).toBe(true);
    expect(validateManifest(validManifest({ version: "0.0.1" })).valid).toBe(true);
  });

  // Activation --------------------------------------------------------

  it("rejects activation without keywords array", () => {
    const result = validateManifest(validManifest({ activation: { keywords: "react" } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("keywords"))).toBe(true);
  });

  it("rejects non-string keyword entries", () => {
    const result = validateManifest(validManifest({ activation: { keywords: [123] } }));
    expect(result.valid).toBe(false);
  });

  it("rejects non-boolean manual flag", () => {
    const result = validateManifest(validManifest({ activation: { keywords: ["x"], manual: "yes" } }));
    expect(result.valid).toBe(false);
  });

  it("rejects non-array filePatterns", () => {
    const result = validateManifest(validManifest({ activation: { keywords: ["x"], filePatterns: "*.ts" } }));
    expect(result.valid).toBe(false);
  });

  // MCP ---------------------------------------------------------------

  it("rejects mcp without server", () => {
    const result = validateManifest(validManifest({ mcp: { command: "node" } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("mcp.server"))).toBe(true);
  });

  it("rejects non-object mcp", () => {
    const result = validateManifest(validManifest({ mcp: "bad" }));
    expect(result.valid).toBe(false);
  });

  // Steering / hooks --------------------------------------------------

  it("rejects non-array steering", () => {
    const result = validateManifest(validManifest({ steering: "file.md" }));
    expect(result.valid).toBe(false);
  });

  it("rejects non-string steering entries", () => {
    const result = validateManifest(validManifest({ steering: [123] }));
    expect(result.valid).toBe(false);
  });

  it("rejects non-array hooks", () => {
    const result = validateManifest(validManifest({ hooks: 42 }));
    expect(result.valid).toBe(false);
  });

  // Accumulates errors ------------------------------------------------

  it("accumulates multiple errors", () => {
    const result = validateManifest({ activation: "bad" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
