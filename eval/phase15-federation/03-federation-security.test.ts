// Phase 15.03: Federation Security Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest("15.03.1", "Security — server with auth token rejects unauthenticated", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const server = new AetherLinkServer(9991);
    server.setAuthToken("secret-federation-key");
    await server.start();

    try {
      // Connect without auth token
      const ws = new WebSocket("ws://localhost:9991?agentId=test&channel=test");
      const result = await new Promise<string>((resolve) => {
        ws.onclose = (e) => resolve(`closed:${e.code}`);
        ws.onerror = () => resolve("error");
        ws.onopen = () => resolve("connected");
        setTimeout(() => resolve("timeout"), 3000);
      });
      ws.close();

      // Server should reject or close the connection
      const rejected = result.includes("closed") || result === "error";
      return {
        score: rejected ? 10 : 0,
        maxScore: 10,
        details: `unauthenticated result: ${result}`,
      };
    } finally {
      await server.stop();
    }
  });

  await harness.runTest("15.03.2", "Security — server with auth token accepts authenticated", async () => {
    const { AetherLinkServer } = await import(join(ROOT, "protocol/server.ts"));
    const server = new AetherLinkServer(9992);
    server.setAuthToken("secret-federation-key");
    await server.start();

    try {
      const ws = new WebSocket("ws://localhost:9992?agentId=test&channel=test&token=secret-federation-key");
      const result = await new Promise<string>((resolve) => {
        ws.onopen = () => resolve("connected");
        ws.onclose = (e) => resolve(`closed:${e.code}`);
        ws.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 3000);
      });
      ws.close();
      await new Promise(r => setTimeout(r, 100));

      return {
        score: result === "connected" ? 10 : 0,
        maxScore: 10,
        details: `authenticated result: ${result}`,
      };
    } finally {
      await server.stop();
    }
  });

  await harness.runTest("15.03.3", "Security — BAPCodec rejects tampered message", async () => {
    const { BAPCodec } = await import(join(ROOT, "protocol/codec.ts"));
    // Encode a valid message, then tamper with the buffer
    const msg = { type: "task", from: "a", to: "b", payload: { test: true } };
    const encoded = BAPCodec.encode(msg as any);
    // Tamper: flip random bytes in the middle
    const tampered = Buffer.from(encoded);
    for (let i = 4; i < Math.min(tampered.length, 20); i++) {
      tampered[i] = tampered[i] ^ 0xFF;
    }
    let threw = false;
    try {
      BAPCodec.decode(tampered);
    } catch {
      threw = true;
    }
    return {
      score: threw ? 10 : 0,
      maxScore: 10,
      details: `tampered buffer rejected: ${threw}`,
    };
  });
}
