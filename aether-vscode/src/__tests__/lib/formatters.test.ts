// Tests for formatting utilities
import { describe, it, expect } from "vitest";
import {
  formatCost,
  formatBytes,
  formatDuration,
  formatMs,
  formatRelativeTime,
  formatNumber,
  escapeHtml,
} from "../../webview-ui/lib/formatters";

describe("formatCost", () => {
  it("formats zero cost", () => expect(formatCost(0)).toBe("$0.00"));
  it("formats cents", () => expect(formatCost(0.05)).toBe("$0.05"));
  it("formats dollars", () => expect(formatCost(12.5)).toBe("$12.50"));
  it("formats large amounts", () => expect(formatCost(1000)).toBe("$1000.00"));
  it("rounds to 2 decimal places", () => expect(formatCost(1.999)).toBe("$2.00"));
});

describe("formatBytes", () => {
  it("formats bytes", () => expect(formatBytes(500)).toBe("500B"));
  it("formats kilobytes", () => expect(formatBytes(1536)).toBe("1.5KB"));
  it("formats megabytes", () => expect(formatBytes(2 * 1024 * 1024)).toBe("2.0MB"));
  it("formats gigabytes", () => expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5GB"));
  it("formats exactly 1KB", () => expect(formatBytes(1024)).toBe("1.0KB"));
  it("formats exactly 0", () => expect(formatBytes(0)).toBe("0B"));
  it("formats 1023 bytes", () => expect(formatBytes(1023)).toBe("1023B"));
});

describe("formatDuration", () => {
  it("formats seconds", () => expect(formatDuration(45)).toBe("45s"));
  it("formats minutes and seconds", () => expect(formatDuration(90)).toBe("1m 30s"));
  it("formats hours and minutes", () => expect(formatDuration(3900)).toBe("1h 5m"));
  it("formats exactly 60 seconds as 1m", () => expect(formatDuration(60)).toBe("1m 0s"));
  it("formats exactly 3600 seconds as 1h", () => expect(formatDuration(3600)).toBe("1h 0m"));
  it("formats zero", () => expect(formatDuration(0)).toBe("0s"));
});

describe("formatMs", () => {
  it("formats sub-second as ms", () => expect(formatMs(500)).toBe("500ms"));
  it("formats exactly 1000ms as 1.0s", () => expect(formatMs(1000)).toBe("1.0s"));
  it("formats 1500ms as 1.5s", () => expect(formatMs(1500)).toBe("1.5s"));
  it("formats 0ms", () => expect(formatMs(0)).toBe("0ms"));
  it("formats 999ms", () => expect(formatMs(999)).toBe("999ms"));
});

describe("formatNumber", () => {
  it("formats small numbers", () => expect(formatNumber(42)).toBe("42"));
  it("formats hundreds", () => expect(formatNumber(999)).toBe("999"));
  it("formats thousands with K", () => expect(formatNumber(1500)).toBe("1.5K"));
  it("formats millions with M", () => expect(formatNumber(2_500_000)).toBe("2.5M"));
  it("formats exactly 1000", () => expect(formatNumber(1000)).toBe("1.0K"));
  it("formats exactly 1M", () => expect(formatNumber(1_000_000)).toBe("1.0M"));
  it("formats zero", () => expect(formatNumber(0)).toBe("0"));
});

describe("formatRelativeTime", () => {
  it("formats just now (< 60s)", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("formats minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("formats hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
  });

  it("formats days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
  });

  it("formats exactly 1 minute ago", () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatRelativeTime(oneMinAgo)).toBe("1m ago");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => expect(escapeHtml("a & b")).toBe("a &amp; b"));
  it("escapes less-than", () => expect(escapeHtml("<script>")).toBe("&lt;script&gt;"));
  it("escapes double quotes", () => expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;"));
  it("handles empty string", () => expect(escapeHtml("")).toBe(""));
  it("handles no special chars", () => expect(escapeHtml("hello world")).toBe("hello world"));
  it("escapes all XSS vectors", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});
