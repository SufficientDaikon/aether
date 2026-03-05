// ─────────────────────────────────────────────────────────────
// AgentExecutor Unit Tests
// Tests multi-step task execution, escalation, workflows, and
// pipelines using a mock LLM provider.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "bun:test";
import { AgentExecutor } from "../core/executor.ts";
import { AgentRegistry } from "../core/registry.ts";
import { EscalationManager } from "../core/escalation.ts";
import { SynapseLogger } from "../core/logger.ts";
import { ProviderManager } from "../providers/manager.ts";
import {
  BaseLLMProvider,
  type LLMOptions,
  type LLMResponse,
} from "../providers/base.ts";
import type { AgentDefinition, TaskRequest, Priority } from "../core/types.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";

// ── Mock LLM Provider ────────────────────────────────────────

class MockProvider extends BaseLLMProvider {
  public callLog: Array<{ prompt: string; options: LLMOptions }> = [];
  public responses: Map<string, string> = new Map();
  public defaultResponse = "Task completed successfully.";
  public shouldFail = false;
  public failMessage = "Mock provider error";
  public latencyMs = 10;

  constructor() {
    super("mock", "mock-api-key");
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    this.callLog.push({ prompt, options });

    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }

    // Simulate latency
    await new Promise((r) => setTimeout(r, this.latencyMs));

    // Check for pattern-matched responses
    let content = this.defaultResponse;
    for (const [pattern, response] of this.responses) {
      if (prompt.includes(pattern)) {
        content = response;
        break;
      }
    }

    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(content.length / 4);
    this.trackUsage(inputTokens, outputTokens);

    return {
      content,
      model: options.model ?? "mock-model",
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      latencyMs: this.latencyMs,
      provider: "mock",
    };
  }
}

// ── Mock Provider Manager ────────────────────────────────────

class MockProviderManager extends ProviderManager {
  public mockProvider: MockProvider;

  constructor() {
    super({
      master: { provider: "claude", model: "opus" },
      manager: { provider: "claude", model: "sonnet" },
      worker: { provider: "claude", model: "haiku" },
      fallbackChain: [],
    });
    this.mockProvider = new MockProvider();
  }

  // Override to always use the mock provider
  async sendForTier(
    _tier: any,
    prompt: string,
    options?: Partial<LLMOptions>,
  ): Promise<LLMResponse> {
    return this.mockProvider.send(prompt, {
      model: options?.model ?? "mock",
      ...options,
    } as LLMOptions);
  }
}

// ── Test Helpers ─────────────────────────────────────────────

function createTestAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  const id =
    overrides.id ?? `test-agent-${Math.random().toString(36).slice(2, 8)}`;
  // Create a temp agent file
  const tmpDir = mkdtempSync(join(tmpdir(), "aether-test-"));
  const agentDir = join(tmpDir, "agents");
  mkdirSync(agentDir, { recursive: true });
  const filePath = join(agentDir, `${id}.agent.md`);
  writeFileSync(
    filePath,
    `---
id: ${id}
name: ${overrides.name ?? "Test Agent"}
tier: ${overrides.tier ?? "worker"}
---

# ${overrides.name ?? "Test Agent"}

You are a test agent. Complete the task given to you accurately and thoroughly.
Respond with clear, structured output.
`,
  );

  return {
    id,
    name: overrides.name ?? "Test Agent",
    tier: overrides.tier ?? "worker",
    sections: overrides.sections ?? ["FRONTEND"],
    capabilities: overrides.capabilities ?? ["testing", "mock-work"],
    dependencies: overrides.dependencies ?? [],
    llmRequirement: overrides.llmRequirement ?? "haiku",
    format: overrides.format ?? "markdown",
    escalationTarget: overrides.escalationTarget ?? null,
    filePath,
    status: overrides.status ?? "idle",
    metadata: overrides.metadata ?? {},
  };
}

function createTask(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    id: overrides.id ?? `task-${crypto.randomUUID().slice(0, 8)}`,
    description: overrides.description ?? "Test task",
    requester: overrides.requester ?? "test-requester",
    target: overrides.target ?? "test-agent",
    priority: overrides.priority ?? 3,
    context: overrides.context ?? {},
    deadline: overrides.deadline,
  };
}

// ─────────────────────────────────────────────────────────────

describe("AgentExecutor", () => {
  let registry: AgentRegistry;
  let escalation: EscalationManager;
  let logger: SynapseLogger;
  let mockProviders: MockProviderManager;
  let executor: AgentExecutor;

  beforeEach(() => {
    registry = new AgentRegistry();
    escalation = new EscalationManager(registry);
    const logDir = join(mkdtempSync(join(tmpdir(), "aether-log-")), "logs");
    logger = new SynapseLogger(logDir, "error"); // suppress log noise in tests
    mockProviders = new MockProviderManager();
    executor = new AgentExecutor(registry, escalation, logger, mockProviders);
  });

  // ── Single Task Execution ──────────────────────────────────

  describe("single task execution", () => {
    it("should execute a task and return a success result", async () => {
      const agent = createTestAgent({
        id: "ui-designer",
        capabilities: ["ui design", "layout"],
      });
      registry.register(agent);

      mockProviders.mockProvider.defaultResponse =
        "Here is the SaaS dashboard layout with sidebar navigation and card-based widgets.";

      const task = createTask({
        description: "Design a SaaS dashboard layout",
        target: "ui-designer",
      });

      const result = await executor.execute(task);

      expect(result.requestId).toBe(task.id);
      expect(result.executor).toBe("ui-designer");
      expect(result.status).toBe("success");
      expect(result.output).toContain("SaaS dashboard layout");
      expect(result.duration).toBeGreaterThan(0);
      expect(result.tokensUsed).toBeGreaterThan(0);
    });

    it("should resolve agents by capability when direct ID doesn't match", async () => {
      const agent = createTestAgent({
        id: "react-specialist",
        capabilities: ["react", "components", "hooks"],
      });
      registry.register(agent);

      mockProviders.mockProvider.defaultResponse =
        "React component implemented.";

      const task = createTask({
        description: "Build a React component",
        target: "react", // capability, not ID
      });

      const result = await executor.execute(task);
      expect(result.status).toBe("success");
      expect(result.executor).toBe("react-specialist");
    });

    it("should return failure when no agent matches the target", async () => {
      const task = createTask({
        description: "Do something",
        target: "nonexistent-agent",
      });

      const result = await executor.execute(task);
      expect(result.status).toBe("failure");
      expect((result.output as any).error).toContain("No agent found");
    });

    it("should include task context in the LLM prompt", async () => {
      const agent = createTestAgent({ id: "context-agent" });
      registry.register(agent);

      const task = createTask({
        target: "context-agent",
        description: "Process with context",
        context: { framework: "React", database: "PostgreSQL" },
      });

      await executor.execute(task);

      const lastCall = mockProviders.mockProvider.callLog[0];
      expect(lastCall.prompt).toContain("React");
      expect(lastCall.prompt).toContain("PostgreSQL");
    });

    it("should respect task deadline", async () => {
      const agent = createTestAgent({ id: "deadline-agent" });
      registry.register(agent);

      const task = createTask({
        target: "deadline-agent",
        description: "Past deadline task",
        deadline: Date.now() - 1000, // Already expired
      });

      const result = await executor.execute(task);
      expect(result.status).toBe("failure");
      expect((result.output as any).error).toContain("deadline");
    });
  });

  // ── Sub-task Decomposition ────────────────────────────────

  describe("sub-task decomposition", () => {
    it("should handle agent-requested sub-tasks", async () => {
      const architect = createTestAgent({
        id: "system-architect",
        tier: "manager",
        capabilities: ["architecture", "decomposition"],
      });
      const reactDev = createTestAgent({
        id: "react-dev",
        capabilities: ["react", "frontend"],
      });
      registry.register(architect);
      registry.register(reactDev);

      // Architect responds with sub-task request
      mockProviders.mockProvider.responses.set(
        "Build SaaS frontend",
        `I'll decompose this into components.

The architecture should use:
- React with TypeScript
- TailwindCSS for styling
- React Query for data fetching

\`\`\`subtasks
[{"target": "react-dev", "description": "Implement the dashboard component with charts and KPIs", "priority": 3}]
\`\`\`
`,
      );

      mockProviders.mockProvider.responses.set(
        "Implement the dashboard",
        "Dashboard component implemented with Chart.js integration and responsive grid layout.",
      );

      const task = createTask({
        description: "Build SaaS frontend",
        target: "system-architect",
        priority: 4,
      });

      const result = await executor.execute(task);
      expect(result.status).toBe("success");

      // Output should contain both the main output and sub-task results
      const output = result.output as any;
      expect(output.mainOutput).toContain("architecture");
      expect(output.subTaskResults).toHaveLength(1);
      expect(output.subTaskResults[0].status).toBe("success");
    });

    it("should respect maxDepth for sub-tasks", async () => {
      const agent = createTestAgent({ id: "recursive-agent" });
      registry.register(agent);

      // Agent always requests more sub-tasks
      mockProviders.mockProvider.defaultResponse = `Need more work.\n\`\`\`subtasks\n[{"target": "recursive-agent", "description": "More work", "priority": 3}]\n\`\`\``;

      const task = createTask({ target: "recursive-agent" });
      const limitedExecutor = new AgentExecutor(
        registry,
        escalation,
        logger,
        mockProviders,
        undefined,
        {
          maxDepth: 1,
        },
      );

      const result = await limitedExecutor.execute(task);
      // Should complete without infinite recursion
      expect(result.status).toBe("success");
      // Should have stopped recursing at depth 1
      expect(mockProviders.mockProvider.callLog.length).toBeLessThanOrEqual(3);
    });
  });

  // ── Escalation ─────────────────────────────────────────────

  describe("escalation", () => {
    it("should escalate to a higher-tier agent on failure", async () => {
      const worker = createTestAgent({
        id: "junior-worker",
        tier: "worker",
        escalationTarget: "senior-manager",
      });
      const manager = createTestAgent({
        id: "senior-manager",
        tier: "manager",
        capabilities: ["management", "oversight"],
      });
      registry.register(worker);
      registry.register(manager);

      // First call (worker) fails, second call (manager) succeeds
      let callCount = 0;
      const originalSend = mockProviders.mockProvider.send.bind(
        mockProviders.mockProvider,
      );
      mockProviders.mockProvider.send = async function (
        prompt: string,
        options: LLMOptions,
      ) {
        callCount++;
        if (callCount === 1) {
          throw new Error("Worker overwhelmed — task too complex");
        }
        return originalSend(prompt, options);
      };

      const task = createTask({
        target: "junior-worker",
        description: "Complex analysis task",
        priority: 3,
      });

      const result = await executor.execute(task);
      // Should have succeeded via escalation
      expect(["success", "escalated"].includes(result.status)).toBe(true);
    });

    it("should handle escalation with no target gracefully", async () => {
      const loneWorker = createTestAgent({
        id: "lone-worker",
        tier: "worker",
        escalationTarget: null,
      });
      registry.register(loneWorker);

      mockProviders.mockProvider.shouldFail = true;
      mockProviders.mockProvider.failMessage = "API rate limited";

      const task = createTask({ target: "lone-worker" });

      const result = await executor.execute(task);
      expect(result.status).toBe("failure");
      expect((result.output as any).error).toContain("rate limited");
    });
  });

  // ── Workflow Execution ─────────────────────────────────────

  describe("workflow execution", () => {
    it("should execute sequential tasks with context threading", async () => {
      const designer = createTestAgent({
        id: "designer",
        capabilities: ["design"],
      });
      const developer = createTestAgent({
        id: "developer",
        capabilities: ["development"],
      });
      const reviewer = createTestAgent({
        id: "reviewer",
        capabilities: ["review"],
      });
      registry.register(designer);
      registry.register(developer);
      registry.register(reviewer);

      mockProviders.mockProvider.responses.set(
        "Design",
        "Wireframes: header, sidebar, content grid, footer.",
      );
      mockProviders.mockProvider.responses.set(
        "Implement",
        "React components built: Header.tsx, Sidebar.tsx, Grid.tsx.",
      );
      mockProviders.mockProvider.responses.set(
        "Review",
        "UX review passed. All components meet accessibility standards.",
      );

      const tasks: TaskRequest[] = [
        createTask({
          target: "designer",
          description: "Design the SaaS dashboard wireframes",
        }),
        createTask({
          target: "developer",
          description: "Implement the designed components in React",
        }),
        createTask({
          target: "reviewer",
          description: "Review the implementation for UX quality",
        }),
      ];

      const results = await executor.executeWorkflow(tasks);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe("success");
      expect(results[1].status).toBe("success");
      expect(results[2].status).toBe("success");

      // Verify context threading: step 2 should have received step 1's output
      const step2Call = mockProviders.mockProvider.callLog[1];
      expect(step2Call.prompt).toContain("previousResult");
    });

    it("should halt workflow on critical failure", async () => {
      const agent1 = createTestAgent({ id: "step1-agent" });
      const agent2 = createTestAgent({ id: "step2-agent" });
      registry.register(agent1);
      registry.register(agent2);

      // First task succeeds, second fails
      let callNum = 0;
      mockProviders.mockProvider.send = async function (prompt, options) {
        callNum++;
        if (callNum >= 2) throw new Error("Critical failure in step 2");
        return {
          content: "Step 1 done.",
          model: "mock",
          tokensUsed: { input: 10, output: 10, total: 20 },
          latencyMs: 5,
          provider: "mock",
        };
      };

      const tasks: TaskRequest[] = [
        createTask({ target: "step1-agent", description: "Step 1" }),
        createTask({ target: "step2-agent", description: "Step 2" }),
      ];

      const results = await executor.executeWorkflow(tasks);
      expect(results[0].status).toBe("success");
      // Step 2 should have failed (or escalated)
      expect(["failure", "escalated"].includes(results[1].status)).toBe(true);
    });
  });

  // ── Pipeline Execution ─────────────────────────────────────

  describe("pipeline execution", () => {
    it("should execute tasks in parallel", async () => {
      const agent1 = createTestAgent({
        id: "parallel-1",
        capabilities: ["parallel"],
      });
      const agent2 = createTestAgent({
        id: "parallel-2",
        capabilities: ["parallel"],
      });
      const agent3 = createTestAgent({
        id: "parallel-3",
        capabilities: ["parallel"],
      });
      registry.register(agent1);
      registry.register(agent2);
      registry.register(agent3);

      mockProviders.mockProvider.defaultResponse = "Parallel task done.";
      mockProviders.mockProvider.latencyMs = 50;

      const tasks: TaskRequest[] = [
        createTask({ target: "parallel-1", description: "Task A" }),
        createTask({ target: "parallel-2", description: "Task B" }),
        createTask({ target: "parallel-3", description: "Task C" }),
      ];

      const start = Date.now();
      const results = await executor.executePipeline(tasks);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.status).toBe("success"));

      // Parallel execution should be faster than sequential (3 * 50ms = 150ms)
      // With parallelism, should be closer to 50-80ms
      expect(elapsed).toBeLessThan(200);
    });

    it("should handle mixed success/failure in pipeline", async () => {
      const goodAgent = createTestAgent({ id: "good-agent" });
      const badAgent = createTestAgent({ id: "bad-agent" });
      registry.register(goodAgent);
      registry.register(badAgent);

      mockProviders.mockProvider.responses.set("Good task", "Success!");

      const tasks: TaskRequest[] = [
        createTask({ target: "good-agent", description: "Good task" }),
        createTask({ target: "nonexistent", description: "Bad task" }),
      ];

      const results = await executor.executePipeline(tasks);
      expect(results[0].status).toBe("success");
      expect(results[1].status).toBe("failure");
    });
  });

  // ── Complex SaaS Frontend Scenario ─────────────────────────

  describe("complex scenario: Build SaaS Frontend", () => {
    it("should orchestrate a multi-agent SaaS frontend build", async () => {
      // Register a team of agents
      const architect = createTestAgent({
        id: "system-architect",
        tier: "manager",
        capabilities: ["architecture", "system design", "decomposition"],
        llmRequirement: "sonnet",
      });
      const uiDesigner = createTestAgent({
        id: "ui-designer",
        capabilities: ["ui design", "wireframes", "figma"],
      });
      const reactSpec = createTestAgent({
        id: "react-specialist",
        capabilities: ["react", "typescript", "components"],
      });
      const uxPsych = createTestAgent({
        id: "ux-psychologist",
        capabilities: ["ux review", "accessibility", "user testing"],
      });
      registry.register(architect);
      registry.register(uiDesigner);
      registry.register(reactSpec);
      registry.register(uxPsych);

      // Set up canned responses per agent
      mockProviders.mockProvider.responses.set(
        "Design the dashboard",
        `# Dashboard Wireframes

## Layout
- **Header**: Logo, search bar, user avatar, notifications bell
- **Sidebar**: Navigation with icons — Dashboard, Analytics, Users, Settings, Billing
- **Main Content**: 4-column grid of KPI cards, followed by 2 charts (line + bar)
- **Footer**: Status indicators, version info

## Color Palette
Primary: #6366F1 (Indigo)
Background: #F9FAFB
Cards: #FFFFFF with shadow-sm

## Typography
Headings: Inter 600
Body: Inter 400
Monospace: JetBrains Mono (for data)`,
      );

      mockProviders.mockProvider.responses.set(
        "Implement the SaaS dashboard",
        `# React Implementation

\`\`\`tsx
// Dashboard.tsx
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

Components created: Dashboard, Sidebar, Header, KPIGrid, KPICard, LineChart, BarChart`,
      );

      mockProviders.mockProvider.responses.set(
        "Review the SaaS frontend",
        `# UX Review Report

## Score: 87/100

### Strengths
- Clean visual hierarchy
- Consistent spacing and typography
- Good use of color for data visualization

### Issues Found
1. **A11Y**: KPI cards missing aria-labels (Priority: High)
2. **Mobile**: Sidebar doesn't collapse on small screens (Priority: Medium)
3. **Performance**: Charts should use lazy loading (Priority: Low)

### Recommendations
- Add keyboard navigation for sidebar
- Implement skeleton loading states
- Add dark mode toggle

**Overall**: Ready for staging with the High priority fix applied.`,
      );

      // Execute as a 3-step workflow
      const workflow: TaskRequest[] = [
        createTask({
          id: "saas-step-1",
          target: "ui-designer",
          description:
            "Design the dashboard wireframes for a SaaS analytics platform with KPIs, charts, and navigation",
          priority: 4,
          context: {
            product: "SaaS Analytics Platform",
            users: "B2B SaaS operators",
            techStack: ["React", "TypeScript", "TailwindCSS", "React Query"],
          },
        }),
        createTask({
          id: "saas-step-2",
          target: "react-specialist",
          description:
            "Implement the SaaS dashboard components in React with TypeScript based on the design wireframes",
          priority: 4,
          context: {
            framework: "React 18",
            styling: "TailwindCSS",
            stateManagement: "React Query + Zustand",
          },
        }),
        createTask({
          id: "saas-step-3",
          target: "ux-psychologist",
          description:
            "Review the SaaS frontend implementation for UX quality, accessibility, and performance",
          priority: 3,
          context: {
            standards: ["WCAG 2.1 AA", "Core Web Vitals"],
          },
        }),
      ];

      const results = await executor.executeWorkflow(workflow);

      // All 3 steps should succeed
      expect(results).toHaveLength(3);
      expect(results[0].status).toBe("success");
      expect(results[1].status).toBe("success");
      expect(results[2].status).toBe("success");

      // Step 1: Design output
      expect(results[0].output).toContain("Wireframes");
      expect(results[0].executor).toBe("ui-designer");

      // Step 2: React implementation
      expect(results[1].output).toContain("Dashboard");
      expect(results[1].executor).toBe("react-specialist");

      // Step 3: UX review
      expect(results[2].output).toContain("UX Review");
      expect(results[2].executor).toBe("ux-psychologist");

      // Context threading: step 2 should have received step 1's output
      const step2Prompt = mockProviders.mockProvider.callLog[1].prompt;
      expect(step2Prompt).toContain("previousResult");

      // Verify metrics
      const metrics = executor.getMetrics();
      expect(metrics.totalTasks).toBe(3);
      expect(metrics.successful).toBe(3);
      expect(metrics.failed).toBe(0);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });
  });

  // ── Metrics & Introspection ────────────────────────────────

  describe("metrics and introspection", () => {
    it("should track execution metrics", async () => {
      const agent = createTestAgent({ id: "metrics-agent" });
      registry.register(agent);
      mockProviders.mockProvider.defaultResponse = "Done.";

      await executor.execute(createTask({ target: "metrics-agent" }));
      await executor.execute(createTask({ target: "metrics-agent" }));

      const metrics = executor.getMetrics();
      expect(metrics.totalTasks).toBe(2);
      expect(metrics.successful).toBe(2);
      expect(metrics.totalTokens).toBeGreaterThan(0);
      expect(metrics.averageLatency).toBeGreaterThan(0);
    });

    it("should maintain execution history", async () => {
      const agent = createTestAgent({ id: "history-agent" });
      registry.register(agent);
      mockProviders.mockProvider.defaultResponse = "Done.";

      await executor.execute(
        createTask({ target: "history-agent", id: "task-1" }),
      );
      await executor.execute(
        createTask({ target: "history-agent", id: "task-2" }),
      );

      const history = executor.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].requestId).toBe("task-1");
      expect(history[1].requestId).toBe("task-2");
    });

    it("should be resettable", async () => {
      const agent = createTestAgent({ id: "reset-agent" });
      registry.register(agent);
      mockProviders.mockProvider.defaultResponse = "Done.";

      await executor.execute(createTask({ target: "reset-agent" }));
      expect(executor.getMetrics().totalTasks).toBe(1);

      executor.reset();
      expect(executor.getMetrics().totalTasks).toBe(0);
      expect(executor.getHistory()).toHaveLength(0);
    });

    it("should allow runtime option updates", () => {
      expect(executor.getOptions().maxDepth).toBe(3);
      executor.updateOptions({ maxDepth: 5 });
      expect(executor.getOptions().maxDepth).toBe(5);
    });
  });

  // ── Budget & Error Handling ────────────────────────────────

  describe("budget and error handling", () => {
    it("should handle provider budget exceeded errors", async () => {
      const agent = createTestAgent({ id: "budget-agent" });
      registry.register(agent);

      mockProviders.mockProvider.shouldFail = true;
      mockProviders.mockProvider.failMessage = "Token budget exceeded";

      const task = createTask({ target: "budget-agent" });
      const result = await executor.execute(task);

      expect(result.status).toBe("failure");
      expect((result.output as any).error).toContain("budget exceeded");
    });

    it("should handle agent status updates during execution", async () => {
      const agent = createTestAgent({ id: "status-agent" });
      registry.register(agent);
      mockProviders.mockProvider.defaultResponse = "Done.";

      // Agent should be "idle" before
      expect(registry.get("status-agent")?.status).toBe("idle");

      await executor.execute(createTask({ target: "status-agent" }));

      // Agent should be back to "idle" after
      expect(registry.get("status-agent")?.status).toBe("idle");
    });
  });
});
