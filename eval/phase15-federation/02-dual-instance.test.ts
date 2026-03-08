// Phase 15.02: Dual Instance Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("15.02.1", "Dual — two servers start on different ports", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const serverA = new AetherLinkServer(9982);
    const serverB = new AetherLinkServer(9983);
    await serverA.start();
    await serverB.start();

    try {
      const healthA = await fetch("http://localhost:9982/health").then(r => r.json());
      const healthB = await fetch("http://localhost:9983/health").then(r => r.json());
      return {
        score: healthA.status && healthB.status ? 10 : 0,
        maxScore: 10,
        details: `serverA=${healthA.status} serverB=${healthB.status}`,
      };
    } finally {
      await serverA.stop();
      await serverB.stop();
    }
  });

  await harness.runTest("15.02.2", "Dual — WebSocket connects to both servers", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const serverA = new AetherLinkServer(9984);
    const serverB = new AetherLinkServer(9985);
    await serverA.start();
    await serverB.start();

    try {
      const wsA = new WebSocket("ws://localhost:9984?agentId=fedA&channel=test");
      const wsB = new WebSocket("ws://localhost:9985?agentId=fedB&channel=test");

      const connA = await new Promise<boolean>(r => { wsA.onopen = () => r(true); wsA.onerror = () => r(false); setTimeout(() => r(false), 3000); });
      const connB = await new Promise<boolean>(r => { wsB.onopen = () => r(true); wsB.onerror = () => r(false); setTimeout(() => r(false), 3000); });

      wsA.close();
      wsB.close();
      await new Promise(r => setTimeout(r, 100));

      return {
        score: connA && connB ? 10 : connA || connB ? 5 : 0,
        maxScore: 10,
        details: `connA=${connA} connB=${connB}`,
      };
    } finally {
      await serverA.stop();
      await serverB.stop();
    }
  });

  await harness.runTest("15.02.3", "Dual — servers report independent metrics", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const serverA = new AetherLinkServer(9986);
    const serverB = new AetherLinkServer(9990);
    await serverA.start();
    await serverB.start();

    try {
      const metricsA = await fetch("http://localhost:9986/metrics").then(r => r.text());
      const metricsB = await fetch("http://localhost:9990/metrics").then(r => r.text());
      const hasMetrics = metricsA.length > 0 && metricsB.length > 0;
      return {
        score: hasMetrics ? 10 : 0,
        maxScore: 10,
        details: `metricsA length=${metricsA.length} metricsB length=${metricsB.length}`,
      };
    } finally {
      await serverA.stop();
      await serverB.stop();
    }
  });
}
