// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: EntityMemory Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.13.1: Extract entities from sample text ────────
  await harness.runTest(
    "2.13.1",
    "EntityMemory — Extract entities from text",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { EntityMemory } = await import("../../core/entity-memory.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const entityMem = new EntityMemory(store);
          details.push("EntityMemory created");
          score += 1;

          // Extract entities from a rich text sample
          const sampleText = `
          The auth module lives in src/auth/handler.ts and depends on
          jsonwebtoken for token verification. We also use
          require('express') for the server framework.
          The GET /api/users endpoint is slow and needs optimization.
          Config is read from process.env.DATABASE_URL and process.env.JWT_SECRET.
        `;

          const entities = entityMem.extractEntities(sampleText);
          if (Array.isArray(entities) && entities.length > 0) {
            details.push(`Extracted ${entities.length} entities`);
            score += 2;

            // Check for file entities
            const files = entities.filter((e) => e.type === "file");
            if (files.length >= 1) {
              details.push(`Files: ${files.map((f) => f.name).join(", ")}`);
              score += 2;
            }

            // Check for module entities
            const modules = entities.filter((e) => e.type === "module");
            if (modules.length >= 1) {
              details.push(`Modules: ${modules.map((m) => m.name).join(", ")}`);
              score += 2;
            }

            // Check for API entities
            const apis = entities.filter((e) => e.type === "api");
            if (apis.length >= 1) {
              details.push(`APIs: ${apis.map((a) => a.name).join(", ")}`);
              score += 1;
            }

            // Check for config entities
            const configs = entities.filter((e) => e.type === "config");
            if (configs.length >= 1) {
              details.push(`Configs: ${configs.map((c) => c.name).join(", ")}`);
              score += 2;
            }
          } else {
            details.push("extractEntities returned no entities");
          }

          await store.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // ── Test 2.13.2: Save/get entities and facts ──────────────
  await harness.runTest(
    "2.13.2",
    "EntityMemory — Save/get entities and facts",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { EntityMemory } = await import("../../core/entity-memory.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();

        try {
          const entityMem = new EntityMemory(store);

          // Add a fact manually
          entityMem.addFact(
            "auth-module",
            "module",
            "Handles JWT token verification and session management",
            "task-001",
            0.9,
          );
          details.push("Added fact for auth-module");
          score += 2;

          // Get the entity back
          const entity = entityMem.getEntity("auth-module", "module");
          if (
            entity &&
            entity.name === "auth-module" &&
            entity.type === "module"
          ) {
            details.push(
              `Retrieved entity: ${entity.name} (type: ${entity.type})`,
            );
            score += 2;
          } else {
            details.push("Could not retrieve entity");
          }

          // Get facts for the entity
          const facts = entityMem.getFacts(entity?.id ?? "module:auth-module");
          if (Array.isArray(facts) && facts.length >= 1) {
            details.push(`Retrieved ${facts.length} fact(s) for entity`);
            score += 2;

            if (facts[0].fact.includes("JWT")) {
              details.push("Fact content is correct");
              score += 1;
            }

            if (facts[0].confidence === 0.9) {
              details.push("Fact confidence preserved");
              score += 1;
            }
          }

          // processTaskOutput — extract and save from task result
          const result = entityMem.processTaskOutput(
            "task-002",
            "Updated src/routes/users.ts to use POST /api/users/create endpoint",
            "Implement user creation API route for the users module",
          );
          if (result && result.entitiesFound >= 1) {
            details.push(
              `processTaskOutput: found ${result.entitiesFound} entities, added ${result.factsAdded} facts`,
            );
            score += 2;
          } else {
            details.push("processTaskOutput found no entities");
          }

          await store.close();
        } catch (err) {
          details.push(
            `Inner error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (tempDir)
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {}
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
