// Phase 13.04: Contract Validation Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("13.04.1", "Contract — MCP tool names match VS Code bridge calls", async () => {
    // Parse MCP tool names from aether-mcp.ts
    const mcpContent = readFileSync(join(ROOT, "bin/aether-mcp.ts"), "utf-8");
    const mcpToolNames = ["submit_task", "query_agents", "search_memory", "get_status", "switch_context", "get_config"];
    const allInMcp = mcpToolNames.every(t => mcpContent.includes(`"${t}"`));

    // Check that VS Code extension uses these tool names
    const extContent = readFileSync(join(ROOT, "aether-vscode/src/extension.ts"), "utf-8");
    const bridgeTools = ["submit_task", "query_agents", "get_status", "switch_context"];
    const allInExt = bridgeTools.every(t => extContent.includes(t));

    return {
      score: allInMcp && allInExt ? 10 : allInMcp ? 7 : 0,
      maxScore: 10,
      details: `MCP has all tools: ${allInMcp}, extension uses bridge tools: ${allInExt}`,
    };
  });

  await harness.runTest("13.04.2", "Contract — MCP resource URIs match extension reads", async () => {
    const extContent = readFileSync(join(ROOT, "aether-vscode/src/extension.ts"), "utf-8");
    const hasAgentsUri = extContent.includes("aether://agents");
    return {
      score: hasAgentsUri ? 10 : 0,
      maxScore: 10,
      details: `extension reads aether://agents: ${hasAgentsUri}`,
    };
  });

  await harness.runTest("13.04.3", "Contract — chat participant slash commands match package.json", async () => {
    const pkgPath = join(ROOT, "aether-vscode/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const chatParticipants = pkg.contributes?.chatParticipants ?? [];
    const participant = chatParticipants.find((p: any) => p.id === "aether.chat");
    const slashCommands = (participant?.commands ?? []).map((c: any) => c.name);
    const expected = ["plan", "run", "review", "test", "debug", "architect", "group", "status", "context"];
    const missing = expected.filter(c => !slashCommands.includes(c));
    return {
      score: missing.length === 0 ? 10 : missing.length <= 2 ? 7 : 0,
      maxScore: 10,
      details: `slash commands: ${slashCommands.length} missing: [${missing.join(", ")}]`,
    };
  });
}
