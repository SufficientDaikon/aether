// ─────────────────────────────────────────────────────────────
// BAP-02 — Binary Agent Protocol Codec
// MessagePack + zstd compression for minimal wire overhead
// ─────────────────────────────────────────────────────────────

import { pack, unpack } from "msgpackr";
import type { AetherMessage, MessageType, Priority } from "../core/types.ts";

// BAP-02 Magic header: ASCII "BAP02" as raw bytes
const BAP02_MAGIC = new Uint8Array([0x42, 0x41, 0x50, 0x30, 0x32]); // "BAP02"
const BAP02_MAGIC_LENGTH = 5;

// Legacy BAP-01 header (hex-encoded "BAP01")
const LEGACY_HEX_HEADER = "4241503031";

export class BAPCodec {
  // ── Encode ─────────────────────────────────────────────────

  /**
   * Encode an AetherMessage to BAP-02 binary format.
   * Pipeline: message → MessagePack → zstd compress → prepend header → Uint8Array
   */
  static encode(message: AetherMessage): Uint8Array {
    // Step 1: Serialize to MessagePack binary
    const packed: Uint8Array = pack(message);

    // Step 2: Compress with zstd (Bun built-in)
    const compressed = Bun.zstdCompressSync(packed);

    // Step 3: Prepend BAP-02 magic header
    const result = new Uint8Array(BAP02_MAGIC_LENGTH + compressed.length);
    result.set(BAP02_MAGIC, 0);
    result.set(compressed, BAP02_MAGIC_LENGTH);

    return result;
  }

  // ── Decode ─────────────────────────────────────────────────

  /**
   * Decode a BAP-02 binary message back to an AetherMessage.
   * Accepts Uint8Array, ArrayBuffer, or legacy hex string (BAP-01 backward compat).
   */
  static decode(data: Uint8Array | ArrayBuffer | string): AetherMessage {
    // Legacy BAP-01 backward compatibility
    if (typeof data === "string") {
      if (data.startsWith(LEGACY_HEX_HEADER)) {
        return BAPCodec.decodeLegacyHex(data);
      }
      throw new BAPError(
        "Invalid BAP format: expected binary data or legacy hex string",
      );
    }

    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

    // Validate BAP-02 magic header
    if (bytes.length < BAP02_MAGIC_LENGTH) {
      throw new BAPError("Data too short — missing BAP-02 header");
    }

    for (let i = 0; i < BAP02_MAGIC_LENGTH; i++) {
      if (bytes[i] !== BAP02_MAGIC[i]) {
        throw new BAPError("Invalid BAP-02 header");
      }
    }

    // Step 1: Strip header → compressed payload
    const compressed = bytes.slice(BAP02_MAGIC_LENGTH);

    // Step 2: Decompress with zstd
    let decompressed: Uint8Array;
    try {
      decompressed = Bun.zstdDecompressSync(compressed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BAPError(`zstd decompression failed: ${msg}`);
    }

    if (decompressed.length > 4 * 1024 * 1024) {
      throw new BAPError("Decompressed payload exceeds 4MB limit");
    }

    // Step 3: Deserialize MessagePack
    let message: AetherMessage;
    try {
      message = unpack(decompressed) as AetherMessage;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BAPError(`MessagePack deserialization failed: ${msg}`);
    }

    // Validate required fields
    BAPCodec.validate(message);
    return message;
  }

  // ── Legacy BAP-01 Decoder ──────────────────────────────────

  /**
   * Decode a legacy BAP-01 hex-encoded message.
   * Kept for backward compatibility during migration.
   */
  private static decodeLegacyHex(encoded: string): AetherMessage {
    const hex = encoded.slice(LEGACY_HEX_HEADER.length);
    const json = Buffer.from(hex, "hex").toString("utf-8");
    const message = JSON.parse(json) as AetherMessage;
    BAPCodec.validate(message);
    return message;
  }

  // ── Validation ─────────────────────────────────────────────

  /** Validate a message has all required fields and valid values */
  static validate(msg: AetherMessage): void {
    const required = ["id", "from", "to", "type", "priority", "timestamp"];
    for (const field of required) {
      if (!(field in msg) || msg[field as keyof AetherMessage] === undefined) {
        throw new BAPError(`Missing required field: ${field}`);
      }
    }
    const validTypes: MessageType[] = [
      "task",
      "result",
      "escalation",
      "broadcast",
      "heartbeat",
      "register",
      "query",
    ];
    if (!validTypes.includes(msg.type)) {
      throw new BAPError(`Invalid message type: ${msg.type}`);
    }
    if (msg.priority < 1 || msg.priority > 5) {
      throw new BAPError(`Invalid priority: ${msg.priority}`);
    }

    // Validate field formats
    if (typeof msg.from === "string" && msg.from.length > 128) {
      throw new BAPError("Field 'from' exceeds 128 character limit");
    }
    if (typeof msg.to === "string" && msg.to.length > 128) {
      throw new BAPError("Field 'to' exceeds 128 character limit");
    }
    if (
      typeof msg.from === "string" &&
      !/^[a-zA-Z0-9._*/-]{1,128}$/.test(msg.from)
    ) {
      throw new BAPError("Field 'from' contains invalid characters");
    }
    if (
      typeof msg.to === "string" &&
      !/^[a-zA-Z0-9._*/-]{1,128}$/.test(msg.to)
    ) {
      throw new BAPError("Field 'to' contains invalid characters");
    }

    // Validate timestamp is within reasonable range
    if (typeof msg.timestamp === "number") {
      const now = Date.now();
      const oneHourFuture = now + 3_600_000;
      const thirtyDaysPast = now - 30 * 86_400_000;
      if (msg.timestamp > oneHourFuture || msg.timestamp < thirtyDaysPast) {
        throw new BAPError("Field 'timestamp' is outside acceptable range");
      }
    }
  }

  // ── Factory ────────────────────────────────────────────────

  /** Create a new message with auto-generated ID and timestamp */
  static createMessage(
    from: string,
    to: string,
    type: MessageType,
    payload: unknown,
    priority: Priority = 3,
    correlationId?: string,
  ): AetherMessage {
    return {
      id: crypto.randomUUID(),
      from,
      to,
      type,
      payload,
      priority,
      timestamp: Date.now(),
      ...(correlationId ? { correlationId } : {}),
    };
  }

  // ── Introspection ──────────────────────────────────────────

  /** Check if binary data is valid BAP-02 (or legacy BAP-01 hex) */
  static isValid(data: Uint8Array | ArrayBuffer | string): boolean {
    try {
      BAPCodec.decode(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Measure wire efficiency: binary BAP-02 size vs raw JSON size.
   * Returns overhead ratio — values below 1.0 mean compression wins.
   */
  static efficiency(message: AetherMessage): {
    rawBytes: number;
    encodedBytes: number;
    overhead: number;
  } {
    const raw = JSON.stringify(message);
    const encoded = BAPCodec.encode(message);
    const rawBytes = Buffer.byteLength(raw, "utf-8");
    const encodedBytes = encoded.byteLength;
    return {
      rawBytes,
      encodedBytes,
      overhead: encodedBytes / rawBytes,
    };
  }

  /** Get the protocol version this codec uses */
  static get version(): string {
    return "BAP-02";
  }
}

export class BAPError extends Error {
  constructor(message: string) {
    super(`[BAP-02] ${message}`);
    this.name = "BAPError";
  }
}
