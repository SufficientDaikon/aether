// -----------------------------------------------------------------
// AETHER Eval -- Phase 6: Large Payload Codec Stress Test
// Encode/decode messages with 100KB, 500KB, 1MB payloads
// Measures encode/decode time and compression ratio
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "6.3",
    "BAPCodec -- Large payload encode/decode (100KB, 500KB, 1MB)",
    async () => {
      let score = 0;
      const maxScore = 10;
      const details: string[] = [];
      const TIMEOUT_MS = 30_000;

      try {
        const { BAPCodec } = await import("../../protocol/codec.ts");

        // Generate payload strings of target sizes
        const generatePayload = (sizeBytes: number): string => {
          const chars =
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
          const chunks: string[] = [];
          let totalLen = 0;
          while (totalLen < sizeBytes) {
            const line =
              Array.from(
                { length: 80 },
                () => chars[Math.floor(Math.random() * chars.length)],
              ).join("") + "\n";
            chunks.push(line);
            totalLen += line.length;
          }
          return chunks.join("").slice(0, sizeBytes);
        };

        const sizes = [
          { label: "100KB", bytes: 100 * 1024 },
          { label: "500KB", bytes: 500 * 1024 },
          { label: "1MB", bytes: 1024 * 1024 },
        ];

        let allPassed = true;

        for (const { label, bytes } of sizes) {
          const payloadData = generatePayload(bytes);

          const message = BAPCodec.createMessage(
            "stress-sender",
            "stress-receiver",
            "task",
            { data: payloadData },
            3,
          );

          // Encode
          const encodeStart = performance.now();
          let encoded: Uint8Array;
          try {
            encoded = await Promise.race([
              Promise.resolve(BAPCodec.encode(message)),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Encode ${label} timed out`)),
                  TIMEOUT_MS,
                ),
              ),
            ]);
          } catch (err) {
            details.push(
              `${label} encode failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            allPassed = false;
            continue;
          }
          const encodeMs = performance.now() - encodeStart;

          // Decode
          const decodeStart = performance.now();
          let decoded: any;
          try {
            decoded = await Promise.race([
              Promise.resolve(BAPCodec.decode(encoded)),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Decode ${label} timed out`)),
                  TIMEOUT_MS,
                ),
              ),
            ]);
          } catch (err) {
            details.push(
              `${label} decode failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            allPassed = false;
            continue;
          }
          const decodeMs = performance.now() - decodeStart;

          // Compression ratio
          const rawSize = JSON.stringify(message).length;
          const encodedSize = encoded.byteLength;
          const ratio = (encodedSize / rawSize).toFixed(3);

          details.push(
            `${label}: encode=${encodeMs.toFixed(1)}ms, decode=${decodeMs.toFixed(1)}ms, ratio=${ratio} (${encodedSize}/${rawSize} bytes)`,
          );

          // Verify round-trip correctness
          if (
            decoded &&
            decoded.from === "stress-sender" &&
            decoded.to === "stress-receiver" &&
            decoded.type === "task" &&
            typeof decoded.payload === "object" &&
            (decoded.payload as any).data?.length === bytes
          ) {
            score += 2;
            details.push(`${label} round-trip verified`);
          } else {
            score += 1;
            details.push(`${label} round-trip partial match`);
            allPassed = false;
          }
        }

        // Bonus points for fast encode/decode and good compression
        if (allPassed) {
          score += 2;
          details.push("All payload sizes passed round-trip");
        }

        // Check the efficiency helper too
        try {
          const smallMsg = BAPCodec.createMessage(
            "a",
            "b",
            "task",
            { data: generatePayload(1024) },
            3,
          );
          const eff = BAPCodec.efficiency(smallMsg);
          if (eff.overhead < 1.0) {
            score += 2;
            details.push(
              `Compression wins: overhead=${eff.overhead.toFixed(3)} (${eff.encodedBytes}/${eff.rawBytes})`,
            );
          } else {
            score += 1;
            details.push(
              `No compression benefit: overhead=${eff.overhead.toFixed(3)}`,
            );
          }
        } catch (err) {
          details.push(
            `Efficiency check error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        score,
        maxScore,
        details: details.join("; "),
        metadata: { test: "large-payloads" },
      };
    },
  );
}
