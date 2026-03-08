// Phase 11.03: Escalation Chain Integration Test
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "11.03.1",
    "Escalation — worker to manager",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const { EscalationManager } = await import(
        join(ROOT, "core/escalation.ts")
      );
      const registry = new AgentRegistry();
      registry.register({
        id: "worker-1",
        name: "Worker",
        tier: "worker",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
        escalationTarget: "manager-1",
      } as any);
      registry.register({
        id: "manager-1",
        name: "Manager",
        tier: "manager",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
        escalationTarget: "master-1",
      } as any);
      registry.register({
        id: "master-1",
        name: "Master",
        tier: "master",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
      } as any);

      const escalation = new EscalationManager(registry);
      const result = escalation.escalate("worker-1", "Task failed", 3);
      return {
        score: result.target?.id === "manager-1" ? 10 : 0,
        maxScore: 10,
        details: `target=${result.target?.id ?? "none"} circuitBroken=${result.circuitBroken}`,
      };
    },
  );

  await harness.runTest(
    "11.03.2",
    "Escalation — manager to master",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const { EscalationManager } = await import(
        join(ROOT, "core/escalation.ts")
      );
      const registry = new AgentRegistry();
      registry.register({
        id: "mgr-a",
        name: "Manager",
        tier: "manager",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
        escalationTarget: "mstr-a",
      } as any);
      registry.register({
        id: "mstr-a",
        name: "Master",
        tier: "master",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
      } as any);

      const escalation = new EscalationManager(registry);
      const result = escalation.escalate("mgr-a", "Manager failed too", 4);
      return {
        score: result.target?.id === "mstr-a" ? 10 : 0,
        maxScore: 10,
        details: `target=${result.target?.id ?? "none"}`,
      };
    },
  );

  await harness.runTest(
    "11.03.3",
    "Escalation — circuit breaker trips",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const { EscalationManager } = await import(
        join(ROOT, "core/escalation.ts")
      );
      const registry = new AgentRegistry();
      registry.register({
        id: "w-cb",
        name: "Worker",
        tier: "worker",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
        escalationTarget: "m-cb",
      } as any);
      registry.register({
        id: "m-cb",
        name: "Manager",
        tier: "manager",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
      } as any);

      const escalation = new EscalationManager(registry, {
        threshold: 3,
        windowMs: 60000,
      });
      // Trigger multiple escalations to trip circuit breaker
      for (let i = 0; i < 4; i++) {
        escalation.escalate("w-cb", `failure ${i}`, 3);
      }
      const result = escalation.escalate("w-cb", "one more", 3);
      return {
        score: result.circuitBroken ? 10 : 0,
        maxScore: 10,
        details: `circuitBroken=${result.circuitBroken}`,
      };
    },
  );

  await harness.runTest(
    "11.03.4",
    "Escalation — chain traversal (registry)",
    async () => {
      const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
      const registry = new AgentRegistry();
      registry.register({
        id: "chain-w",
        name: "Worker",
        tier: "worker",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
        escalationTarget: "chain-m",
      } as any);
      registry.register({
        id: "chain-m",
        name: "Manager",
        tier: "manager",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
        escalationTarget: "chain-x",
      } as any);
      registry.register({
        id: "chain-x",
        name: "Master",
        tier: "master",
        capabilities: ["code"],
        sections: ["TOOLS" as any],
        status: "idle",
        format: "markdown",
        systemPrompt: "",
      } as any);

      const chain = registry.getEscalationChain("chain-w");
      return {
        score:
          chain.length === 2 &&
          chain[0].id === "chain-m" &&
          chain[1].id === "chain-x"
            ? 10
            : 0,
        maxScore: 10,
        details: `chain=[${chain.map((a: any) => a.id).join(" → ")}] length=${chain.length}`,
      };
    },
  );
}
