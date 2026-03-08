// ─────────────────────────────────────────────────────────────
// Phase 8.03: Schema Validator Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "8.03.1",
    "SchemaValidator — extract JSON from markdown",
    async () => {
      const { SchemaValidator } = await import(join(ROOT, "core/schema.ts"));
      const v = new SchemaValidator();
      const r = v.validate(
        'Here:\n```json\n{"name":"test","count":42}\n```\nDone.',
        {
          type: "object",
          properties: { name: { type: "string" }, count: { type: "number" } },
          required: ["name", "count"],
        },
      );
      return {
        score: r.valid ? 10 : 0,
        maxScore: 10,
        details: `valid=${r.valid} errors=[${r.errors.join(";")}]`,
      };
    },
  );

  await harness.runTest(
    "8.03.2",
    "SchemaValidator — reject non-JSON",
    async () => {
      const { SchemaValidator } = await import(join(ROOT, "core/schema.ts"));
      const v = new SchemaValidator();
      const r = v.validate("plain text no json", {
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
      });
      return {
        score: !r.valid ? 10 : 0,
        maxScore: 10,
        details: `valid=${r.valid} (expected false)`,
      };
    },
  );

  await harness.runTest(
    "8.03.3",
    "SchemaValidator — missing required field",
    async () => {
      const { SchemaValidator } = await import(join(ROOT, "core/schema.ts"));
      const v = new SchemaValidator();
      const r = v.validate('{"name":"x"}', {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name", "age"],
      });
      const flagged =
        !r.valid || r.errors.some((e: string) => /age|required|missing/i.test(e));
      return {
        score: flagged ? 10 : 0,
        maxScore: 10,
        details: `valid=${r.valid} errors=[${r.errors.join(";")}]`,
      };
    },
  );

  await harness.runTest(
    "8.03.4",
    "SchemaValidator — type mismatch",
    async () => {
      const { SchemaValidator } = await import(join(ROOT, "core/schema.ts"));
      const v = new SchemaValidator();
      const r = v.validate('{"count":"notnum"}', {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      });
      const flagged = !r.valid || r.errors.some((e: string) => /type|number/i.test(e));
      return {
        score: flagged ? 10 : 0,
        maxScore: 10,
        details: `valid=${r.valid} errors=[${r.errors.join(";")}]`,
      };
    },
  );
}
