// ─────────────────────────────────────────────────────────────
// Phase 8.05: Structured Logger Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  const testDir = join(import.meta.dir, ".test-logs");

  await harness.runTest(
    "8.05.1",
    "StructuredLogger — construction",
    async () => {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });
      const { StructuredLogger } = await import(
        join(ROOT, "core/structured-logger.ts")
      );
      const logger = new StructuredLogger({
        auditLogPath: join(testDir, "audit.jsonl"),
        structuredLogPath: join(testDir, "structured.jsonl"),
        maxRetainedEntries: 100,
        flushIntervalMs: 500,
        forwardToSynapse: false,
      });
      const created = logger !== null;
      try {
        logger.shutdown?.();
      } catch {}
      if (existsSync(testDir)) rmSync(testDir, { recursive: true });
      return {
        score: created ? 10 : 0,
        maxScore: 10,
        details: `Logger created: ${created}`,
      };
    },
  );

  await harness.runTest(
    "8.05.2",
    "StructuredLogger — log and query",
    async () => {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });
      const { StructuredLogger } = await import(
        join(ROOT, "core/structured-logger.ts")
      );
      const logger = new StructuredLogger({
        auditLogPath: join(testDir, "audit.jsonl"),
        structuredLogPath: join(testDir, "structured.jsonl"),
        maxRetainedEntries: 100,
        flushIntervalMs: 100,
        forwardToSynapse: false,
      });

      let logWorked = false;
      try {
        if (typeof logger.log === "function") {
          logger.log({ level: "info", message: "test msg", component: "eval" });
          logWorked = true;
        }
      } catch {}

      let queryWorked = false;
      try {
        if (typeof logger.query === "function") {
          const results = logger.query({ level: "info" });
          queryWorked = Array.isArray(results);
        }
      } catch {}

      try {
        logger.shutdown?.();
      } catch {}
      if (existsSync(testDir)) rmSync(testDir, { recursive: true });

      const score = (logWorked ? 5 : 0) + (queryWorked ? 5 : 0);
      return {
        score,
        maxScore: 10,
        details: `log=${logWorked} query=${queryWorked}`,
      };
    },
  );
}
