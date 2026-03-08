// Phase 11.05: WebSocket Roundtrip Integration Test
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("11.05.1", "WebSocket — server starts and /health responds", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const server = new AetherLinkServer(9987);
    await server.start();

    try {
      const resp = await fetch("http://localhost:9987/health");
      const ok = resp.status === 200;
      const body = await resp.json();
      return {
        score: ok && body.status ? 10 : ok ? 7 : 0,
        maxScore: 10,
        details: `status=${resp.status} body.status=${body.status}`,
      };
    } finally {
      await server.stop();
    }
  });

  await harness.runTest("11.05.2", "WebSocket — client connects", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const server = new AetherLinkServer(9988);
    await server.start();

    try {
      const ws = new WebSocket("ws://localhost:9988?agentId=test-agent&channel=test");
      const connected = await new Promise<boolean>((resolve) => {
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 3000);
      });
      ws.close();
      await new Promise(r => setTimeout(r, 100));
      return {
        score: connected ? 10 : 0,
        maxScore: 10,
        details: `connected=${connected}`,
      };
    } finally {
      await server.stop();
    }
  });

  await harness.runTest("11.05.3", "WebSocket — /registry endpoint responds", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const server = new AetherLinkServer(9989);
    const registryMap = new Map<string, unknown>();
    registryMap.set("ws-test-agent", { id: "ws-test-agent", name: "WS Test", tier: "worker" });
    server.setRegistry(registryMap);
    await server.start();

    try {
      const resp = await fetch("http://localhost:9989/registry");
      const ok = resp.status === 200;
      const body = await resp.text();
      const hasAgent = body.includes("ws-test-agent");
      return {
        score: ok && hasAgent ? 10 : ok ? 7 : 0,
        maxScore: 10,
        details: `status=${resp.status} containsAgent=${hasAgent}`,
      };
    } finally {
      await server.stop();
    }
  });
}
