// ─────────────────────────────────────────────────────────────
// AETHER Eval — Phase 2: AgentForge Subsystem Tests
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { registerFullHierarchy } from "../helpers/agent-fixtures.ts";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function run(harness: TestHarness): Promise<void> {
  // ── Test 2.25.1: Spawn agent ─────────────────────────────────
  await harness.runTest(
    "2.25.1",
    "AgentForge — Spawn agent (creates file + registers)",
    async () => {
      let tempDir = "";
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];

      try {
        const { AgentForge } = await import("../../core/forge.ts");
        const { AgentRegistry } = await import("../../core/registry.ts");
        const { TierRegistry } = await import("../../core/tier-registry.ts");
        const { SQLiteStore } =
          await import("../../core/storage/sqlite-store.ts");
        const { SynapseLogger } = await import("../../core/logger.ts");

        tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
        const store = new SQLiteStore(tempDir);
        await store.init();
        const logger = new SynapseLogger(join(tempDir, "logs"));
        const agentsDir = join(tempDir, "agents");

        try {
          const registry = new AgentRegistry();
          const tierRegistry = TierRegistry.builtinTiers();

          const forge = new AgentForge(
            registry,
            tierRegistry,
            store,
            logger,
            agentsDir,
          );
          details.push("AgentForge created");
          score += 1;

          // Spawn a new worker agent
          const agent = forge.spawnAgent({
            id: "auto-tester-1",
            name: "Auto Tester",
            tier: "worker",
            capabilities: ["testing", "automation"],
            systemPrompt: "You are an automated testing agent.",
            ephemeral: true,
          });

          if (agent && agent.id === "auto-tester-1") {
            details.push("Agent spawned: auto-tester-1");
            score += 2;
          }

          if (agent.tier === "worker") {
            details.push("Agent tier: worker");
            score += 1;
          }

          // Check file was created
          const filePath = join(agentsDir, "auto-tester-1.agent.md");
          if (existsSync(filePath)) {
            details.push("Agent file created on disk");
            score += 2;
          }

          // Check registered in registry
          const fromRegistry = registry.get("auto-tester-1");
          if (fromRegistry && fromRegistry.name === "Auto Tester") {
            details.push("Agent found in registry");
            score += 2;
          }

          // Check spawn log
          const spawnLog = forge.getSpawnLog();
          if (
            spawnLog.length === 1 &&
            spawnLog[0].agentId === "auto-tester-1"
          ) {
            details.push("Spawn log recorded");
            score += 1;
          }

          // Check ephemeral tracking
          const ephemeral = forge.getEphemeralAgents();
          if (ephemeral.includes("auto-tester-1")) {
            details.push("Tracked as ephemeral");
            score += 1;
          }

          await store.close();
          await logger.close();
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

  // ── Test 2.25.2: Retire agent ────────────────────────────────
  await harness.runTest("2.25.2", "AgentForge — Retire agent", async () => {
    let tempDir = "";
    let score = 0;
    const maxScore = 10;
    const details: string[] = [];

    try {
      const { AgentForge } = await import("../../core/forge.ts");
      const { AgentRegistry } = await import("../../core/registry.ts");
      const { TierRegistry } = await import("../../core/tier-registry.ts");
      const { SQLiteStore } =
        await import("../../core/storage/sqlite-store.ts");
      const { SynapseLogger } = await import("../../core/logger.ts");

      tempDir = mkdtempSync(join(tmpdir(), "aether-eval-"));
      const store = new SQLiteStore(tempDir);
      await store.init();
      const logger = new SynapseLogger(join(tempDir, "logs"));
      const agentsDir = join(tempDir, "agents");

      try {
        const registry = new AgentRegistry();
        const tierRegistry = TierRegistry.builtinTiers();

        const forge = new AgentForge(
          registry,
          tierRegistry,
          store,
          logger,
          agentsDir,
        );

        // Spawn first
        forge.spawnAgent({
          id: "retiring-agent",
          name: "Retiring Agent",
          tier: "worker",
          capabilities: ["temp-work"],
          systemPrompt: "Temporary agent.",
          ephemeral: false,
        });

        const beforeRetire = registry.get("retiring-agent");
        if (beforeRetire) {
          details.push("Agent spawned for retire test");
          score += 2;
        }

        // Retire the agent (with deleteFile)
        forge.retireAgent("retiring-agent", "no longer needed", true);
        details.push("retireAgent called");
        score += 2;

        const afterRetire = registry.get("retiring-agent");
        if (!afterRetire) {
          details.push("Agent removed from registry");
          score += 3;
        }

        // File should be deleted
        const filePath = join(agentsDir, "retiring-agent.agent.md");
        if (!existsSync(filePath)) {
          details.push("Agent file deleted from disk");
          score += 2;
        }

        // Test retire of non-existent agent throws
        try {
          forge.retireAgent("non-existent-agent", "test");
          details.push("No error for non-existent agent (unexpected)");
        } catch (err) {
          if (err instanceof Error && err.message.includes("not found")) {
            details.push("Correctly throws on non-existent agent");
            score += 1;
          }
        }

        await store.close();
        await logger.close();
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
  });
}
