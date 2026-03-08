// Phase 15.01: Federation Transport Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "15.01.1",
    "Federation — transport construction",
    async () => {
      const { FederationTransport } = await import(
        join(ROOT, "transports/federation.ts")
      );
      const transport = new FederationTransport();
      return {
        score: transport != null ? 10 : 0,
        maxScore: 10,
        details: `FederationTransport created successfully`,
      };
    },
  );

  await harness.runTest(
    "15.01.2",
    "Federation — healthCheck against running server",
    async () => {
      const { AetherLinkServer } = await import(
        join(ROOT, "protocol/server.ts")
      );
      const { FederationTransport } = await import(
        join(ROOT, "transports/federation.ts")
      );
      const server = new AetherLinkServer(9980);
      await server.start();

      try {
        const transport = new FederationTransport();
        const health = await transport.healthCheck({
          instanceUrl: "ws://localhost:9980",
        } as any);
        return {
          score: health.healthy ? 10 : health.latencyMs != null ? 7 : 0,
          maxScore: 10,
          details: `healthy=${health.healthy} latency=${health.latencyMs}ms`,
        };
      } finally {
        await server.stop();
      }
    },
  );

  await harness.runTest(
    "15.01.3",
    "Federation — connect to server",
    async () => {
      const { AetherLinkServer } = await import(
        join(ROOT, "protocol/server.ts")
      );
      const { FederationTransport } = await import(
        join(ROOT, "transports/federation.ts")
      );
      const server = new AetherLinkServer(9981);
      await server.start();

      try {
        const transport = new FederationTransport();
        await transport.connect({
          instanceUrl: "ws://localhost:9981",
          timeout: 5000,
        } as any);
        const connected = true;
        await transport.disconnect();
        return {
          score: connected ? 10 : 0,
          maxScore: 10,
          details: `connected and disconnected successfully`,
        };
      } catch (err: any) {
        return {
          score: 0,
          maxScore: 10,
          details: `connect failed: ${err.message}`,
        };
      } finally {
        await server.stop();
      }
    },
  );

  await harness.runTest(
    "15.01.4",
    "Federation — timeout on unreachable server",
    async () => {
      const { FederationTransport } = await import(
        join(ROOT, "transports/federation.ts")
      );
      const transport = new FederationTransport();
      const start = Date.now();
      try {
        await transport.connect({
          instanceUrl: "ws://localhost:59999",
          timeout: 2000,
        } as any);
        return { score: 0, maxScore: 10, details: "should have timed out" };
      } catch {
        const elapsed = Date.now() - start;
        return {
          score: elapsed < 5000 ? 10 : 7,
          maxScore: 10,
          details: `timed out in ${elapsed}ms`,
        };
      }
    },
  );
}
