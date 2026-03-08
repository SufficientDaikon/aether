// -----------------------------------------------------------------
// AETHER Eval -- Phase 3: WebSocket Server Tests
// Tests AetherLinkServer HTTP endpoints, WS connect, broadcast, shutdown
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  const TEST_PORT = 19999;

  // -- Test 3.2.1: Server start + HTTP endpoints (/health, /status, /registry)
  await harness.runTest(
    "3.2.1",
    "AetherLinkServer -- HTTP endpoints /health, /status, /registry",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      let server: any = null;

      try {
        const { AetherLinkServer } = await import("../../protocol/server.ts");
        server = new AetherLinkServer(TEST_PORT, ".aether/logs/eval-phase3");
        await server.start();
        details.push(`Server started on port ${TEST_PORT}`);
        score += 2;

        // GET /health
        try {
          const healthResp = await fetch(
            `http://localhost:${TEST_PORT}/health`,
          );
          if (healthResp.ok) {
            const healthBody = await healthResp.json();
            if (healthBody && typeof healthBody === "object") {
              details.push(
                `/health returned ${healthResp.status}: ${JSON.stringify(healthBody)}`,
              );
              score += 2;
            } else {
              details.push("/health returned non-object body");
              score += 1;
            }
          } else {
            details.push(`/health returned status ${healthResp.status}`);
          }
        } catch (e) {
          details.push(
            `/health fetch error: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        // GET /status
        try {
          const statusResp = await fetch(
            `http://localhost:${TEST_PORT}/status`,
          );
          if (statusResp.ok) {
            const statusBody = (await statusResp.json()) as Record<
              string,
              unknown
            >;
            if (
              typeof statusBody.connectedAgents === "number" &&
              typeof statusBody.messageCount === "number" &&
              typeof statusBody.uptimeMs === "number"
            ) {
              details.push(
                `/status returned valid metrics: agents=${statusBody.connectedAgents}, msgs=${statusBody.messageCount}`,
              );
              score += 3;
            } else {
              details.push(
                `/status returned unexpected shape: ${JSON.stringify(statusBody).slice(0, 200)}`,
              );
              score += 1;
            }
          } else {
            details.push(`/status returned status ${statusResp.status}`);
          }
        } catch (e) {
          details.push(
            `/status fetch error: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        // GET /registry
        try {
          const regResp = await fetch(`http://localhost:${TEST_PORT}/registry`);
          if (regResp.ok) {
            const regBody = await regResp.json();
            details.push(
              `/registry returned ${regResp.status}: ${JSON.stringify(regBody).slice(0, 120)}`,
            );
            score += 3;
          } else {
            details.push(`/registry returned status ${regResp.status}`);
          }
        } catch (e) {
          details.push(
            `/registry fetch error: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (server) {
          try {
            await server.stop();
            details.push("Server stopped cleanly (3.2.1)");
          } catch {}
        }
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.2.2: WebSocket client connect + register message -------------
  await harness.runTest(
    "3.2.2",
    "AetherLinkServer -- WebSocket connect and register",
    async () => {
      let score = 0;
      const maxScore = 8;
      const details: string[] = [];
      let server: any = null;
      let ws: WebSocket | null = null;

      try {
        const { AetherLinkServer } = await import("../../protocol/server.ts");
        const { BAPCodec } = await import("../../protocol/codec.ts");

        server = new AetherLinkServer(TEST_PORT, ".aether/logs/eval-phase3");
        await server.start();
        details.push("Server started");
        score += 1;

        // Connect a WebSocket client
        const wsUrl = `ws://localhost:${TEST_PORT}?agentId=eval-agent-01&channel=/eval/test`;

        const connectResult = await new Promise<{
          connected: boolean;
          error?: string;
        }>((resolve) => {
          const timeout = setTimeout(
            () => resolve({ connected: false, error: "Connection timed out" }),
            5000,
          );
          ws = new WebSocket(wsUrl);
          ws.onopen = () => {
            clearTimeout(timeout);
            resolve({ connected: true });
          };
          ws.onerror = (ev: any) => {
            clearTimeout(timeout);
            resolve({
              connected: false,
              error: ev?.message ?? "WebSocket error",
            });
          };
        });

        if (connectResult.connected) {
          details.push("WebSocket connected successfully");
          score += 2;
        } else {
          details.push(`WebSocket failed to connect: ${connectResult.error}`);
          return { score, maxScore, details: details.join("; ") };
        }

        // Verify server tracks the agent
        const agents = server.getConnectedAgents();
        if (Array.isArray(agents) && agents.includes("eval-agent-01")) {
          details.push("Server tracks connected agent");
          score += 2;
        } else {
          details.push(`Connected agents: ${JSON.stringify(agents)}`);
        }

        // Send a register message via BAP-02
        const registerMsg = BAPCodec.createMessage(
          "eval-agent-01",
          "*",
          "register",
          { capabilities: ["eval", "test"] },
          3,
        );
        const encoded = BAPCodec.encode(registerMsg);

        // Wait for message to be processed
        const sendResult = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 3000);
          try {
            ws!.send(encoded);
            // Give server a moment to process
            setTimeout(() => {
              clearTimeout(timeout);
              resolve(true);
            }, 200);
          } catch {
            clearTimeout(timeout);
            resolve(false);
          }
        });

        if (sendResult) {
          details.push("Register message sent successfully");
          score += 2;
        } else {
          details.push("Failed to send register message");
        }

        // Check metrics show the message was counted
        const metrics = server.getMetrics();
        if (metrics.messageCount >= 1) {
          details.push(`Server processed ${metrics.messageCount} message(s)`);
          score += 1;
        } else {
          details.push("Server did not count the message");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (ws) {
          try {
            (ws as WebSocket).close();
          } catch {}
        }
        if (server) {
          try {
            await server.stop();
            details.push("Server stopped cleanly (3.2.2)");
          } catch {}
        }
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.2.3: Broadcast to channel ------------------------------------
  await harness.runTest(
    "3.2.3",
    "AetherLinkServer -- Broadcast to channel",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];
      let server: any = null;
      let ws1: WebSocket | null = null;
      let ws2: WebSocket | null = null;

      try {
        const { AetherLinkServer } = await import("../../protocol/server.ts");
        const { BAPCodec } = await import("../../protocol/codec.ts");

        server = new AetherLinkServer(TEST_PORT, ".aether/logs/eval-phase3");
        await server.start();
        score += 1;

        const channel = "/eval/broadcast-test";

        // Helper to connect a WS client
        const connectWS = (agentId: string): Promise<WebSocket> =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Connection timed out")),
              5000,
            );
            const socket = new WebSocket(
              `ws://localhost:${TEST_PORT}?agentId=${agentId}&channel=${encodeURIComponent(channel)}`,
            );
            socket.onopen = () => {
              clearTimeout(timeout);
              resolve(socket);
            };
            socket.onerror = (ev: any) => {
              clearTimeout(timeout);
              reject(new Error(ev?.message ?? "WebSocket error"));
            };
          });

        ws1 = await connectWS("bcast-agent-1");
        ws2 = await connectWS("bcast-agent-2");
        details.push("Two clients connected to same channel");
        score += 1;

        // Listen for a message on ws2
        const receivedPromise = new Promise<Uint8Array | null>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 4000);
          ws2!.onmessage = (ev: MessageEvent) => {
            clearTimeout(timeout);
            if (ev.data instanceof ArrayBuffer) {
              resolve(new Uint8Array(ev.data));
            } else if (ev.data instanceof Blob) {
              ev.data
                .arrayBuffer()
                .then((buf: ArrayBuffer) => resolve(new Uint8Array(buf)));
            } else {
              resolve(null);
            }
          };
        });

        // ws1 sends a broadcast ("to" = "*")
        const broadcastMsg = BAPCodec.createMessage(
          "bcast-agent-1",
          "*",
          "broadcast",
          { content: "hello everyone" },
          3,
        );
        const encoded = BAPCodec.encode(broadcastMsg);
        ws1.send(encoded);
        details.push("Broadcast sent from bcast-agent-1");
        score += 1;

        // Wait for ws2 to receive
        const received = await receivedPromise;
        if (received && received.byteLength > 0) {
          try {
            const decoded = BAPCodec.decode(received);
            if (
              decoded.from === "bcast-agent-1" &&
              decoded.type === "broadcast"
            ) {
              details.push(
                "bcast-agent-2 received broadcast message correctly",
              );
              score += 3;
            } else {
              details.push(
                `Received unexpected message: from=${decoded.from}, type=${decoded.type}`,
              );
              score += 1;
            }
          } catch (e) {
            details.push(
              `Failed to decode received broadcast: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          details.push(
            "bcast-agent-2 did not receive broadcast within timeout",
          );
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (ws1)
          try {
            ws1.close();
          } catch {}
        if (ws2)
          try {
            ws2.close();
          } catch {}
        if (server) {
          try {
            await server.stop();
            details.push("Server stopped cleanly (3.2.3)");
          } catch {}
        }
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.2.4: Shutdown cleanly ----------------------------------------
  await harness.runTest(
    "3.2.4",
    "AetherLinkServer -- Clean shutdown",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { AetherLinkServer } = await import("../../protocol/server.ts");

        const server = new AetherLinkServer(
          TEST_PORT,
          ".aether/logs/eval-phase3",
        );
        await server.start();
        details.push("Server started for shutdown test");
        score += 1;

        // Connect a client
        const ws: WebSocket = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Connection timed out")),
            5000,
          );
          const socket = new WebSocket(
            `ws://localhost:${TEST_PORT}?agentId=shutdown-agent&channel=/eval/shutdown`,
          );
          socket.onopen = () => {
            clearTimeout(timeout);
            resolve(socket);
          };
          socket.onerror = (ev: any) => {
            clearTimeout(timeout);
            reject(new Error(ev?.message ?? "error"));
          };
        });
        details.push("Client connected");
        score += 1;

        // Track close event on client
        const closePromise = new Promise<{ code: number; reason: string }>(
          (resolve) => {
            const timeout = setTimeout(
              () => resolve({ code: -1, reason: "timeout" }),
              5000,
            );
            ws.onclose = (ev: CloseEvent) => {
              clearTimeout(timeout);
              resolve({ code: ev.code, reason: ev.reason });
            };
          },
        );

        // Stop the server
        await server.stop();
        details.push("server.stop() returned");
        score += 2;

        // The WS client should have been closed
        const closeResult = await closePromise;
        if (closeResult.code !== -1) {
          details.push(
            `Client received close: code=${closeResult.code}, reason="${closeResult.reason}"`,
          );
          score += 1;
        } else {
          details.push("Client did not receive close event within timeout");
        }

        // After stop, getConnectedAgents should return empty
        const agents = server.getConnectedAgents();
        if (Array.isArray(agents) && agents.length === 0) {
          details.push("No agents connected after shutdown");
          score += 1;
        } else {
          details.push(
            `Agents still present after shutdown: ${JSON.stringify(agents)}`,
          );
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );
}
