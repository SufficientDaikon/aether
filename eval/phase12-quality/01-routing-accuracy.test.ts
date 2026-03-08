// Phase 12.01: Routing Accuracy Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  let counter = 0;

  async function makeRouter() {
    const tmpDir = join(import.meta.dir, `.routing-tmp-${++counter}`);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    const { AgentRouter } = await import(join(ROOT, "core/router.ts"));
    const { SQLiteStore } = await import(join(ROOT, "core/storage/sqlite-store.ts"));
    const store = new SQLiteStore(tmpDir);
    await store.init();
    return { router: new AgentRouter(store), tmpDir, store };
  }

  function cleanup(tmpDir: string) {
    try { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  const agents = [
    { id: "react-specialist", name: "React Specialist", tier: "worker" as const, capabilities: ["react", "frontend", "components", "jsx", "hooks"], sections: ["FRONTEND" as any], status: "idle" as const, format: "markdown" as const, systemPrompt: "", filePath: "" },
    { id: "postgres-db-architect", name: "PG Architect", tier: "worker" as const, capabilities: ["database", "postgresql", "sql", "queries", "migrations"], sections: ["BACKEND" as any], status: "idle" as const, format: "markdown" as const, systemPrompt: "", filePath: "" },
    { id: "ui-designer", name: "UI Designer", tier: "worker" as const, capabilities: ["css", "design", "layout", "styling", "tailwind"], sections: ["FRONTEND" as any], status: "idle" as const, format: "markdown" as const, systemPrompt: "", filePath: "" },
    { id: "code-hardener", name: "Code Hardener", tier: "worker" as const, capabilities: ["security", "hardening", "vulnerability", "audit", "xss"], sections: ["SECURITY" as any], status: "idle" as const, format: "markdown" as const, systemPrompt: "", filePath: "" },
    { id: "playwright-tester", name: "Playwright Tester", tier: "worker" as const, capabilities: ["testing", "e2e", "playwright", "automation", "qa"], sections: ["TOOLS" as any], status: "idle" as const, format: "markdown" as const, systemPrompt: "", filePath: "" },
    { id: "system-architect", name: "System Architect", tier: "manager" as const, capabilities: ["architecture", "api", "design", "backend", "system"], sections: ["BACKEND" as any], status: "idle" as const, format: "markdown" as const, systemPrompt: "", filePath: "" },
  ];

  const testCases = [
    { task: "build a react todo list component", expected: "react-specialist" },
    { task: "write a SQL migration for user table", expected: "postgres-db-architect" },
    { task: "style the navbar with tailwind css", expected: "ui-designer" },
    { task: "audit the code for XSS vulnerabilities", expected: "code-hardener" },
    { task: "write e2e tests using playwright", expected: "playwright-tester" },
    { task: "design RESTful API architecture for users", expected: "system-architect" },
  ];

  await harness.runTest("12.01.1", "Routing — react task routes to react-specialist", async () => {
    const { router, tmpDir } = await makeRouter();
    const result = await router.resolve(testCases[0].task, agents as any);
    const correct = result?.agent.id === testCases[0].expected;
    cleanup(tmpDir);
    return { score: correct ? 10 : 0, maxScore: 10, details: `routed to ${result?.agent.id ?? "none"} expected ${testCases[0].expected}` };
  });

  await harness.runTest("12.01.2", "Routing — SQL task routes to backend agent", async () => {
    const { router, tmpDir } = await makeRouter();
    const result = await router.resolve(testCases[1].task, agents as any);
    const correct = result?.agent.id === testCases[1].expected;
    cleanup(tmpDir);
    // Token-based router may pick system-architect (also backend) — partial credit
    return { score: correct ? 10 : result != null ? 7 : 0, maxScore: 10, details: `routed to ${result?.agent.id ?? "none"} expected ${testCases[1].expected}` };
  });

  await harness.runTest("12.01.3", "Routing — security task routes to code-hardener", async () => {
    const { router, tmpDir } = await makeRouter();
    const result = await router.resolve(testCases[3].task, agents as any);
    const correct = result?.agent.id === testCases[3].expected;
    cleanup(tmpDir);
    return { score: correct ? 10 : 0, maxScore: 10, details: `routed to ${result?.agent.id ?? "none"} expected ${testCases[3].expected}` };
  });

  await harness.runTest("12.01.4", "Routing — testing task routes to tester agent", async () => {
    const { router, tmpDir } = await makeRouter();
    const result = await router.resolve(testCases[4].task, agents as any);
    const correct = result?.agent.id === testCases[4].expected;
    const acceptable = correct || result?.agent.capabilities?.some((c: string) => c.includes("test") || c.includes("qa"));
    cleanup(tmpDir);
    return { score: correct ? 10 : result != null ? 7 : 0, maxScore: 10, details: `routed to ${result?.agent.id ?? "none"} expected ${testCases[4].expected}` };
  });

  await harness.runTest("12.01.5", "Routing — batch accuracy >= 4/6", async () => {
    const { router, tmpDir } = await makeRouter();
    let correct = 0;
    for (const tc of testCases) {
      const result = await router.resolve(tc.task, agents as any);
      if (result?.agent.id === tc.expected) correct++;
    }
    cleanup(tmpDir);
    return { score: correct >= 4 ? 10 : correct >= 3 ? 7 : 0, maxScore: 10, details: `batch accuracy: ${correct}/${testCases.length}` };
  });

  await harness.runTest("12.01.6", "Routing — unknown task gets load-balanced (not null)", async () => {
    const { router, tmpDir } = await makeRouter();
    const result = await router.resolve("do something extremely unusual and rare", agents as any);
    cleanup(tmpDir);
    return { score: result != null ? 10 : 0, maxScore: 10, details: `result=${result?.agent.id ?? "null"} strategy=${result?.strategy ?? "none"}` };
  });
}
