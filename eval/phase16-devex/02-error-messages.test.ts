// Phase 16.02: Error Message Quality Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("16.02.1", "Errors — unknown agent ID gives clear error", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const reg = new AgentRegistry();
    let errMsg = "";
    try {
      reg.updateStatus("nonexistent-agent", "active");
    } catch (e: any) {
      errMsg = e.message;
    }
    const isActionable = errMsg.includes("not found") && !errMsg.includes("undefined");
    return {
      score: isActionable ? 10 : errMsg.length > 0 ? 5 : 0,
      maxScore: 10,
      details: `error="${errMsg}" actionable=${isActionable}`,
    };
  });

  await harness.runTest("16.02.2", "Errors — duplicate agent gives clear error", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const reg = new AgentRegistry();
    reg.register({ id: "err-test", name: "A", tier: "worker", capabilities: [], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
    let errMsg = "";
    try {
      reg.register({ id: "err-test", name: "B", tier: "worker", capabilities: [], sections: ["TOOLS" as any], status: "idle", format: "markdown", systemPrompt: "" } as any);
    } catch (e: any) {
      errMsg = e.message;
    }
    const isActionable = errMsg.includes("duplicate") && errMsg.includes("err-test");
    return {
      score: isActionable ? 10 : errMsg.length > 0 ? 5 : 0,
      maxScore: 10,
      details: `error="${errMsg}" actionable=${isActionable}`,
    };
  });

  await harness.runTest("16.02.3", "Errors — CLI unknown command shows help", async () => {
    const CLI = join(ROOT, "bin/aether.ts");
    const proc = Bun.spawn(["bun", "run", CLI, "nonexistent-cmd"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const output = stdout + stderr;
    const hasHelp = output.toLowerCase().includes("unknown") || output.toLowerCase().includes("help") || output.toLowerCase().includes("usage") || output.toLowerCase().includes("available");
    return {
      score: hasHelp ? 10 : output.length > 0 ? 5 : 0,
      maxScore: 10,
      details: `shows helpful message: ${hasHelp}`,
    };
  });

  await harness.runTest("16.02.4", "Errors — loadFromStore without store gives clear error", async () => {
    const { AgentRegistry } = await import(join(ROOT, "core/registry.ts"));
    const reg = new AgentRegistry(); // no store
    let errMsg = "";
    try {
      await reg.loadFromStore();
    } catch (e: any) {
      errMsg = e.message;
    }
    const isActionable = errMsg.includes("no store") || errMsg.includes("store");
    return {
      score: isActionable ? 10 : errMsg.length > 0 ? 5 : 0,
      maxScore: 10,
      details: `error="${errMsg}" actionable=${isActionable}`,
    };
  });

  await harness.runTest("16.02.5", "Errors — SchemaValidator handles malformed JSON gracefully", async () => {
    const { SchemaValidator } = await import(join(ROOT, "core/schema.ts"));
    const v = new SchemaValidator();
    const result = v.validate("this is not json at all", { type: "object" });
    const isGraceful = !result.valid && (result.error != null || result.data == null);
    return {
      score: isGraceful ? 10 : 0,
      maxScore: 10,
      details: `graceful rejection: valid=${result.valid}`,
    };
  });
}
