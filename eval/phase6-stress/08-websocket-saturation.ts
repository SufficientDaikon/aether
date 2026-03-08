// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: WebSocket Saturation Stress Test
// Start server on port 29999, connect 20 clients, each sends 50
// messages. Measure throughput, check for dropped messages.
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.8",
    "AetherLinkServer -- 20 clients x 50 messages saturation test",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      let server: any = null;
      const clients: WebSocket[] = [];
      const TEST_PORT = 29999;
      const CLIENT_COUNT = 20;
      const MESSAGES_PER_CLIENT = 50;
      const TOTAL_EXPECTED = CLIENT_COUNT * MESSAGES_PER_CLIENT;
      const TIMEOUT_MS = 30_000;

      try {
        const { AetherLinkServer } = await import("../../protocol/server.ts");
        const { BAPCodec } = await import("../../protocol/codec.ts");

        server = new AetherLinkServer(TEST_PORT, ".aether/logs/eval-phase6-ws");
        await server.start();
        details.push(`Server started on port ${TEST_PORT}`);
        score += 1;

        // Helper to connect a WebSocket client with timeout
        const connectClient = (
          agentId: string,
          channel: string,
        ): Promise<WebSocket> =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error(`Connection timed out for ${agentId}`)),
              5000,
            );
            const ws = new WebSocket(
              `ws://localhost:${TEST_PORT}?agentId=${agentId}&channel=${encodeURIComponent(channel)}`,
            );
            ws.onopen = () => {
              clearTimeout(timeout);
              resolve(ws);
            };
            ws.onerror = (ev: any) => {
              clearTimeout(timeout);
              reject(
                new Error(
                  `Connection failed for ${agentId}: ${ev?.message ?? "unknown"}`,
                ),
              );
            };
          });

        // Connect 20 clients across 4 channels
        const channels = [
          "/stress/ch-0",
          "/stress/ch-1",
          "/stress/ch-2",
          "/stress/ch-3",
        ];

        for (let i = 0; i < CLIENT_COUNT; i++) {
          try {
            const channel = channels[i % channels.length];
            const ws = await connectClient(`stress-agent-${i}`, channel);
            clients.push(ws);
          } catch (err) {
            details.push(
              `Client ${i} connection failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const connectedCount = clients.length;
        details.push(`${connectedCount}/${CLIENT_COUNT} clients connected`);

        if (connectedCount < CLIENT_COUNT * 0.8) {
          details.push("Too few clients connected, aborting saturation");
          return {
            score,
            maxScore,
            details: details.join("; "),
            metadata: { test: "websocket-saturation" },
          };
        }
        score += 2;

        // Track messages received by each client
        const receivedCounts = new Map<number, number>();
        for (let i = 0; i < clients.length; i++) {
          receivedCounts.set(i, 0);
          clients[i].onmessage = () => {
            receivedCounts.set(i, (receivedCounts.get(i) ?? 0) + 1);
          };
        }

        // Each client sends 50 broadcast messages
        const startTime = performance.now();

        const sendPromises: Promise<void>[] = [];
        for (let i = 0; i < clients.length; i++) {
          const ws = clients[i];
          sendPromises.push(
            (async () => {
              for (let m = 0; m < MESSAGES_PER_CLIENT; m++) {
                try {
                  const msg = BAPCodec.createMessage(
                    `stress-agent-${i}`,
                    "*",
                    "broadcast",
                    { clientIdx: i, msgIdx: m },
                    3,
                  );
                  const encoded = BAPCodec.encode(msg);
                  ws.send(encoded);
                } catch {
                  // Send may fail if socket is closing
                }
                // Small yield to prevent overwhelming the event loop
                if (m % 10 === 0) {
                  await new Promise((r) => setTimeout(r, 1));
                }
              }
            })(),
          );
        }

        await Promise.race([
          Promise.all(sendPromises),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Send phase timed out")),
              TIMEOUT_MS,
            ),
          ),
        ]);

        // Wait a short time for message delivery to settle
        await new Promise((r) => setTimeout(r, 2000));

        const elapsed = performance.now() - startTime;

        // Check server metrics
        const metrics = server.getMetrics();
        const totalSent = connectedCount * MESSAGES_PER_CLIENT;

        details.push(`Sent ${totalSent} messages in ${elapsed.toFixed(0)}ms`);
        details.push(`Server processed ${metrics.messageCount} messages`);

        // Score based on server processing
        if (metrics.messageCount >= totalSent * 0.9) {
          score += 3;
          details.push(
            `Server processed >= 90% of messages (${metrics.messageCount}/${totalSent})`,
          );
        } else if (metrics.messageCount >= totalSent * 0.5) {
          score += 2;
          details.push(
            `Server processed >= 50% of messages (${metrics.messageCount}/${totalSent})`,
          );
        } else if (metrics.messageCount > 0) {
          score += 1;
          details.push(
            `Server processed some messages (${metrics.messageCount}/${totalSent})`,
          );
        } else {
          details.push("Server processed zero messages");
        }

        // Check throughput
        const msgsPerSec =
          elapsed > 0 ? Math.round((metrics.messageCount / elapsed) * 1000) : 0;
        details.push(`Throughput: ~${msgsPerSec} msg/sec`);

        if (msgsPerSec > 100) {
          score += 2;
          details.push("Good throughput (>100 msg/sec)");
        } else if (msgsPerSec > 10) {
          score += 1;
          details.push("Moderate throughput");
        }

        // Check that connected agents count is still correct
        const connectedAgents = server.getConnectedAgents();
        if (connectedAgents.length >= connectedCount * 0.8) {
          score += 1;
          details.push(
            `${connectedAgents.length} agents still connected after saturation`,
          );
        } else {
          details.push(
            `Only ${connectedAgents.length}/${connectedCount} agents still connected`,
          );
        }

        // Check channel distribution
        const channelMetrics = metrics.channels;
        if (channelMetrics && Object.keys(channelMetrics).length > 0) {
          score += 1;
          details.push(`Active channels: ${JSON.stringify(channelMetrics)}`);
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        // Close all clients first
        for (const ws of clients) {
          try {
            ws.close(1000, "Test complete");
          } catch {}
        }

        // Small delay for close to propagate
        await new Promise((r) => setTimeout(r, 500));

        // Then stop the server
        if (server) {
          try {
            await server.stop();
            details.push("Server stopped cleanly");
          } catch (err) {
            details.push(
              `Server stop error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      return {
        score,
        maxScore,
        details: details.join("; "),
        metadata: { test: "websocket-saturation" },
      };
    },
  );
}
