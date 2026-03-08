// ─────────────────────────────────────────────────────────────
// Phase 10.05: Registry Lookup Performance Benchmarks
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

const SECTIONS = [
  "TOOLS",
  "MCP_SERVER",
  "SKILL",
  "WORKFLOW",
  "RESEARCH",
  "FRONTEND",
  "BACKEND",
  "MARKETING",
  "AUDIT",
  "SECURITY",
  "META",
] as const;

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "10.05.1",
    "Registry — register 1000 agents",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const registry = new AgentRegistry();

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        registry.register({
          id: `bench-${i}`,
          name: `Bench Agent ${i}`,
          tier: (["master", "manager", "worker"] as const)[i % 3],
          capabilities: [`cap-${i % 20}`, `skill-${i % 10}`, "general"],
          sections: [SECTIONS[i % SECTIONS.length]],
          format: "markdown",
          systemPrompt: `You are agent ${i}`,
          status: "idle",
        } as any);
      }
      const elapsed = performance.now() - start;

      return {
        score: elapsed < 100 ? 10 : elapsed < 500 ? 7 : elapsed < 2000 ? 4 : 0,
        maxScore: 10,
        details: `1000 agents in ${elapsed.toFixed(1)}ms`,
        metadata: { elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest(
    "10.05.2",
    "Registry — findByCapability latency",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const registry = new AgentRegistry();

      for (let i = 0; i < 1000; i++) {
        registry.register({
          id: `agent-${i}`,
          name: `A${i}`,
          tier: "worker",
          capabilities: [`cap-${i % 20}`, "general"],
          sections: [SECTIONS[i % SECTIONS.length]],
          format: "markdown",
          systemPrompt: "p",
          status: "idle",
        } as any);
      }

      const latencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = performance.now();
        registry.findByCapability(`cap-${i % 20}`);
        latencies.push(performance.now() - s);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[50];
      const p95 = latencies[95];

      return {
        score: p95 < 1 ? 10 : p95 < 5 ? 7 : p95 < 50 ? 4 : 0,
        maxScore: 10,
        details: `p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms over 100 queries`,
        metadata: { p50, p95 },
      };
    },
  );

  await harness.runTest(
    "10.05.3",
    "Registry — findBySection latency",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const registry = new AgentRegistry();

      for (let i = 0; i < 1000; i++) {
        registry.register({
          id: `agent-sec-${i}`,
          name: `A${i}`,
          tier: "worker",
          capabilities: ["general"],
          sections: [SECTIONS[i % SECTIONS.length]],
          format: "markdown",
          systemPrompt: "p",
          status: "idle",
        } as any);
      }

      const latencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = performance.now();
        registry.findBySection(SECTIONS[i % SECTIONS.length]);
        latencies.push(performance.now() - s);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[50];
      const p95 = latencies[95];

      return {
        score: p95 < 1 ? 10 : p95 < 5 ? 7 : p95 < 50 ? 4 : 0,
        maxScore: 10,
        details: `p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms over 100 queries`,
        metadata: { p50, p95 },
      };
    },
  );
}
