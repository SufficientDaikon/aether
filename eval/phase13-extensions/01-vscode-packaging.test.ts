// Phase 13.01: VS Code Extension Packaging Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("13.01.1", "VSCode — package.json has all required commands", async () => {
    const pkgPath = join(ROOT, "aether-vscode/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const commands: { command: string; title: string }[] = pkg.contributes?.commands ?? [];
    const commandIds = commands.map(c => c.command);

    const required = [
      "aether.runTask", "aether.planTask", "aether.showOrchestrator",
      "aether.showCosts", "aether.showMemory", "aether.showSettings",
      "aether.switchContext", "aether.refreshAgents", "aether.agentRunTask",
      "aether.agentDetail", "aether.approveAll", "aether.rejectAll",
    ];

    const missing = required.filter(id => !commandIds.includes(id));
    return {
      score: missing.length === 0 ? 10 : missing.length <= 2 ? 7 : 0,
      maxScore: 10,
      details: `commands: ${commandIds.length} missing: [${missing.join(", ")}]`,
    };
  });

  await harness.runTest("13.01.2", "VSCode — tree views declared in package.json", async () => {
    const pkgPath = join(ROOT, "aether-vscode/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const views = pkg.contributes?.views?.["aether-sidebar"] ?? [];
    const viewIds = views.map((v: any) => v.id);

    const required = ["aether.agents", "aether.tasks", "aether.contexts", "aether.knowledge"];
    const missing = required.filter(id => !viewIds.includes(id));
    return {
      score: missing.length === 0 ? 10 : 0,
      maxScore: 10,
      details: `views: [${viewIds.join(", ")}] missing: [${missing.join(", ")}]`,
    };
  });

  await harness.runTest("13.01.3", "VSCode — .vscodeignore present", async () => {
    const ignorePath = join(ROOT, "aether-vscode/.vscodeignore");
    const exists = existsSync(ignorePath);
    return {
      score: exists ? 10 : 0,
      maxScore: 10,
      details: `.vscodeignore exists: ${exists}`,
    };
  });

  await harness.runTest("13.01.4", "VSCode — activation events configured", async () => {
    const pkgPath = join(ROOT, "aether-vscode/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const events: string[] = pkg.activationEvents ?? [];
    const hasStartup = events.some(e => e.includes("onStartupFinished"));
    const hasWorkspace = events.some(e => e.includes("workspaceContains"));
    return {
      score: hasStartup && hasWorkspace ? 10 : hasStartup || hasWorkspace ? 7 : 0,
      maxScore: 10,
      details: `activationEvents: [${events.join(", ")}] startup=${hasStartup} workspace=${hasWorkspace}`,
    };
  });
}
