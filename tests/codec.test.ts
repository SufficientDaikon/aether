import { describe, it, expect } from "bun:test";
import { BAPCodec, BAPError } from "../protocol/codec.ts";
import type { AetherMessage, MessageType, Priority } from "../core/types.ts";

describe("BAPCodec (BAP-02 Binary)", () => {
  // ───────────────── encode/decode roundtrip ─────────────────

  describe("encode/decode roundtrip", () => {
    it("should encode and decode a message correctly", () => {
      const msg = BAPCodec.createMessage(
        "agent-a",
        "agent-b",
        "task",
        { action: "build" },
        3,
      );
      const encoded = BAPCodec.encode(msg);
      const decoded = BAPCodec.decode(encoded);
      expect(decoded.from).toBe("agent-a");
      expect(decoded.to).toBe("agent-b");
      expect(decoded.type).toBe("task");
      expect(decoded.payload).toEqual({ action: "build" });
      expect(decoded.priority).toBe(3);
    });

    it("should preserve all fields through roundtrip", () => {
      const msg = BAPCodec.createMessage(
        "sender",
        "receiver",
        "result",
        { ok: true },
        5,
        "corr-123",
      );
      const decoded = BAPCodec.decode(BAPCodec.encode(msg));
      expect(decoded.id).toBe(msg.id);
      expect(decoded.from).toBe(msg.from);
      expect(decoded.to).toBe(msg.to);
      expect(decoded.type).toBe(msg.type);
      expect(decoded.payload).toEqual(msg.payload);
      expect(decoded.priority).toBe(msg.priority);
      expect(decoded.timestamp).toBe(msg.timestamp);
      expect(decoded.correlationId).toBe("corr-123");
    });

    it("should handle complex payloads (nested objects, arrays)", () => {
      const payload = {
        nested: { deep: { value: 42 } },
        list: [1, "two", { three: true }],
        matrix: [
          [1, 2],
          [3, 4],
        ],
      };
      const msg = BAPCodec.createMessage("a", "b", "task", payload, 2);
      const decoded = BAPCodec.decode(BAPCodec.encode(msg));
      expect(decoded.payload).toEqual(payload);
    });

    it("should handle empty payload", () => {
      const msg = BAPCodec.createMessage("a", "b", "heartbeat", null, 1);
      const decoded = BAPCodec.decode(BAPCodec.encode(msg));
      expect(decoded.payload).toBeNull();
    });

    it("should handle unicode in payload", () => {
      const payload = {
        greeting: "こんにちは世界 🌍",
        emoji: "🚀✨🎉",
        arabic: "مرحبا",
      };
      const msg = BAPCodec.createMessage("a", "b", "task", payload, 3);
      const decoded = BAPCodec.decode(BAPCodec.encode(msg));
      expect(decoded.payload).toEqual(payload);
    });

    it("should roundtrip through ArrayBuffer intermediary", () => {
      const msg = BAPCodec.createMessage(
        "x",
        "y",
        "broadcast",
        { data: 123 },
        2,
      );
      const encoded = BAPCodec.encode(msg);
      // Simulate receiving as ArrayBuffer (like from WebSocket)
      const ab = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      );
      const decoded = BAPCodec.decode(ab);
      expect(decoded.from).toBe("x");
      expect(decoded.to).toBe("y");
      expect(decoded.payload).toEqual({ data: 123 });
    });

    it("should handle large payloads efficiently", () => {
      const largePayload = {
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
          value: Math.random(),
          tags: ["alpha", "beta", "gamma"],
        })),
      };
      const msg = BAPCodec.createMessage("a", "b", "task", largePayload, 3);
      const encoded = BAPCodec.encode(msg);
      const decoded = BAPCodec.decode(encoded);
      const payload = decoded.payload as typeof largePayload;
      expect(payload.data.length).toBe(1000);
      expect(payload.data[0].name).toBe("item-0");
      expect(payload.data[999].name).toBe("item-999");
    });
  });

  // ───────────────── encode ─────────────────

  describe("encode", () => {
    it("should return a Uint8Array", () => {
      const msg = BAPCodec.createMessage("a", "b", "heartbeat", null, 1);
      const encoded = BAPCodec.encode(msg);
      expect(encoded).toBeInstanceOf(Uint8Array);
    });

    it("should start with BAP02 magic header bytes", () => {
      const msg = BAPCodec.createMessage("a", "b", "heartbeat", null, 1);
      const encoded = BAPCodec.encode(msg);
      expect(encoded[0]).toBe(0x42); // B
      expect(encoded[1]).toBe(0x41); // A
      expect(encoded[2]).toBe(0x50); // P
      expect(encoded[3]).toBe(0x30); // 0
      expect(encoded[4]).toBe(0x32); // 2
    });

    it("should produce binary output smaller than or near raw JSON", () => {
      const msg = BAPCodec.createMessage(
        "sender",
        "receiver",
        "task",
        { data: "hello world" },
        3,
      );
      const encoded = BAPCodec.encode(msg);
      const rawJson = JSON.stringify(msg);
      const rawBytes = Buffer.byteLength(rawJson, "utf-8");
      expect(encoded.byteLength).toBeLessThan(rawBytes * 1.5);
    });

    it("should compress large messages well below JSON size", () => {
      const bigPayload = {
        text: "hello world ".repeat(500),
        items: Array(100).fill({ key: "val" }),
      };
      const msg = BAPCodec.createMessage("a", "b", "task", bigPayload, 3);
      const encoded = BAPCodec.encode(msg);
      const rawBytes = Buffer.byteLength(JSON.stringify(msg), "utf-8");
      expect(encoded.byteLength).toBeLessThan(rawBytes * 0.5);
    });
  });

  // ───────────────── decode ─────────────────

  describe("decode", () => {
    it("should throw BAPError on random string input", () => {
      expect(() => BAPCodec.decode("INVALIDHEX")).toThrow(BAPError);
    });

    it("should throw BAPError on data too short for header", () => {
      expect(() => BAPCodec.decode(new Uint8Array([0x42, 0x41]))).toThrow(
        BAPError,
      );
    });

    it("should throw BAPError on wrong magic header", () => {
      const bad = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02]);
      expect(() => BAPCodec.decode(bad)).toThrow(BAPError);
    });

    it("should throw on corrupted compressed data", () => {
      const header = new Uint8Array([0x42, 0x41, 0x50, 0x30, 0x32]);
      const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);
      const bad = new Uint8Array(header.length + garbage.length);
      bad.set(header, 0);
      bad.set(garbage, header.length);
      expect(() => BAPCodec.decode(bad)).toThrow(BAPError);
    });

    it("should throw on missing required fields after decompression", () => {
      const { pack } = require("msgpackr");
      const incomplete = { from: "a" };
      const packed = pack(incomplete);
      const compressed = Bun.zstdCompressSync(packed);
      const header = new Uint8Array([0x42, 0x41, 0x50, 0x30, 0x32]);
      const result = new Uint8Array(header.length + compressed.length);
      result.set(header, 0);
      result.set(compressed, header.length);
      expect(() => BAPCodec.decode(result)).toThrow(BAPError);
    });

    it("should throw on invalid message type", () => {
      const { pack } = require("msgpackr");
      const bad: AetherMessage = {
        id: "test-id",
        from: "a",
        to: "b",
        type: "invalid_type" as MessageType,
        payload: null,
        priority: 1,
        timestamp: Date.now(),
      };
      const packed = pack(bad);
      const compressed = Bun.zstdCompressSync(packed);
      const header = new Uint8Array([0x42, 0x41, 0x50, 0x30, 0x32]);
      const result = new Uint8Array(header.length + compressed.length);
      result.set(header, 0);
      result.set(compressed, header.length);
      expect(() => BAPCodec.decode(result)).toThrow(BAPError);
    });

    it("should throw on invalid priority", () => {
      const { pack } = require("msgpackr");
      const bad: AetherMessage = {
        id: "test-id",
        from: "a",
        to: "b",
        type: "task",
        payload: null,
        priority: 9 as Priority,
        timestamp: Date.now(),
      };
      const packed = pack(bad);
      const compressed = Bun.zstdCompressSync(packed);
      const header = new Uint8Array([0x42, 0x41, 0x50, 0x30, 0x32]);
      const result = new Uint8Array(header.length + compressed.length);
      result.set(header, 0);
      result.set(compressed, header.length);
      expect(() => BAPCodec.decode(result)).toThrow(BAPError);
    });
  });

  // ───────────────── legacy BAP-01 backward compatibility ────

  describe("legacy BAP-01 backward compat", () => {
    it("should decode a valid BAP-01 hex-encoded message", () => {
      const msg: AetherMessage = {
        id: "legacy-id",
        from: "old-agent",
        to: "new-agent",
        type: "task",
        payload: { legacy: true },
        priority: 2,
        timestamp: Date.now(),
      };
      const json = JSON.stringify(msg);
      const hex = Buffer.from(json, "utf-8").toString("hex");
      const legacyEncoded = "4241503031" + hex;
      const decoded = BAPCodec.decode(legacyEncoded);
      expect(decoded.from).toBe("old-agent");
      expect(decoded.to).toBe("new-agent");
      expect(decoded.payload).toEqual({ legacy: true });
    });

    it("should reject non-BAP strings", () => {
      expect(() => BAPCodec.decode("not-a-bap-message")).toThrow(BAPError);
    });
  });

  // ───────────────── validate ─────────────────

  describe("validate", () => {
    it("should accept valid messages", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 3);
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should reject messages missing 'id'", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 3);
      delete (msg as Record<string, unknown>)["id"];
      expect(() => BAPCodec.validate(msg)).toThrow(BAPError);
    });

    it("should reject messages missing 'from'", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 3);
      delete (msg as Record<string, unknown>)["from"];
      expect(() => BAPCodec.validate(msg)).toThrow(BAPError);
    });

    it("should reject messages with invalid type", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 3);
      (msg as Record<string, unknown>).type = "not-a-real-type";
      expect(() => BAPCodec.validate(msg)).toThrow(BAPError);
    });

    it("should reject priority outside 1-5", () => {
      const msgLow = BAPCodec.createMessage("a", "b", "task", null, 1);
      (msgLow as Record<string, unknown>).priority = 0;
      expect(() => BAPCodec.validate(msgLow)).toThrow(BAPError);

      const msgHigh = BAPCodec.createMessage("a", "b", "task", null, 1);
      (msgHigh as Record<string, unknown>).priority = 6;
      expect(() => BAPCodec.validate(msgHigh)).toThrow(BAPError);
    });
  });

  // ───────────────── createMessage ─────────────────

  describe("createMessage", () => {
    it("should generate a UUID id", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 1);
      expect(msg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should set timestamp to current time", () => {
      const before = Date.now();
      const msg = BAPCodec.createMessage("a", "b", "task", null, 1);
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it("should include correlationId when provided", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 1, "corr-xyz");
      expect(msg.correlationId).toBe("corr-xyz");
    });

    it("should not include correlationId when not provided", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 1);
      expect(msg.correlationId).toBeUndefined();
      expect("correlationId" in msg).toBe(false);
    });
  });

  // ───────────────── isValid ─────────────────

  describe("isValid", () => {
    it("should return true for valid BAP-02 encoded messages", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", "payload", 1);
      const encoded = BAPCodec.encode(msg);
      expect(BAPCodec.isValid(encoded)).toBe(true);
    });

    it("should return true for valid legacy BAP-01 hex messages", () => {
      const msg: AetherMessage = {
        id: "test",
        from: "a",
        to: "b",
        type: "task",
        payload: null,
        priority: 1,
        timestamp: Date.now(),
      };
      const hex = Buffer.from(JSON.stringify(msg), "utf-8").toString("hex");
      expect(BAPCodec.isValid("4241503031" + hex)).toBe(true);
    });

    it("should return false for invalid data", () => {
      expect(BAPCodec.isValid("")).toBe(false);
      expect(BAPCodec.isValid("not-valid")).toBe(false);
      expect(BAPCodec.isValid(new Uint8Array([0, 1, 2]))).toBe(false);
      expect(BAPCodec.isValid(new Uint8Array(0))).toBe(false);
    });
  });

  // ───────────────── efficiency ─────────────────

  describe("efficiency", () => {
    it("should measure binary size vs raw JSON", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", "hello", 1);
      const eff = BAPCodec.efficiency(msg);
      expect(eff.rawBytes).toBeGreaterThan(0);
      expect(eff.encodedBytes).toBeGreaterThan(0);
      expect(eff.overhead).toBeGreaterThan(0);
    });

    it("should show overhead well below 2.0 (unlike old hex encoding)", () => {
      const msg = BAPCodec.createMessage(
        "sender",
        "receiver",
        "task",
        "simple ascii data",
        3,
      );
      const eff = BAPCodec.efficiency(msg);
      expect(eff.overhead).toBeLessThan(1.5);
    });

    it("should show significant compression for large repetitive payloads", () => {
      const big = BAPCodec.createMessage(
        "a",
        "b",
        "task",
        { text: "word ".repeat(1000) },
        3,
      );
      const eff = BAPCodec.efficiency(big);
      expect(eff.overhead).toBeLessThan(0.5);
    });

    it("should return correct raw byte count", () => {
      const msg = BAPCodec.createMessage("a", "b", "task", null, 1);
      const eff = BAPCodec.efficiency(msg);
      const expectedRaw = Buffer.byteLength(JSON.stringify(msg), "utf-8");
      expect(eff.rawBytes).toBe(expectedRaw);
    });
  });

  // ───────────────── version ─────────────────

  describe("version", () => {
    it("should report BAP-02", () => {
      expect(BAPCodec.version).toBe("BAP-02");
    });
  });
});
