// Phase 12.04: Conflict Resolution Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("12.04.1", "Conflict — majority-vote picks centroid output", async () => {
    const { ConflictResolver } = await import(join(ROOT, "core/conflict-resolution.ts"));
    const resolver = new ConflictResolver();

    const outputs = [
      { agentId: "a1", tier: "worker", output: "The answer is to use React with hooks for state management" },
      { agentId: "a2", tier: "worker", output: "The answer is to use React with hooks for managing state" },
      { agentId: "a3", tier: "worker", output: "Use Vue.js with composition API for state management" },
    ];

    const result = await resolver.resolve(outputs as any, "majority-vote");
    // The two React outputs are more similar, so centroid should pick one of them
    const pickedReact = result.output.toLowerCase().includes("react");
    return {
      score: pickedReact ? 10 : result.output.length > 0 ? 5 : 0,
      maxScore: 10,
      details: `strategy=${result.strategy} picked react=${pickedReact}`,
    };
  });

  await harness.runTest("12.04.2", "Conflict — weighted-by-tier picks highest tier", async () => {
    const { ConflictResolver } = await import(join(ROOT, "core/conflict-resolution.ts"));
    const resolver = new ConflictResolver();

    const outputs = [
      { agentId: "worker-1", tier: "worker", output: "Use approach A for quick implementation" },
      { agentId: "manager-1", tier: "manager", output: "Use approach B for better architecture" },
      { agentId: "master-1", tier: "master", output: "Use approach C for strategic alignment" },
    ];

    const result = await resolver.resolve(outputs as any, "weighted-by-tier");
    const pickedMaster = result.output.includes("approach C") || result.output.includes("strategic");
    return {
      score: pickedMaster ? 10 : 0,
      maxScore: 10,
      details: `strategy=${result.strategy} pickedMaster=${pickedMaster}`,
    };
  });

  await harness.runTest("12.04.3", "Conflict — merge combines outputs", async () => {
    const { ConflictResolver } = await import(join(ROOT, "core/conflict-resolution.ts"));
    const resolver = new ConflictResolver();

    const outputs = [
      { agentId: "a1", tier: "worker", output: "The frontend should use React for the UI layer" },
      { agentId: "a2", tier: "worker", output: "The backend should use PostgreSQL for data storage" },
    ];

    const result = await resolver.resolve(outputs as any, "merge");
    const hasBoth = result.output.length > outputs[0].output.length;
    return {
      score: hasBoth ? 10 : result.output.length > 0 ? 5 : 0,
      maxScore: 10,
      details: `strategy=${result.strategy} merged output length=${result.output.length} (longer than single: ${hasBoth})`,
    };
  });
}
