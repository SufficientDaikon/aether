// -----------------------------------------------------------------
// AETHER Eval -- Phase 3: BAP-02 Codec Tests
// Tests BAPCodec encode/decode, validation, legacy compat, efficiency
// -----------------------------------------------------------------

import type { TestHarness } from "../helpers/test-harness.ts";

export async function run(harness: TestHarness): Promise<void> {
  // -- Test 3.1.1: Encode/Decode roundtrip with valid AetherMessage ------
  await harness.runTest(
    "3.1.1",
    "BAPCodec -- Encode/Decode roundtrip",
    async () => {
      let score = 0;
      const maxScore = 6;
      const details: string[] = [];

      try {
        const { BAPCodec } = await import("../../protocol/codec.ts");

        // Create a valid message via factory
        const msg = BAPCodec.createMessage(
          "agent-alpha",
          "agent-beta",
          "task",
          { action: "analyze", data: [1, 2, 3] },
          3,
        );

        // Encode
        const encoded = BAPCodec.encode(msg);
        if (encoded instanceof Uint8Array && encoded.byteLength > 0) {
          details.push(`Encoded to ${encoded.byteLength} bytes`);
          score += 2;
        } else {
          details.push("Encode did not return a valid Uint8Array");
        }

        // Decode
        const decoded = BAPCodec.decode(encoded);
        if (decoded && decoded.id === msg.id) {
          details.push("Decoded message ID matches");
          score += 1;
        } else {
          details.push("Decoded message ID mismatch");
        }

        // Verify all fields survive roundtrip
        const fieldsOk =
          decoded.from === msg.from &&
          decoded.to === msg.to &&
          decoded.type === msg.type &&
          decoded.priority === msg.priority &&
          decoded.timestamp === msg.timestamp;
        if (fieldsOk) {
          details.push("All core fields preserved through roundtrip");
          score += 2;
        } else {
          details.push("Some core fields lost in roundtrip");
        }

        // Verify payload survives
        const payloadOk =
          decoded.payload &&
          typeof decoded.payload === "object" &&
          (decoded.payload as any).action === "analyze";
        if (payloadOk) {
          details.push("Payload preserved through roundtrip");
          score += 1;
        } else {
          details.push("Payload not preserved");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.1.2: Unicode payload handling --------------------------------
  await harness.runTest(
    "3.1.2",
    "BAPCodec -- Unicode payload roundtrip",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { BAPCodec } = await import("../../protocol/codec.ts");

        const unicodePayload = {
          greeting: "Hello, world!",
          japanese: "\u3053\u3093\u306B\u3061\u306F\u4E16\u754C",
          emoji: "\uD83D\uDE80\uD83C\uDF1F\uD83E\uDD16",
          arabic:
            "\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645",
          mixed: "caf\u00E9 na\u00EFve r\u00E9sum\u00E9",
        };

        const msg = BAPCodec.createMessage(
          "agent-a",
          "agent-b",
          "task",
          unicodePayload,
          2,
        );

        const encoded = BAPCodec.encode(msg);
        const decoded = BAPCodec.decode(encoded);

        const p = decoded.payload as Record<string, string>;
        if (p.japanese === unicodePayload.japanese) {
          details.push("Japanese characters preserved");
          score += 1;
        } else {
          details.push("Japanese characters lost");
        }

        if (p.emoji === unicodePayload.emoji) {
          details.push("Emoji preserved");
          score += 1;
        } else {
          details.push("Emoji lost");
        }

        if (p.arabic === unicodePayload.arabic) {
          details.push("Arabic characters preserved");
          score += 1;
        } else {
          details.push("Arabic characters lost");
        }

        if (p.mixed === unicodePayload.mixed) {
          details.push("Mixed diacritics preserved");
          score += 1;
        } else {
          details.push("Mixed diacritics lost");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.1.3: Large payload (100KB+) ----------------------------------
  await harness.runTest(
    "3.1.3",
    "BAPCodec -- Large payload (100KB+)",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { BAPCodec } = await import("../../protocol/codec.ts");

        // Build a payload > 100KB
        const largeString = "A".repeat(100 * 1024);
        const msg = BAPCodec.createMessage(
          "agent-a",
          "agent-b",
          "result",
          { bigData: largeString },
          1,
        );

        const rawJson = JSON.stringify(msg);
        const rawSize = Buffer.byteLength(rawJson, "utf-8");
        details.push(`Raw JSON size: ${rawSize} bytes`);

        const encoded = BAPCodec.encode(msg);
        details.push(`Encoded size: ${encoded.byteLength} bytes`);
        score += 1;

        // Decode and verify integrity
        const decoded = BAPCodec.decode(encoded);
        const decodedPayload = decoded.payload as { bigData: string };
        if (decodedPayload.bigData.length === 100 * 1024) {
          details.push("Large payload survived roundtrip intact");
          score += 2;
        } else {
          details.push(
            `Payload length mismatch: expected ${100 * 1024}, got ${decodedPayload.bigData.length}`,
          );
        }

        // Compression should be very effective on repeated characters
        if (encoded.byteLength < rawSize) {
          details.push(
            `Compression effective: ${((encoded.byteLength / rawSize) * 100).toFixed(1)}% of original`,
          );
          score += 1;
        } else {
          details.push("Compression did not reduce size");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.1.4: BAP-01 backward compatibility ---------------------------
  await harness.runTest(
    "3.1.4",
    "BAPCodec -- BAP-01 legacy hex backward compat",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { BAPCodec } = await import("../../protocol/codec.ts");

        // Build a BAP-01-style hex string: header "4241503031" + hex(JSON)
        const legacyMsg = {
          id: crypto.randomUUID(),
          from: "legacy-agent",
          to: "modern-agent",
          type: "task",
          payload: { data: "from-bap01" },
          priority: 3,
          timestamp: Date.now(),
        };

        const jsonStr = JSON.stringify(legacyMsg);
        const hexPayload = Buffer.from(jsonStr, "utf-8").toString("hex");
        const legacyEncoded = "4241503031" + hexPayload;

        // Decode legacy format
        const decoded = BAPCodec.decode(legacyEncoded);
        if (decoded.id === legacyMsg.id) {
          details.push("Legacy BAP-01 hex decoded successfully, ID matches");
          score += 2;
        } else {
          details.push("Legacy decode ID mismatch");
        }

        if (decoded.from === "legacy-agent" && decoded.to === "modern-agent") {
          details.push("Legacy from/to fields correct");
          score += 1;
        } else {
          details.push("Legacy from/to mismatch");
        }

        // isValid should return true
        if (BAPCodec.isValid(legacyEncoded)) {
          details.push("isValid returns true for legacy format");
          score += 1;
        } else {
          details.push("isValid returns false for legacy format");
        }
      } catch (err) {
        details.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.1.5: Validation rules ----------------------------------------
  await harness.runTest(
    "3.1.5",
    "BAPCodec -- Validation rules (invalid types, missing fields)",
    async () => {
      let score = 0;
      const maxScore = 8;
      const details: string[] = [];

      try {
        const { BAPCodec, BAPError } = await import("../../protocol/codec.ts");

        // Missing required field: 'from'
        try {
          BAPCodec.validate({
            id: "x",
            to: "y",
            type: "task",
            priority: 3,
            timestamp: Date.now(),
          } as any);
          details.push("FAIL: no error for missing 'from'");
        } catch (e) {
          if (e instanceof BAPError) {
            details.push("Throws BAPError for missing 'from'");
            score += 2;
          } else {
            details.push("Throws non-BAPError for missing 'from'");
            score += 1;
          }
        }

        // Invalid message type
        try {
          BAPCodec.validate({
            id: "x",
            from: "a",
            to: "b",
            type: "invalid-type" as any,
            priority: 3,
            timestamp: Date.now(),
          } as any);
          details.push("FAIL: no error for invalid message type");
        } catch (e) {
          if (e instanceof BAPError) {
            details.push("Throws BAPError for invalid message type");
            score += 2;
          } else {
            details.push("Throws non-BAPError for invalid type");
            score += 1;
          }
        }

        // Invalid priority (out of range)
        try {
          BAPCodec.validate({
            id: "x",
            from: "a",
            to: "b",
            type: "task",
            priority: 99 as any,
            timestamp: Date.now(),
          } as any);
          details.push("FAIL: no error for priority=99");
        } catch (e) {
          if (e instanceof BAPError) {
            details.push("Throws BAPError for invalid priority");
            score += 2;
          } else {
            details.push("Throws non-BAPError for invalid priority");
            score += 1;
          }
        }

        // Invalid 'from' characters
        try {
          BAPCodec.validate({
            id: "x",
            from: "agent with spaces!!!",
            to: "b",
            type: "task",
            priority: 3,
            timestamp: Date.now(),
          } as any);
          details.push("FAIL: no error for invalid 'from' characters");
        } catch (e) {
          if (e instanceof BAPError) {
            details.push("Throws BAPError for invalid 'from' characters");
            score += 2;
          } else {
            details.push("Throws non-BAPError for invalid 'from'");
            score += 1;
          }
        }
      } catch (err) {
        details.push(
          `Import error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { score, maxScore, details: details.join("; ") };
    },
  );

  // -- Test 3.1.6: Compression efficiency measurement ----------------------
  await harness.runTest(
    "3.1.6",
    "BAPCodec -- Compression efficiency measurement",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { BAPCodec } = await import("../../protocol/codec.ts");

        const msg = BAPCodec.createMessage(
          "agent-a",
          "agent-b",
          "result",
          {
            report: "Detailed analysis ".repeat(200),
            numbers: Array.from({ length: 100 }, (_, i) => i),
          },
          2,
        );

        const eff = BAPCodec.efficiency(msg);

        if (
          typeof eff.rawBytes === "number" &&
          typeof eff.encodedBytes === "number" &&
          typeof eff.overhead === "number"
        ) {
          details.push(
            `rawBytes=${eff.rawBytes}, encodedBytes=${eff.encodedBytes}, overhead=${eff.overhead.toFixed(3)}`,
          );
          score += 2;
        } else {
          details.push("efficiency() returned unexpected structure");
        }

        // For repetitive data, overhead should be < 1.0 (compression wins)
        if (eff.overhead < 1.0) {
          details.push(
            `Compression effective: ${((1 - eff.overhead) * 100).toFixed(1)}% savings`,
          );
          score += 2;
        } else {
          details.push(
            `Compression overhead >= 1.0 (${eff.overhead.toFixed(3)}); not compressing well`,
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

  // -- Test 3.1.7: Magic header "BAP02" verification ----------------------
  await harness.runTest(
    "3.1.7",
    "BAPCodec -- Magic header BAP02 verification",
    async () => {
      let score = 0;
      const maxScore = 4;
      const details: string[] = [];

      try {
        const { BAPCodec, BAPError } = await import("../../protocol/codec.ts");

        const msg = BAPCodec.createMessage(
          "agent-a",
          "agent-b",
          "heartbeat",
          null,
          1,
        );

        const encoded = BAPCodec.encode(msg);

        // First 5 bytes must be ASCII "BAP02" = [0x42, 0x41, 0x50, 0x30, 0x32]
        const magic = Array.from(encoded.slice(0, 5));
        const expected = [0x42, 0x41, 0x50, 0x30, 0x32];
        if (JSON.stringify(magic) === JSON.stringify(expected)) {
          details.push("BAP02 magic header present and correct");
          score += 2;
        } else {
          details.push(`Magic header mismatch: got [${magic.join(",")}]`);
        }

        // Tampering with header should cause decode to fail
        const tampered = new Uint8Array(encoded);
        tampered[0] = 0x00; // corrupt first byte
        try {
          BAPCodec.decode(tampered);
          details.push("FAIL: tampered header decoded without error");
        } catch (e) {
          if (e instanceof BAPError) {
            details.push("Tampered header correctly rejected with BAPError");
            score += 1;
          } else {
            details.push("Tampered header threw non-BAPError");
            score += 1;
          }
        }

        // Too-short data should throw
        try {
          BAPCodec.decode(new Uint8Array([0x42, 0x41]));
          details.push("FAIL: short data decoded without error");
        } catch (e) {
          if (e instanceof BAPError) {
            details.push("Short data correctly rejected with BAPError");
            score += 1;
          } else {
            details.push("Short data threw non-BAPError");
            score += 1;
          }
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
