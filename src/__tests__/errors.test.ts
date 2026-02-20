import { describe, expect, it } from "vitest";
import {
  isTransientStatus,
  parseRetryAfter,
  YouTrackError,
} from "../errors.js";

describe("isTransientStatus", () => {
  it("returns true for all transient status codes", () => {
    for (const code of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isTransientStatus(code)).toBe(true);
    }
  });

  it("returns false for semantic status codes", () => {
    for (const code of [400, 401, 403, 404, 200, 201]) {
      expect(isTransientStatus(code)).toBe(false);
    }
  });
});

describe("YouTrackError", () => {
  it("sets all properties correctly", () => {
    const err = new YouTrackError("Not found", 404, false, 0);
    expect(err.message).toBe("Not found");
    expect(err.statusCode).toBe(404);
    expect(err.isTransient).toBe(false);
    expect(err.retryCount).toBe(0);
    expect(err.name).toBe("YouTrackError");
  });

  it("generates hint from known status code", () => {
    const err = new YouTrackError("err", 401, false);
    expect(err.hint).toContain("Authentication failed");
  });

  it("generates hint for unknown status code", () => {
    const err = new YouTrackError("err", 418, false);
    expect(err.hint).toBe("HTTP 418");
  });

  it("generates hint for network error (no status code)", () => {
    const err = new YouTrackError("err", undefined, true);
    expect(err.hint).toContain("Network error");
  });

  it("toToolText includes all info", () => {
    const err = new YouTrackError("timeout", 429, true, 2);
    const text = err.toToolText();
    expect(text).toContain("[YouTrack 429]");
    expect(text).toContain("timeout");
    expect(text).toContain("retried 2×");
  });

  it("toToolText omits retry info when retryCount is 0", () => {
    const err = new YouTrackError("fail", 500, true, 0);
    expect(err.toToolText()).not.toContain("retried");
  });

  it("carries retryAfterMs", () => {
    const err = new YouTrackError("rate limited", 429, true, 0, 5000);
    expect(err.retryAfterMs).toBe(5000);
  });
});

describe("parseRetryAfter", () => {
  it("returns undefined for null", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("parses integer seconds", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
  });

  it("parses fractional seconds", () => {
    expect(parseRetryAfter("1.5")).toBe(1500);
  });

  it("parses zero", () => {
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfter("abc")).toBeUndefined();
  });

  it("parses HTTP-date in the future", () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfter(future);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(50_000);
    expect(result!).toBeLessThanOrEqual(61_000);
  });

  it("returns 0 for HTTP-date in the past", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });
});
