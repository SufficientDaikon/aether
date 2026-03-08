// ─────────────────────────────────────────────────────────────
// Phase 10.03: BAP-02 Codec Performance Benchmarks
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

function makeMsg(content: string) {
  return {
    id: `msg-bench-${Date.now()}`,
    type: "task" as const,
    from: "bench-agent",
    to: "target-agent",
    payload: { content },
    priority: 3,
    timestamp: Date.now(),
  };
}

export async function run(harness: TestHarness): Promise<void> {
  await harness.runTest(
    "10.03.1",
    "BAPCodec — small message 1000 roundtrips",
    async () => {
      const { BAPCodec } = await import(join(ROOT, "protocol/codec.ts"));
      const msg = makeMsg("test");

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const encoded = BAPCodec.encode(msg as any);
        BAPCodec.decode(encoded);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((1000 / elapsed) * 1000);

      return {
        score:
          opsPerSec > 10000
            ? 10
            : opsPerSec > 5000
              ? 7
              : opsPerSec > 1000
                ? 4
                : 0,
        maxScore: 10,
        details: `${opsPerSec} roundtrips/sec (${elapsed.toFixed(1)}ms)`,
        metadata: { opsPerSec, elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest(
    "10.03.2",
    "BAPCodec — 10KB message 500 roundtrips",
    async () => {
      const { BAPCodec } = await import(join(ROOT, "protocol/codec.ts"));
      const msg = makeMsg("x".repeat(10_000));

      const start = performance.now();
      for (let i = 0; i < 500; i++) {
        const encoded = BAPCodec.encode(msg as any);
        BAPCodec.decode(encoded);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((500 / elapsed) * 1000);

      return {
        score:
          opsPerSec > 5000
            ? 10
            : opsPerSec > 1000
              ? 7
              : opsPerSec > 200
                ? 4
                : 0,
        maxScore: 10,
        details: `${opsPerSec} roundtrips/sec (${elapsed.toFixed(1)}ms)`,
        metadata: { opsPerSec, elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest(
    "10.03.3",
    "BAPCodec — 100KB message 100 roundtrips",
    async () => {
      const { BAPCodec } = await import(join(ROOT, "protocol/codec.ts"));
      const msg = makeMsg("y".repeat(100_000));

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const encoded = BAPCodec.encode(msg as any);
        BAPCodec.decode(encoded);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((100 / elapsed) * 1000);

      return {
        score:
          opsPerSec > 500 ? 10 : opsPerSec > 100 ? 7 : opsPerSec > 20 ? 4 : 0,
        maxScore: 10,
        details: `${opsPerSec} roundtrips/sec (${elapsed.toFixed(1)}ms)`,
        metadata: { opsPerSec, elapsedMs: elapsed },
      };
    },
  );

  await harness.runTest("10.03.4", "BAPCodec — compression ratio", async () => {
    const { BAPCodec } = await import(join(ROOT, "protocol/codec.ts"));
    const msg = makeMsg("hello world ".repeat(1000));
    const encoded = BAPCodec.encode(msg as any);
    const rawSize = JSON.stringify(msg).length;
    const compressedSize = encoded.byteLength;
    const ratio = rawSize / compressedSize;

    return {
      score: ratio > 3 ? 10 : ratio > 1.5 ? 7 : ratio > 1 ? 4 : 0,
      maxScore: 10,
      details: `raw=${rawSize}B compressed=${compressedSize}B ratio=${ratio.toFixed(2)}x`,
      metadata: { rawSize, compressedSize, ratio },
    };
  });
}
