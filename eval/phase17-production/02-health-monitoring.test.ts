// Phase 17.02: Health Monitoring Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("17.02.1", "Health — sentinel healthCheck returns score", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const { TierRegistry } = await import(join(ROOT, "core/tier-registry.ts"));
    const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
    const { SystemSentinel } = await import(join(ROOT, "core/sentinel.ts"));

    const tmpDir = join(import.meta.dir, ".health-tmp1");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const registry = new AgentRegistry();
      registry.register({ id: "health-agent", name: "Health", tier: "worker", capabilities: ["test"], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
      const tierRegistry = new TierRegistry();
      const logger = new SynapseLogger(tmpDir);
      const sentinel = new SystemSentinel(registry, tierRegistry, logger);
      const result = sentinel.runHealthCheck();
      return {
        score: typeof result.score === "number" && result.score > 0 ? 10 : 0,
        maxScore: 10,
        details: `healthy=${result.healthy} score=${result.score}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("17.02.2", "Health — AetherLink /health endpoint", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const server = new AetherLinkServer(9993);
    await server.start();

    try {
      const resp = await fetch("http://localhost:9993/health");
      const body = await resp.json();
      return {
        score: resp.status === 200 && body.status ? 10 : 0,
        maxScore: 10,
        details: `status=${resp.status} body.status=${body.status}`,
      };
    } finally {
      await server.stop();
    }
  });

  await harness.runTest("17.02.3", "Health — forceKillAgent changes status", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const { TierRegistry } = await import(join(ROOT, "core/tier-registry.ts"));
    const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
    const { SystemSentinel } = await import(join(ROOT, "core/sentinel.ts"));

    const tmpDir = join(import.meta.dir, ".health-tmp3");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const registry = new AgentRegistry();
      registry.register({ id: "kill-target", name: "Target", tier: "worker", capabilities: [], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
      const tierRegistry = new TierRegistry();
      const logger = new SynapseLogger(tmpDir);
      const sentinel = new SystemSentinel(registry, tierRegistry, logger);
      sentinel.forceKillAgent("kill-target", "test kill");
      const agent = registry.get("kill-target");
      return {
        score: agent?.status === "error" ? 10 : 0,
        maxScore: 10,
        details: `agent status after kill: ${agent?.status}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await harness.runTest("17.02.4", "Health — pause and resume swarm", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const { TierRegistry } = await import(join(ROOT, "core/tier-registry.ts"));
    const { SynapseLogger } = await import(join(ROOT, "core/logger.ts"));
    const { SystemSentinel } = await import(join(ROOT, "core/sentinel.ts"));

    const tmpDir = join(import.meta.dir, ".health-tmp4");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const registry = new AgentRegistry();
      registry.register({ id: "pause-agent", name: "Pausable", tier: "worker", capabilities: [], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
      const tierRegistry = new TierRegistry();
      const logger = new SynapseLogger(tmpDir);
      const sentinel = new SystemSentinel(registry, tierRegistry, logger);

      sentinel.pauseSwarm("testing");
      const paused = sentinel.isPaused();
      const agentWhilePaused = registry.get("pause-agent");

      sentinel.resumeSwarm();
      const resumed = !sentinel.isPaused();
      const agentAfterResume = registry.get("pause-agent");

      return {
        score: paused && resumed ? 10 : paused ? 7 : 0,
        maxScore: 10,
        details: `paused=${paused} agentStatus=${agentWhilePaused?.status} resumed=${resumed} resumedStatus=${agentAfterResume?.status}`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
