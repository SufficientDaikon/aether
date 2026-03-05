// ─────────────────────────────────────────────────────────────
// WebSocket Security Test Suite
// Tests authentication, rate limiting, origin validation,
// agent ID validation, and BAPCodec input sanitization
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { AetherLinkServer } from "../protocol/server.ts";
import { BAPCodec, BAPError } from "../protocol/codec.ts";
import type { AetherMessage, Priority } from "../core/types.ts";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Pick a random port in the 19000-19999 range to avoid test collisions */
function randomPort(): number {
  return 19000 + Math.floor(Math.random() * 1000);
}

/** Build a valid AetherMessage for codec tests */
function validMessage(overrides: Partial<AetherMessage> = {}): AetherMessage {
  return {
    id: crypto.randomUUID(),
    from: "agent-a",
    to: "agent-b",
    type: "task",
    payload: { action: "test" },
    priority: 3 as Priority,
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Craft a raw BAP-02 binary frame from an arbitrary object.
 * Bypasses BAPCodec.encode validation so we can inject bad fields.
 */
function craftRawBAPFrame(obj: Record<string, unknown>): Uint8Array {
  const { pack } = require("msgpackr");
  const packed: Uint8Array = pack(obj);
  const compressed = Bun.zstdCompressSync(packed);
  const header = new Uint8Array([0x42, 0x41, 0x50, 0x30, 0x32]); // "BAP02"
  const result = new Uint8Array(header.length + compressed.length);
  result.set(header, 0);
  result.set(compressed, header.length);
  return result;
}

// ─────────────────────────────────────────────────────────────
// 1. Auth Token Enforcement
// ─────────────────────────────────────────────────────────────

describe("Auth Token Enforcement", () => {
  let server: AetherLinkServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    port = randomPort();
    logDir = join(import.meta.dir, `.tmp-ws-auth-${port}`);
    mkdirSync(logDir, { recursive: true });
    server = new AetherLinkServer(port, logDir);
  });

  afterEach(async () => {
    await server.stop();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("should reject connection without token when auth is required", async () => {
    server.setAuthToken("secret-key-123");
    await server.start();

    const response = await fetch(
      `http://localhost:${port}/?agentId=test-agent`,
    );
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("Unauthorized");
  });

  it("should reject connection with wrong token when auth is required", async () => {
    server.setAuthToken("correct-token");
    await server.start();

    const response = await fetch(
      `http://localhost:${port}/?agentId=test-agent&token=wrong-token`,
    );
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("Unauthorized");
  });

  it("should accept connection with valid token", async () => {
    server.setAuthToken("valid-token-xyz");
    await server.start();

    // A fetch to a WebSocket endpoint without proper WS headers will fail the upgrade,
    // but the auth check happens before upgrade, so if we get past 401 that means
    // auth succeeded. The server returns 500 ("WebSocket upgrade failed") when
    // the upgrade itself fails from a plain HTTP request, which still proves auth passed.
    const response = await fetch(
      `http://localhost:${port}/?agentId=test-agent&token=valid-token-xyz`,
    );
    // Should NOT be 401 — auth passed; the request fails at upgrade stage instead
    expect(response.status).not.toBe(401);
  });

  it("should accept connection when no auth token is set on server", async () => {
    // Do NOT call setAuthToken — server should allow all connections
    await server.start();

    const response = await fetch(
      `http://localhost:${port}/?agentId=test-agent`,
    );
    // Should not be 401; the request proceeds to upgrade (which fails via plain HTTP)
    expect(response.status).not.toBe(401);
  });

  it("should accept valid token and successfully upgrade via WebSocket", async () => {
    server.setAuthToken("ws-token-abc");
    await server.start();

    const ws = new WebSocket(
      `ws://localhost:${port}/?agentId=auth-agent&token=ws-token-abc`,
    );

    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });

    expect(opened).toBe(true);

    // Agent should be registered
    const agents = server.getConnectedAgents();
    expect(agents).toContain("auth-agent");

    ws.close();
  });

  it("should reject WebSocket connection with missing token", async () => {
    server.setAuthToken("required-token");
    await server.start();

    const ws = new WebSocket(`ws://localhost:${port}/?agentId=rejected-agent`);

    const result = await new Promise<{ opened: boolean; code?: number }>(
      (resolve) => {
        ws.onopen = () => resolve({ opened: true });
        ws.onerror = () => resolve({ opened: false });
        ws.onclose = (event) => resolve({ opened: false, code: event.code });
        setTimeout(() => resolve({ opened: false }), 3000);
      },
    );

    expect(result.opened).toBe(false);
    // Agent should NOT be connected
    expect(server.getConnectedAgents()).not.toContain("rejected-agent");
  });

  it("should reject WebSocket connection with incorrect token", async () => {
    server.setAuthToken("the-real-token");
    await server.start();

    const ws = new WebSocket(
      `ws://localhost:${port}/?agentId=bad-token-agent&token=fake-token`,
    );

    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });

    expect(opened).toBe(false);
    expect(server.getConnectedAgents()).not.toContain("bad-token-agent");
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Origin Validation
// ─────────────────────────────────────────────────────────────

describe("Origin Validation", () => {
  let server: AetherLinkServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    port = randomPort();
    logDir = join(import.meta.dir, `.tmp-ws-origin-${port}`);
    mkdirSync(logDir, { recursive: true });
    server = new AetherLinkServer(port, logDir);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("should allow requests with no Origin header (typical for local WS clients)", async () => {
    // fetch without Origin header — server should allow it through
    const response = await fetch(
      `http://localhost:${port}/?agentId=no-origin`,
      {
        headers: {},
      },
    );
    // Should not be 403 — no origin means no origin check
    expect(response.status).not.toBe(403);
  });

  it("should allow Origin: http://localhost", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=local-agent`,
      {
        headers: { Origin: "http://localhost" },
      },
    );
    expect(response.status).not.toBe(403);
  });

  it("should allow Origin: http://localhost:3000 (with port)", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=local-port-agent`,
      {
        headers: { Origin: "http://localhost:3000" },
      },
    );
    expect(response.status).not.toBe(403);
  });

  it("should allow Origin: http://127.0.0.1", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=ipv4-agent`,
      {
        headers: { Origin: "http://127.0.0.1" },
      },
    );
    expect(response.status).not.toBe(403);
  });

  it("should allow Origin: http://127.0.0.1:8080 (with port)", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=ipv4-port-agent`,
      {
        headers: { Origin: "http://127.0.0.1:8080" },
      },
    );
    expect(response.status).not.toBe(403);
  });

  it("should allow Origin: http://[::1]", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=ipv6-agent`,
      {
        headers: { Origin: "http://[::1]" },
      },
    );
    expect(response.status).not.toBe(403);
  });

  it("should reject Origin: http://evil.com", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=evil-agent`,
      {
        headers: { Origin: "http://evil.com" },
      },
    );
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("Forbidden origin");
  });

  it("should reject Origin: https://attacker.io", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=attacker-agent`,
      {
        headers: { Origin: "https://attacker.io" },
      },
    );
    expect(response.status).toBe(403);
  });

  it("should reject Origin: http://192.168.1.100 (non-loopback LAN IP)", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=lan-agent`,
      {
        headers: { Origin: "http://192.168.1.100" },
      },
    );
    expect(response.status).toBe(403);
  });

  it("should reject malformed Origin header", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=malformed-agent`,
      {
        headers: { Origin: "not-a-valid-url" },
      },
    );
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("Forbidden origin");
  });

  it("should reject Origin with localhost in subdomain (e.g., localhost.evil.com)", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=tricky-agent`,
      {
        headers: { Origin: "http://localhost.evil.com" },
      },
    );
    expect(response.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Agent ID Validation
// ─────────────────────────────────────────────────────────────

describe("Agent ID Validation", () => {
  let server: AetherLinkServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    port = randomPort();
    logDir = join(import.meta.dir, `.tmp-ws-agentid-${port}`);
    mkdirSync(logDir, { recursive: true });
    server = new AetherLinkServer(port, logDir);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  // ── Valid agent IDs ──

  it("should accept simple alphanumeric agentId", async () => {
    const response = await fetch(`http://localhost:${port}/?agentId=agent1`);
    expect(response.status).not.toBe(400);
  });

  it("should accept agentId with hyphens", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=my-agent-01`,
    );
    expect(response.status).not.toBe(400);
  });

  it("should accept agentId with underscores", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=my_agent_02`,
    );
    expect(response.status).not.toBe(400);
  });

  it("should accept agentId with dots", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=agent.v2.prod`,
    );
    expect(response.status).not.toBe(400);
  });

  it("should accept agentId with mixed valid characters", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=Cyber-Sentinel_v3.1`,
    );
    expect(response.status).not.toBe(400);
  });

  it("should accept agentId at exactly 128 characters (max length)", async () => {
    const maxId = "a".repeat(128);
    const response = await fetch(`http://localhost:${port}/?agentId=${maxId}`);
    expect(response.status).not.toBe(400);
  });

  it("should accept single-character agentId", async () => {
    const response = await fetch(`http://localhost:${port}/?agentId=x`);
    expect(response.status).not.toBe(400);
  });

  // ── Missing agentId ──

  it("should reject request with missing agentId (no param at all)", async () => {
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Missing agentId");
  });

  it("should reject request with empty agentId", async () => {
    const response = await fetch(`http://localhost:${port}/?agentId=`);
    expect(response.status).toBe(400);
  });

  // ── Invalid agent IDs ──

  it("should reject agentId with spaces", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=agent%20with%20spaces`,
    );
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Invalid agentId format");
  });

  it("should reject agentId with special characters (@, #, $)", async () => {
    const ids = ["agent@evil", "agent#1", "agent$money"];
    for (const id of ids) {
      const response = await fetch(
        `http://localhost:${port}/?agentId=${encodeURIComponent(id)}`,
      );
      expect(response.status).toBe(400);
    }
  });

  it("should reject agentId with SQL injection attempt", async () => {
    const sqlPayloads = [
      "agent'; DROP TABLE agents;--",
      "agent' OR '1'='1",
      'agent" UNION SELECT * FROM users--',
    ];
    for (const payload of sqlPayloads) {
      const response = await fetch(
        `http://localhost:${port}/?agentId=${encodeURIComponent(payload)}`,
      );
      expect(response.status).toBe(400);
    }
  });

  it("should reject agentId with path traversal attempt", async () => {
    const traversalPayloads = [
      "../../../etc/passwd",
      "..\\..\\windows\\system32",
      "agent/../../secret",
    ];
    for (const payload of traversalPayloads) {
      const response = await fetch(
        `http://localhost:${port}/?agentId=${encodeURIComponent(payload)}`,
      );
      expect(response.status).toBe(400);
    }
  });

  it("should reject agentId with XSS attempt", async () => {
    const xssPayloads = [
      "<script>alert(1)</script>",
      "agent<img onerror=alert(1)>",
      'agent"><svg onload=alert(1)>',
    ];
    for (const payload of xssPayloads) {
      const response = await fetch(
        `http://localhost:${port}/?agentId=${encodeURIComponent(payload)}`,
      );
      expect(response.status).toBe(400);
    }
  });

  it("should reject agentId with null bytes", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=agent%00injected`,
    );
    expect(response.status).toBe(400);
  });

  it("should reject agentId exceeding 128 characters", async () => {
    const longId = "a".repeat(129);
    const response = await fetch(`http://localhost:${port}/?agentId=${longId}`);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Invalid agentId format");
  });

  it("should reject agentId with unicode/emoji characters", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=${encodeURIComponent("agent-🤖-test")}`,
    );
    expect(response.status).toBe(400);
  });

  it("should reject agentId with newline characters", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=${encodeURIComponent("agent\ninjected")}`,
    );
    expect(response.status).toBe(400);
  });

  it("should reject agentId with semicolons (command injection)", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=${encodeURIComponent("agent;rm -rf /")}`,
    );
    expect(response.status).toBe(400);
  });

  it("should reject agentId with backticks (shell injection)", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=${encodeURIComponent("agent`whoami`")}`,
    );
    expect(response.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. BAPCodec Input Validation
// ─────────────────────────────────────────────────────────────

describe("BAPCodec Input Validation", () => {
  // ── Valid message encode/decode ──

  describe("valid message roundtrip", () => {
    it("should encode and decode a valid message correctly", () => {
      const msg = validMessage();
      const encoded = BAPCodec.encode(msg);
      const decoded = BAPCodec.decode(encoded);

      expect(decoded.id).toBe(msg.id);
      expect(decoded.from).toBe(msg.from);
      expect(decoded.to).toBe(msg.to);
      expect(decoded.type).toBe(msg.type);
      expect(decoded.priority).toBe(msg.priority);
      expect(decoded.timestamp).toBe(msg.timestamp);
      expect(decoded.payload).toEqual(msg.payload);
    });

    it("should handle all valid priority values (1 through 5)", () => {
      for (let p = 1; p <= 5; p++) {
        const msg = validMessage({ priority: p as Priority });
        const decoded = BAPCodec.decode(BAPCodec.encode(msg));
        expect(decoded.priority).toBe(p);
      }
    });

    it("should handle all valid message types", () => {
      const types = [
        "task",
        "result",
        "escalation",
        "broadcast",
        "heartbeat",
        "register",
        "query",
      ] as const;
      for (const t of types) {
        const msg = validMessage({ type: t });
        const decoded = BAPCodec.decode(BAPCodec.encode(msg));
        expect(decoded.type).toBe(t);
      }
    });

    it("should handle message with correlationId", () => {
      const msg = validMessage({ correlationId: "corr-abc-123" });
      const decoded = BAPCodec.decode(BAPCodec.encode(msg));
      expect(decoded.correlationId).toBe("corr-abc-123");
    });

    it("should handle message with ttl", () => {
      const msg = validMessage({ ttl: 30000 });
      const decoded = BAPCodec.decode(BAPCodec.encode(msg));
      expect(decoded.ttl).toBe(30000);
    });
  });

  // ── Priority validation ──

  describe("priority validation", () => {
    it("should throw BAPError for priority 0 (below minimum)", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 0,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for priority 6 (above maximum)", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 6,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for negative priority", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: -1,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for very large priority", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 999,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });
  });

  // ── Timestamp validation ──

  describe("timestamp validation", () => {
    it("should accept timestamp at current time", () => {
      const msg = validMessage({ timestamp: Date.now() });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should accept timestamp slightly in the past (1 minute ago)", () => {
      const msg = validMessage({ timestamp: Date.now() - 60_000 });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should accept timestamp slightly in the future (30 minutes)", () => {
      const msg = validMessage({ timestamp: Date.now() + 30 * 60_000 });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should throw BAPError for timestamp too far in the future (>1 hour)", () => {
      const twoHoursFromNow = Date.now() + 2 * 3_600_000;
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: twoHoursFromNow,
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for timestamp too far in the past (>30 days)", () => {
      const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: sixtyDaysAgo,
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for timestamp at epoch (Jan 1 1970)", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: 0,
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for timestamp exactly 31 days in the past", () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 86_400_000;
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: thirtyOneDaysAgo,
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should accept timestamp exactly at the 30-day boundary", () => {
      // Just barely within range: 29 days and 23 hours ago
      const justWithin = Date.now() - (30 * 86_400_000 - 3_600_000);
      const msg = validMessage({ timestamp: justWithin });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });
  });

  // ── 'from' field validation ──

  describe("'from' field validation", () => {
    it("should accept valid 'from' field (alphanumeric, hyphens, underscores, dots)", () => {
      const msg = validMessage({ from: "agent-a.v2_prod" });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should throw BAPError for 'from' with special characters", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent<script>alert(1)</script>",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for 'from' with spaces", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent with spaces",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for 'from' with null bytes", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent\x00injected",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for 'from' exceeding 128 characters", () => {
      const longFrom = "a".repeat(129);
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: longFrom,
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should accept 'from' with forward slashes (used in channel paths)", () => {
      // The regex allows: [a-zA-Z0-9._*/-]
      const msg = validMessage({ from: "workers/agent-a" });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should accept 'from' at exactly 128 characters", () => {
      const maxFrom = "a".repeat(128);
      const msg = validMessage({ from: maxFrom });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });
  });

  // ── 'to' field validation ──

  describe("'to' field validation", () => {
    it("should accept valid 'to' field", () => {
      const msg = validMessage({ to: "agent-b.v1" });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should accept wildcard '*' as 'to' (broadcast)", () => {
      const msg = validMessage({ to: "*" });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });

    it("should throw BAPError for 'to' exceeding 128 characters", () => {
      const longTo = "b".repeat(129);
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: longTo,
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for 'to' with special characters", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent'; DROP TABLE--",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for 'to' with angle brackets (injection)", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "<script>",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should accept 'to' at exactly 128 characters", () => {
      const maxTo = "b".repeat(128);
      const msg = validMessage({ to: maxTo });
      expect(() => BAPCodec.validate(msg)).not.toThrow();
    });
  });

  // ── Missing required fields ──

  describe("missing required fields", () => {
    it("should throw BAPError when 'id' is missing", () => {
      const raw = craftRawBAPFrame({
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError when 'from' is missing", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError when 'to' is missing", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        type: "task",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError when 'type' is missing", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError when 'priority' is missing", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError when 'timestamp' is missing", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "task",
        payload: null,
        priority: 3,
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });
  });

  // ── Invalid message type ──

  describe("invalid message type", () => {
    it("should throw BAPError for unknown message type", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "invalid-type",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });

    it("should throw BAPError for empty string message type", () => {
      const raw = craftRawBAPFrame({
        id: crypto.randomUUID(),
        from: "agent-a",
        to: "agent-b",
        type: "",
        payload: null,
        priority: 3,
        timestamp: Date.now(),
      });
      expect(() => BAPCodec.decode(raw)).toThrow(BAPError);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Rate Limiting
// ─────────────────────────────────────────────────────────────

describe("Rate Limiting", () => {
  let server: AetherLinkServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    port = randomPort();
    logDir = join(import.meta.dir, `.tmp-ws-ratelimit-${port}`);
    mkdirSync(logDir, { recursive: true });
    server = new AetherLinkServer(port, logDir);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("should allow up to 10 connection attempts within the rate limit window", async () => {
    const results: number[] = [];

    for (let i = 0; i < 10; i++) {
      const response = await fetch(
        `http://localhost:${port}/?agentId=rate-test-${i}`,
      );
      results.push(response.status);
      // Consume response body to avoid leaking resources
      await response.text();
    }

    // All 10 should be allowed (not 429)
    for (const status of results) {
      expect(status).not.toBe(429);
    }
  });

  it("should reject the 11th connection attempt with 429", async () => {
    // Exhaust the rate limit: 10 requests
    for (let i = 0; i < 10; i++) {
      const resp = await fetch(`http://localhost:${port}/?agentId=flood-${i}`);
      await resp.text();
    }

    // The 11th request should be rate-limited
    const response = await fetch(
      `http://localhost:${port}/?agentId=flood-overflow`,
    );
    expect(response.status).toBe(429);
    const body = await response.text();
    expect(body).toContain("Too many connection attempts");
  });

  it("should apply rate limiting per-IP independently", async () => {
    // Since we're hitting localhost, all requests come from the same IP.
    // We exhaust the limit with 10 requests, then verify the 11th is blocked.
    // This tests that the rate limiter tracks counts correctly for a single IP.
    for (let i = 0; i < 10; i++) {
      const resp = await fetch(
        `http://localhost:${port}/?agentId=ip-test-${i}`,
      );
      await resp.text();
    }

    const blocked = await fetch(
      `http://localhost:${port}/?agentId=ip-test-overflow`,
    );
    expect(blocked.status).toBe(429);
    await blocked.text();
  });

  it("should not rate-limit health endpoint requests", async () => {
    // Exhaust the rate limit on WebSocket upgrade path
    for (let i = 0; i < 12; i++) {
      const resp = await fetch(
        `http://localhost:${port}/?agentId=pre-exhaust-${i}`,
      );
      await resp.text();
    }

    // Health endpoint should still work since it returns before the rate limiter
    const healthResponse = await fetch(`http://localhost:${port}/health`);
    expect(healthResponse.status).toBe(200);
    const health = await healthResponse.json();
    expect(health.status).toBe("ok");
  });

  it("should not rate-limit metrics endpoint requests", async () => {
    // Exhaust the rate limit
    for (let i = 0; i < 12; i++) {
      const resp = await fetch(
        `http://localhost:${port}/?agentId=exhaust-metrics-${i}`,
      );
      await resp.text();
    }

    // Metrics endpoint should still work
    const metricsResponse = await fetch(`http://localhost:${port}/metrics`);
    expect(metricsResponse.status).toBe(200);
    const body = await metricsResponse.text();
    expect(body).toContain("aether_connected_agents");
  });

  it("should not rate-limit status endpoint requests", async () => {
    // Exhaust the rate limit
    for (let i = 0; i < 12; i++) {
      const resp = await fetch(
        `http://localhost:${port}/?agentId=exhaust-status-${i}`,
      );
      await resp.text();
    }

    // Status endpoint should still work
    const statusResponse = await fetch(`http://localhost:${port}/status`);
    expect(statusResponse.status).toBe(200);
    const data = await statusResponse.json();
    expect(data).toHaveProperty("connectedAgents");
  });

  it("should return 429 for WebSocket upgrade attempts after rate limit is exhausted", async () => {
    // Exhaust the rate limit using fetch
    for (let i = 0; i < 10; i++) {
      const resp = await fetch(
        `http://localhost:${port}/?agentId=ws-rate-${i}`,
      );
      await resp.text();
    }

    // Attempt WebSocket connection after rate limit is hit
    const ws = new WebSocket(`ws://localhost:${port}/?agentId=ws-blocked`);

    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });

    expect(opened).toBe(false);
    expect(server.getConnectedAgents()).not.toContain("ws-blocked");
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Combined Security Scenarios
// ─────────────────────────────────────────────────────────────

describe("Combined Security Scenarios", () => {
  let server: AetherLinkServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    port = randomPort();
    logDir = join(import.meta.dir, `.tmp-ws-combined-${port}`);
    mkdirSync(logDir, { recursive: true });
    server = new AetherLinkServer(port, logDir);
    server.setAuthToken("combined-secret");
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    try {
      rmSync(logDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("should reject request with valid token but invalid agentId", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=<script>&token=combined-secret`,
    );
    expect(response.status).toBe(400);
  });

  it("should reject request with valid agentId but missing token", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=valid-agent`,
    );
    expect(response.status).toBe(401);
  });

  it("should reject request with forbidden origin even with valid token", async () => {
    const response = await fetch(
      `http://localhost:${port}/?agentId=origin-agent&token=combined-secret`,
      { headers: { Origin: "http://evil.com" } },
    );
    expect(response.status).toBe(403);
  });

  it("should enforce rate limit before auth check", async () => {
    // Exhaust rate limit with 10 requests (they'll fail auth but still count)
    for (let i = 0; i < 10; i++) {
      const resp = await fetch(`http://localhost:${port}/?agentId=rl-${i}`);
      await resp.text();
    }

    // Now even a valid request should get rate-limited (429) before checking auth
    const response = await fetch(
      `http://localhost:${port}/?agentId=valid-agent&token=combined-secret`,
    );
    expect(response.status).toBe(429);
  });

  it("should allow a full valid WebSocket connection through all security layers", async () => {
    const ws = new WebSocket(
      `ws://localhost:${port}/?agentId=secure-agent&token=combined-secret`,
    );

    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });

    expect(opened).toBe(true);
    expect(server.getConnectedAgents()).toContain("secure-agent");

    ws.close();
  });

  it("should support multiple concurrent valid WebSocket connections", async () => {
    const agents = ["alpha", "beta", "gamma"];
    const sockets: WebSocket[] = [];

    for (const agentId of agents) {
      const ws = new WebSocket(
        `ws://localhost:${port}/?agentId=${agentId}&token=combined-secret`,
      );
      sockets.push(ws);

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
        ws.onerror = () => resolve();
        setTimeout(() => resolve(), 3000);
      });
    }

    const connected = server.getConnectedAgents();
    for (const agentId of agents) {
      expect(connected).toContain(agentId);
    }

    // Cleanup
    for (const ws of sockets) {
      ws.close();
    }
  });
});
