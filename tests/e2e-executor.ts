// ─────────────────────────────────────────────────────────────
// AETHER E2E Executor Smoke Test
// Boots the full runtime, discovers agents, and runs a complex
// "build SaaS frontend" task through the agent hierarchy.
//
// If ANTHROPIC_API_KEY is set: runs a real single-agent LLM call.
// Otherwise: uses the full mock workflow for offline testing.
//
// Usage:  bun run tests/e2e-executor.ts
// ─────────────────────────────────────────────────────────────

import { AgentExecutor } from "../core/executor.ts";
import { AgentRegistry } from "../core/registry.ts";
import { EscalationManager } from "../core/escalation.ts";
import { SynapseLogger } from "../core/logger.ts";
import { ProviderManager } from "../providers/manager.ts";
import { BaseLLMProvider, type LLMOptions, type LLMResponse } from "../providers/base.ts";
import type { AgentDefinition, TaskRequest } from "../core/types.ts";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

// ── Colors ───────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

function header(text: string) {
  console.log(`\n${c.bold}${c.cyan}═══ ${text} ═══${c.reset}`);
}

function success(text: string) {
  console.log(`  ${c.green}✓${c.reset} ${text}`);
}

function info(text: string) {
  console.log(`  ${c.dim}→${c.reset} ${text}`);
}

function warn(text: string) {
  console.log(`  ${c.yellow}⚠${c.reset} ${text}`);
}

function fail(text: string) {
  console.log(`  ${c.red}✗${c.reset} ${text}`);
}

// ── Mock Provider (for offline testing) ──────────────────────

class E2EMockProvider extends BaseLLMProvider {
  private responseMap: Map<string, string> = new Map();

  constructor() {
    super("e2e-mock", "mock-key");

    this.responseMap.set("architecture", `# SaaS Frontend Architecture

## Component Tree
App
├── AuthLayout (LoginPage, SignupPage)
├── DashboardLayout
│   ├── Sidebar (collapsible)
│   ├── TopBar (search, notifications, profile)
│   └── MainContent
│       ├── DashboardPage (KPICards, RevenueChart, ActivityTable)
│       ├── AnalyticsPage
│       ├── UsersPage
│       ├── BillingPage
│       └── SettingsPage

## Tech Decisions
- Framework: React 18 + TypeScript
- Styling: TailwindCSS v4 + shadcn/ui
- State: Zustand (global) + React Query (server state)
- Router: React Router v7
- Charts: Recharts
- Tables: TanStack Table v8
- Forms: React Hook Form + Zod
- Auth: JWT with refresh tokens`);

    this.responseMap.set("implement", `# React Implementation

## Dashboard Feature

\`\`\`tsx
export function Dashboard() {
  const { data: kpis } = useQuery(['kpis'], fetchKPIs);
  const { data: analytics } = useQuery(['analytics'], fetchAnalytics);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Header />
        <KPIGrid data={kpis} />
        <div className="grid grid-cols-2 gap-6 mt-6">
          <LineChart data={analytics?.revenue} />
          <BarChart data={analytics?.users} />
        </div>
      </main>
    </div>
  );
}
\`\`\`

Components created: Dashboard, Sidebar, Header, KPIGrid, KPICard, LineChart, BarChart
Total: 847 lines across 6 components`);

    this.responseMap.set("review", `# UX Review Report — SaaS Dashboard

## Overall Score: 91/100

### Accessibility (85/100)
- Color contrast meets WCAG 2.1 AA
- KPI trend indicators need arrows (not just color)
- Chart data needs screen reader tables

### Performance (94/100)
- React Query prevents unnecessary refetches
- Skeleton loading prevents layout shift (CLS: 0.02)
- Charts lazy-loaded with Suspense

### Usability (93/100)
- Clear visual hierarchy
- Consistent spacing (4px grid)
- Responsive 320px-2560px

### Verdict: Ready for production with a11y fixes`);
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

    let content = "Task processed.";
    const lower = prompt.toLowerCase();

    if (lower.includes("architect") || lower.includes("decompos") || lower.includes("design")) {
      content = this.responseMap.get("architecture") ?? content;
    } else if (lower.includes("implement") || lower.includes("build") || lower.includes("react")) {
      content = this.responseMap.get("implement") ?? content;
    } else if (lower.includes("review") || lower.includes("ux") || lower.includes("access")) {
      content = this.responseMap.get("review") ?? content;
    }

    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(content.length / 4);
    this.trackUsage(inputTokens, outputTokens);

    return {
      content,
      model: options.model ?? "e2e-mock",
      tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      latencyMs: 75,
      provider: "e2e-mock",
    };
  }
}

// ── Agent Setup ──────────────────────────────────────────────

function setupAgents(registry: AgentRegistry): void {
  const tmpDir = join(process.cwd(), ".aether", "e2e-agents");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const agentDefs = [
    { id: "system-architect", name: "System Architect", tier: "manager" as const, sections: ["FRONTEND", "BACKEND"] as any[], capabilities: ["architecture", "system design", "decomposition"], llmRequirement: "sonnet" as const },
    { id: "ui-designer", name: "UI Designer", tier: "worker" as const, sections: ["FRONTEND"] as any[], capabilities: ["ui design", "wireframes", "figma"], llmRequirement: "haiku" as const, escalationTarget: "system-architect" },
    { id: "react-specialist", name: "React Specialist", tier: "worker" as const, sections: ["FRONTEND"] as any[], capabilities: ["react", "typescript", "components", "hooks"], llmRequirement: "sonnet" as const, escalationTarget: "system-architect" },
    { id: "ux-psychologist", name: "UX Psychologist", tier: "worker" as const, sections: ["FRONTEND"] as any[], capabilities: ["ux review", "accessibility", "usability"], llmRequirement: "haiku" as const, escalationTarget: "system-architect" },
  ];

  for (const def of agentDefs) {
    const filePath = join(tmpDir, `${def.id}.agent.md`);
    writeFileSync(filePath, `---\nid: ${def.id}\nname: ${def.name}\ntier: ${def.tier}\n---\n\n# ${def.name}\n\nYou are ${def.name}. Complete tasks thoroughly.\n`);

    registry.register({
      id: def.id,
      name: def.name,
      tier: def.tier,
      sections: def.sections,
      capabilities: def.capabilities,
      dependencies: [],
      llmRequirement: def.llmRequirement,
      format: "markdown",
      escalationTarget: def.escalationTarget ?? null,
      filePath,
      status: "idle",
      metadata: {},
    });
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`${c.bold}${c.magenta}`);
  console.log(`  ╔══════════════════════════════════════════════════╗`);
  console.log(`  ║  AETHER E2E Executor — SaaS Frontend Build Test ║`);
  console.log(`  ╚══════════════════════════════════════════════════╝${c.reset}`);

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  console.log(`  ${hasApiKey ? c.green + "Mode: LIVE" : c.yellow + "Mode: MOCK"}${c.reset}`);

  // Setup
  header("1. Setting up runtime");

  const registry = new AgentRegistry();
  const escalation = new EscalationManager(registry);
  const logDir = join(process.cwd(), ".aether", "e2e-logs");
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logger = new SynapseLogger(logDir, "info");

  let providers: ProviderManager;
  if (hasApiKey) {
    providers = new ProviderManager();
    success("Real providers initialized");
  } else {
    const mockProvider = new E2EMockProvider();
    providers = new ProviderManager();
    (providers as any).sendForTier = async (_tier: any, prompt: string, options?: any) => {
      return mockProvider.send(prompt, { model: "mock", ...options });
    };
    success("Mock provider initialized");
  }

  setupAgents(registry);
  success(`Registered ${registry.getAll().length} agents`);

  const executor = new AgentExecutor(registry, escalation, logger, providers, undefined, {
    maxTokens: hasApiKey ? 500 : 4096,
  });
  success("AgentExecutor ready");

  // Live test (if API key)
  if (hasApiKey) {
    header("2. Live LLM Test (single agent, capped at 500 tokens)");
    const liveTask: TaskRequest = {
      id: "live-test-1",
      description: "List 3 essential React components for a SaaS dashboard. Be concise.",
      requester: "e2e-test",
      target: "react-specialist",
      priority: 3,
      context: { framework: "React 18", styling: "TailwindCSS" },
    };
    const liveResult = await executor.execute(liveTask);
    if (liveResult.status === "success") {
      success(`Live LLM call succeeded (${liveResult.duration}ms, ${liveResult.tokensUsed} tokens)`);
      info(`Output preview: ${String(liveResult.output).slice(0, 200)}...`);
    } else {
      fail(`Live LLM call failed: ${JSON.stringify(liveResult.output)}`);
    }
  }

  // Workflow test
  header(`${hasApiKey ? "3" : "2"}. SaaS Frontend Workflow`);

  const workflow: TaskRequest[] = [
    { id: "saas-1", description: "Design the architecture for a SaaS analytics dashboard", requester: "e2e", target: "system-architect", priority: 4, context: { product: "SaaS Analytics", techStack: ["React 18", "TypeScript", "TailwindCSS"] } },
    { id: "saas-2", description: "Implement the SaaS dashboard main page in React", requester: "e2e", target: "react-specialist", priority: 4, context: { framework: "React 18" } },
    { id: "saas-3", description: "Review the SaaS frontend for UX quality and accessibility", requester: "e2e", target: "ux-psychologist", priority: 3, context: { standards: ["WCAG 2.1 AA"] } },
  ];

  info("Running 3-step workflow: Architecture → Implementation → UX Review\n");
  const results = await executor.executeWorkflow(workflow);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const names = ["Architecture", "Implementation", "UX Review"];
    const status = r.status === "success" ? `${c.green}✓ SUCCESS${c.reset}` : `${c.red}✗ ${r.status.toUpperCase()}${c.reset}`;
    console.log(`  ${c.bold}Step ${i + 1}: ${names[i]}${c.reset} — ${status} (${r.duration}ms, ${r.tokensUsed ?? 0} tokens)`);
    info(String(r.output).split("\n")[0].slice(0, 120));
  }

  // Pipeline test
  header(`${hasApiKey ? "4" : "3"}. Parallel Pipeline Test`);
  const parallelTasks: TaskRequest[] = [
    { id: "par-1", description: "Design the user settings page", requester: "e2e", target: "ui-designer", priority: 2, context: {} },
    { id: "par-2", description: "Implement the billing integration", requester: "e2e", target: "react-specialist", priority: 2, context: {} },
  ];

  info(`Running ${parallelTasks.length} tasks in parallel...`);
  const start = Date.now();
  const pipeResults = await executor.executePipeline(parallelTasks);
  const elapsed = Date.now() - start;

  for (const r of pipeResults) {
    const status = r.status === "success" ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    console.log(`  ${status} ${r.requestId} (${r.executor}, ${r.duration}ms)`);
  }
  success(`Pipeline completed in ${elapsed}ms`);

  // Summary
  header("Summary");
  const metrics = executor.getMetrics();
  console.log(`  Total tasks:   ${c.bold}${metrics.totalTasks}${c.reset}`);
  console.log(`  Successful:    ${c.green}${metrics.successful}${c.reset}`);
  console.log(`  Failed:        ${metrics.failed > 0 ? c.red : c.dim}${metrics.failed}${c.reset}`);
  console.log(`  Escalated:     ${metrics.escalated > 0 ? c.yellow : c.dim}${metrics.escalated}${c.reset}`);
  console.log(`  Total tokens:  ${c.bold}${metrics.totalTokens.toLocaleString()}${c.reset}`);
  console.log(`  Avg latency:   ${c.bold}${Math.round(metrics.averageLatency)}ms${c.reset}\n`);

  const allPassed = results.every((r) => r.status === "success") && pipeResults.every((r) => r.status === "success");
  if (allPassed) {
    console.log(`  ${c.bold}${c.green}ALL TESTS PASSED${c.reset}\n`);
  } else {
    console.log(`  ${c.bold}${c.red}SOME TESTS FAILED${c.reset}\n`);
    process.exit(1);
  }

  await logger.close();
}

main().catch((err) => {
  console.error(`${c.red}E2E test crashed:${c.reset}`, err);
  process.exit(1);
});
