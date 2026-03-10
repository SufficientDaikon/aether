import { describe, it, expect } from "bun:test";
import { DynamicActivator } from "../../core/powers/activator.ts";
import type { InstalledPower } from "../../core/powers/schema.ts";

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function makePower(overrides: Partial<InstalledPower["manifest"]> & { name: string }): InstalledPower {
  return {
    manifest: {
      version: "1.0.0",
      description: "Test power",
      provider: "test",
      activation: { keywords: [] },
      ...overrides,
    },
    installPath: `/powers/${overrides.name}`,
    installedAt: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe("Powers › DynamicActivator", () => {
  const activator = new DynamicActivator();

  // Keyword matching --------------------------------------------------

  it("activates on keyword match in messages", () => {
    const power = makePower({ name: "react-power", activation: { keywords: ["react"] } });
    const result = activator.evaluate([power], {
      messages: ["I want to build a React component"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(1);
    expect(result.activated[0].manifest.name).toBe("react-power");
    expect(result.reasons.get("react-power")).toContain("keyword match");
  });

  it("keyword matching is case-insensitive", () => {
    const power = makePower({ name: "react-power", activation: { keywords: ["React"] } });
    const result = activator.evaluate([power], {
      messages: ["i love react"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(1);
  });

  it("keyword matching respects word boundaries", () => {
    const power = makePower({ name: "react-power", activation: { keywords: ["react"] } });
    const result = activator.evaluate([power], {
      messages: ["this is a reactive system"],
      openFiles: [],
    });
    // "reactive" should NOT match "react" at word boundary
    expect(result.activated).toHaveLength(0);
  });

  it("matches keywords across multiple messages", () => {
    const power = makePower({ name: "db-power", activation: { keywords: ["postgres"] } });
    const result = activator.evaluate([power], {
      messages: ["first message", "use postgres for this"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(1);
  });

  it("does not activate when no keywords match", () => {
    const power = makePower({ name: "react-power", activation: { keywords: ["react"] } });
    const result = activator.evaluate([power], {
      messages: ["build a vue component"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(0);
  });

  // File pattern matching ---------------------------------------------

  it("activates on file pattern match", () => {
    const power = makePower({
      name: "ts-power",
      activation: { keywords: [], filePatterns: ["**/*.tsx"] },
    });
    const result = activator.evaluate([power], {
      messages: [],
      openFiles: ["src/components/Button.tsx"],
    });
    expect(result.activated).toHaveLength(1);
    expect(result.reasons.get("ts-power")).toContain("file pattern");
  });

  it("does not activate on non-matching file pattern", () => {
    const power = makePower({
      name: "ts-power",
      activation: { keywords: [], filePatterns: ["**/*.tsx"] },
    });
    const result = activator.evaluate([power], {
      messages: [],
      openFiles: ["src/main.py"],
    });
    expect(result.activated).toHaveLength(0);
  });

  it("handles Windows-style file paths", () => {
    const power = makePower({
      name: "ts-power",
      activation: { keywords: [], filePatterns: ["**/*.ts"] },
    });
    const result = activator.evaluate([power], {
      messages: [],
      openFiles: ["src\\core\\index.ts"],
    });
    expect(result.activated).toHaveLength(1);
  });

  // Explicit powers ---------------------------------------------------

  it("activates explicit powers regardless of keywords", () => {
    const power = makePower({
      name: "manual-power",
      activation: { keywords: ["nope"], manual: true },
    });
    const result = activator.evaluate([power], {
      messages: ["hello"],
      openFiles: [],
      explicitPowers: ["manual-power"],
    });
    expect(result.activated).toHaveLength(1);
    expect(result.reasons.get("manual-power")).toBe("explicit selection");
  });

  // Manual powers -----------------------------------------------------

  it("skips manual powers when not explicitly selected", () => {
    const power = makePower({
      name: "manual-only",
      activation: { keywords: ["trigger"], manual: true },
    });
    const result = activator.evaluate([power], {
      messages: ["trigger this please"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(0);
  });

  // Multiple powers ---------------------------------------------------

  it("activates multiple powers independently", () => {
    const powers = [
      makePower({ name: "p1", activation: { keywords: ["alpha"] } }),
      makePower({ name: "p2", activation: { keywords: ["beta"] } }),
      makePower({ name: "p3", activation: { keywords: ["gamma"] } }),
    ];
    const result = activator.evaluate(powers, {
      messages: ["alpha and beta are here"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(2);
    expect(result.activated.map((p) => p.manifest.name).sort()).toEqual(["p1", "p2"]);
  });

  // Priority: keyword before file pattern -----------------------------

  it("reports keyword reason even when file pattern also matches", () => {
    const power = makePower({
      name: "dual-power",
      activation: { keywords: ["deploy"], filePatterns: ["**/*.yml"] },
    });
    const result = activator.evaluate([power], {
      messages: ["deploy the app"],
      openFiles: ["ci/deploy.yml"],
    });
    expect(result.activated).toHaveLength(1);
    expect(result.reasons.get("dual-power")).toContain("keyword");
  });

  // Empty inputs ------------------------------------------------------

  it("returns empty result for no powers", () => {
    const result = activator.evaluate([], {
      messages: ["anything"],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(0);
    expect(result.reasons.size).toBe(0);
  });

  it("returns empty result for empty context", () => {
    const power = makePower({ name: "p", activation: { keywords: ["x"] } });
    const result = activator.evaluate([power], {
      messages: [],
      openFiles: [],
    });
    expect(result.activated).toHaveLength(0);
  });
});
