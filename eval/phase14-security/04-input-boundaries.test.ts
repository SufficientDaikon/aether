// Phase 14.04: Input Boundary Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("14.04.1", "Boundary — BAPCodec rejects corrupt buffer", async () => {
    const { BAPCodec } = await import(join(ROOT, "protocol/codec.ts"));
    let threw = false;
    try {
      BAPCodec.decode(new Uint8Array([0xFF, 0xFE, 0x00, 0x01, 0x02, 0x03]));
    } catch {
      threw = true;
    }
    return {
      score: threw ? 10 : 0,
      maxScore: 10,
      details: `threw on corrupt buffer: ${threw}`,
    };
  });

  await harness.runTest("14.04.2", "Boundary — Registry rejects duplicate ID", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const reg = new AgentRegistry();
    reg.register({ id: "dup-test", name: "A", tier: "worker", capabilities: ["x"], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
    let threw = false;
    try {
      reg.register({ id: "dup-test", name: "B", tier: "worker", capabilities: ["y"], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
    } catch {
      threw = true;
    }
    return {
      score: threw ? 10 : 0,
      maxScore: 10,
      details: `threw on duplicate: ${threw}`,
    };
  });

  await harness.runTest("14.04.3", "Boundary — LengthGuard blocks oversized prompt", async () => {
    const { LengthGuard } = await import(join(ROOT, "core/guardrails.ts"));
    const guard = new LengthGuard(1000);
    const agent = { id: "test", name: "Test", tier: "worker" } as any;
    const result = guard.check("x".repeat(2000), agent);
    return {
      score: !result.allowed ? 10 : 0,
      maxScore: 10,
      details: `blocked oversized: ${!result.allowed}`,
    };
  });

  await harness.runTest("14.04.4", "Boundary — Registry get returns undefined for missing ID", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const reg = new AgentRegistry();
    const result = reg.get("nonexistent-agent-id-xyz");
    return {
      score: result === undefined ? 10 : 0,
      maxScore: 10,
      details: `returns undefined for missing: ${result === undefined}`,
    };
  });
}
