import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, YouTrackClient } from "../client.js";
import { YouTrackError } from "../errors.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function okResponse(data: unknown = { id: 1 }) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  };
}

function errorResponse(
  status: number,
  body: Record<string, string> = {},
  opts?: { headers?: Record<string, string>; statusText?: string },
) {
  return {
    ok: false,
    status,
    statusText: opts?.statusText ?? `Error ${status}`,
    headers: new Headers(opts?.headers),
    json: () => Promise.resolve(body),
  };
}

function binaryResponse(data: ArrayBuffer, contentType = "image/png") {
  return {
    ok: true,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: () => Promise.resolve(data),
  };
}

/**
 * Helper that starts an async operation and advances fake timers to complete it,
 * preventing unhandled promise rejection warnings.
 */
async function drainWithTimers<T>(promise: Promise<T>): Promise<T> {
  // Attach a no-op catch to prevent Node's unhandled rejection warning
  // while we advance timers. The original promise chain is preserved.
  const guarded = promise.catch(() => {});
  await vi.runAllTimersAsync();
  await guarded;
  return promise;
}

// ─── YouTrackClient constructor ───────────────────────────────────────────

describe("YouTrackClient", () => {
  it("strips trailing slash from baseUrl", () => {
    const client = new YouTrackClient({ baseUrl: "https://example.com/", token: "test" });
    expect(client.baseUrl).toBe("https://example.com");
  });

  it("constructs apiBase from baseUrl", () => {
    const client = new YouTrackClient({ baseUrl: "https://yt.example.com", token: "t" });
    expect(client.baseUrl).toBe("https://yt.example.com");
  });
});

// ─── createClient ─────────────────────────────────────────────────────────

describe("createClient", () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it("throws when YOUTRACK_BASE_URL is missing", () => {
    delete process.env.YOUTRACK_BASE_URL;
    delete process.env.YOUTRACK_TOKEN;
    expect(() => createClient()).toThrow("YOUTRACK_BASE_URL is required");
  });

  it("throws when YOUTRACK_TOKEN is missing", () => {
    process.env.YOUTRACK_BASE_URL = "https://example.com";
    delete process.env.YOUTRACK_TOKEN;
    expect(() => createClient()).toThrow("YOUTRACK_TOKEN is required");
  });

  it("throws when YOUTRACK_BASE_URL is invalid", () => {
    process.env.YOUTRACK_BASE_URL = "not-a-url";
    process.env.YOUTRACK_TOKEN = "test-token";
    expect(() => createClient()).toThrow("not a valid URL");
  });

  it("creates a client with valid env vars", () => {
    process.env.YOUTRACK_BASE_URL = "https://example.youtrack.cloud";
    process.env.YOUTRACK_TOKEN = "perm:test";
    const client = createClient();
    expect(client).toBeInstanceOf(YouTrackClient);
    expect(client.baseUrl).toBe("https://example.youtrack.cloud");
  });
});

// ─── Caching ──────────────────────────────────────────────────────────────

describe("YouTrackClient.get caching", () => {
  let client: YouTrackClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new YouTrackClient({ baseUrl: "https://example.com", token: "test" });
    fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("caches responses when ttlMs is provided", async () => {
    const r1 = await client.get("/test", undefined, 60_000);
    const r2 = await client.get("/test", undefined, 60_000);
    expect(r1).toEqual({ id: 1 });
    expect(r2).toEqual({ id: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cache when ttlMs is omitted", async () => {
    await client.get("/test");
    await client.get("/test");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("caches null values correctly (MISS sentinel)", async () => {
    fetchSpy.mockResolvedValue(okResponse(null));
    const r1 = await client.get("/null", undefined, 60_000);
    const r2 = await client.get("/null", undefined, 60_000);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("different params produce different cache keys", async () => {
    await client.get("/test", { fields: "a" }, 60_000);
    await client.get("/test", { fields: "b" }, 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest entry when cache exceeds capacity", async () => {
    // Fill cache to MAX_CACHE_ENTRIES (1000) and verify eviction of oldest
    for (let i = 0; i < 1001; i++) {
      fetchSpy.mockResolvedValueOnce(okResponse({ i }));
      await client.get(`/entry-${i}`, undefined, 60_000);
    }
    // All 1001 fetches happened
    expect(fetchSpy).toHaveBeenCalledTimes(1001);

    // Entry 0 should have been evicted (oldest) — re-fetching it will trigger a new request
    fetchSpy.mockResolvedValueOnce(okResponse({ i: 0 }));
    await client.get("/entry-0", undefined, 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1002);

    // Entry 1 should also have been evicted (second oldest)
    fetchSpy.mockResolvedValueOnce(okResponse({ i: 1 }));
    await client.get("/entry-1", undefined, 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1003);

    // Entry 999 should still be cached (recent)
    await client.get("/entry-999", undefined, 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1003); // no new fetch
  });

  it("expired entries cause a cache miss", async () => {
    vi.useFakeTimers();
    try {
      await client.get("/expire", undefined, 1_000);
      vi.advanceTimersByTime(2_000);
      await client.get("/expire", undefined, 1_000);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refresh bypasses cache and updates it", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ v: 1 }));
    fetchSpy.mockResolvedValueOnce(okResponse({ v: 2 }));

    await client.get("/ref", undefined, 60_000);
    const refreshed = await client.refresh("/ref", undefined, 60_000);
    expect(refreshed).toEqual({ v: 2 });

    // Subsequent get hits refreshed cache
    const cached = await client.get("/ref", undefined, 60_000);
    expect(cached).toEqual({ v: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ─── Retry behavior ───────────────────────────────────────────────────────

describe("YouTrackClient.get retry behavior", () => {
  let client: YouTrackClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new YouTrackClient({ baseUrl: "https://example.com", token: "test" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries on 500 and succeeds on second attempt", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.resolve(errorResponse(500));
      return Promise.resolve(okResponse({ success: true }));
    }));
    const result = await drainWithTimers(client.get("/retry"));
    expect(result).toEqual({ success: true });
    expect(attempt).toBe(2);
  });

  it("does not retry on 404 (semantic error)", async () => {
    const spy = vi.fn().mockResolvedValue(errorResponse(404));
    vi.stubGlobal("fetch", spy);
    await expect(client.get("/missing")).rejects.toThrow(YouTrackError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 401", async () => {
    const spy = vi.fn().mockResolvedValue(errorResponse(401));
    vi.stubGlobal("fetch", spy);
    await expect(client.get("/auth")).rejects.toThrow(YouTrackError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 (rate limit)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.resolve(errorResponse(429, {}, { headers: { "retry-after": "0" } }));
      return Promise.resolve(okResponse());
    }));
    const result = await drainWithTimers(client.get("/rate"));
    expect(result).toEqual({ id: 1 });
    expect(attempt).toBe(2);
  });

  it("retries on network error (TypeError)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve(okResponse());
    }));
    const result = await drainWithTimers(client.get("/net"));
    expect(result).toEqual({ id: 1 });
    expect(attempt).toBe(2);
  });

  it("retries on timeout (DOMException TimeoutError)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new DOMException("aborted", "TimeoutError"));
      return Promise.resolve(okResponse());
    }));
    const result = await drainWithTimers(client.get("/timeout"));
    expect(result).toEqual({ id: 1 });
    expect(attempt).toBe(2);
  });

  it("throws with retryCount after exhausting all retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(502)));
    try {
      await drainWithTimers(client.get("/exhaust"));
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as YouTrackError;
      expect(err).toBeInstanceOf(YouTrackError);
      expect(err.retryCount).toBe(2);
      expect(err.isTransient).toBe(true);
    }
  });

  it("preserves retryAfterMs through re-throw after exhausting retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      errorResponse(429, {}, { headers: { "retry-after": "120" } }),
    ));
    try {
      await drainWithTimers(client.get("/rate-exhaust"));
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as YouTrackError;
      expect(err).toBeInstanceOf(YouTrackError);
      expect(err.retryCount).toBe(2);
      expect(err.retryAfterMs).toBe(120_000);
    }
  });
});

// ─── Health degradation ───────────────────────────────────────────────────

describe("YouTrackClient health degradation", () => {
  let client: YouTrackClient;
  let degradationSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new YouTrackClient({ baseUrl: "https://example.com", token: "test" });
    degradationSpy = vi.fn();
    client.onDegradation = degradationSpy;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function causeTransientFailure() {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(503)));
    try {
      await drainWithTimers(client.get(`/fail-${Math.random()}`));
    } catch { /* expected */ }
  }

  async function causeSemanticFailure() {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(404)));
    try { await client.get(`/nf-${Math.random()}`); } catch { /* expected */ }
  }

  async function causeSuccess() {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    await client.get(`/ok-${Math.random()}`);
  }

  it("fires warning at 3 consecutive transient failures", async () => {
    for (let i = 0; i < 3; i++) await causeTransientFailure();
    expect(degradationSpy).toHaveBeenCalledTimes(1);
    expect(degradationSpy).toHaveBeenCalledWith("warning", expect.stringContaining("unstable"));
  });

  it("fires error at 5 consecutive transient failures", async () => {
    for (let i = 0; i < 5; i++) await causeTransientFailure();
    expect(degradationSpy).toHaveBeenCalledTimes(2);
    expect(degradationSpy).toHaveBeenCalledWith("error", expect.stringContaining("unreachable"));
  });

  it("resets counter on successful response", async () => {
    await causeTransientFailure();
    await causeTransientFailure();
    await causeSuccess(); // resets counter
    for (let i = 0; i < 3; i++) await causeTransientFailure();
    expect(degradationSpy).toHaveBeenCalledTimes(1);
    expect(degradationSpy).toHaveBeenCalledWith("warning", expect.any(String));
  });

  it("resets counter on semantic (4xx) error", async () => {
    await causeTransientFailure();
    await causeTransientFailure();
    await causeSemanticFailure(); // 4xx resets
    for (let i = 0; i < 3; i++) await causeTransientFailure();
    expect(degradationSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onDegradation is not set", async () => {
    client.onDegradation = undefined;
    for (let i = 0; i < 5; i++) await causeTransientFailure();
    // no error thrown — onDegradation?.() gracefully handles undefined
  });

  it("includes baseUrl and last error in degradation message", async () => {
    await causeTransientFailure();
    await causeTransientFailure();
    await causeTransientFailure();
    const message = degradationSpy.mock.calls[0][1] as string;
    expect(message).toContain("https://example.com");
    expect(message).toContain("3 consecutive");
  });
});

// ─── getBytes ─────────────────────────────────────────────────────────────

describe("YouTrackClient.getBytes", () => {
  let client: YouTrackClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new YouTrackClient({ baseUrl: "https://example.com", token: "test" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("downloads and base64-encodes binary data", async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(binaryResponse(data)));

    const result = await client.getBytes("/thumb");
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toBe(Buffer.from(data).toString("base64"));
  });

  it("resolves relative URLs against baseUrl", async () => {
    const spy = vi.fn().mockResolvedValue(binaryResponse(new ArrayBuffer(4)));
    vi.stubGlobal("fetch", spy);
    await client.getBytes("/attachments/thumb/123");
    expect(spy.mock.calls[0][0]).toBe("https://example.com/attachments/thumb/123");
  });

  it("uses absolute URLs as-is", async () => {
    const spy = vi.fn().mockResolvedValue(binaryResponse(new ArrayBuffer(4)));
    vi.stubGlobal("fetch", spy);
    await client.getBytes("https://cdn.example.com/image.png");
    expect(spy.mock.calls[0][0]).toBe("https://cdn.example.com/image.png");
  });

  it("prepends slash for relative URLs without leading slash", async () => {
    const spy = vi.fn().mockResolvedValue(binaryResponse(new ArrayBuffer(4)));
    vi.stubGlobal("fetch", spy);
    await client.getBytes("attachments/thumb/123");
    expect(spy.mock.calls[0][0]).toBe("https://example.com/attachments/thumb/123");
  });

  it("extracts MIME type and strips parameters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg; charset=utf-8" }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    }));
    expect((await client.getBytes("/img")).mimeType).toBe("image/jpeg");
  });

  it("defaults to application/octet-stream when content-type is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    }));
    expect((await client.getBytes("/noct")).mimeType).toBe("application/octet-stream");
  });

  it("retries on transient failure and succeeds", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.resolve(errorResponse(502));
      return Promise.resolve(binaryResponse(new ArrayBuffer(4)));
    }));
    const result = await drainWithTimers(client.getBytes("/retry"));
    expect(result.mimeType).toBe("image/png");
    expect(attempt).toBe(2);
  });

  it("throws YouTrackError on non-transient failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(403)));
    await expect(client.getBytes("/forbidden")).rejects.toThrow(YouTrackError);
  });

  it("throws YouTrackError on timeout after retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.reject(new DOMException("aborted", "TimeoutError")),
    ));
    try {
      await drainWithTimers(client.getBytes("/slow"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(YouTrackError);
    }
  });

  it("throws 'cancelled' when signal aborted during fetch", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    }));
    await expect(client.getBytes("/cancel", controller.signal))
      .rejects.toThrow("Attachment download cancelled");
  });

  it("throws network error when fetch fails without abort", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ));
    try {
      await drainWithTimers(client.getBytes("/net-err"));
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as YouTrackError;
      expect(err).toBeInstanceOf(YouTrackError);
      expect(err.message).toContain("ECONNREFUSED");
      expect(err.isTransient).toBe(true);
    }
  });

  it("sends Authorization header", async () => {
    const spy = vi.fn().mockResolvedValue(binaryResponse(new ArrayBuffer(4)));
    vi.stubGlobal("fetch", spy);
    await client.getBytes("/auth-check");
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer test");
  });
});

// ─── Query parameter construction ─────────────────────────────────────────

describe("YouTrackClient.get URL construction", () => {
  let client: YouTrackClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new YouTrackClient({ baseUrl: "https://yt.test", token: "t" });
    fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("builds correct API URL with path and params", async () => {
    await client.get("/issues", { fields: "id,summary", $top: 10 });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("https://yt.test/api/issues");
    expect(url).toContain("fields=id%2Csummary");
    expect(url).toContain("%24top=10");
  });

  it("handles path without params", async () => {
    await client.get("/users/me");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://yt.test/api/users/me");
  });

  it("sends correct headers", async () => {
    await client.get("/test");
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers.Accept).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer t");
  });
});

// ─── Error body parsing ──────────────────────────────────────────────────

describe("YouTrackClient error body parsing", () => {
  let client: YouTrackClient;

  beforeEach(() => {
    client = new YouTrackClient({ baseUrl: "https://example.com", token: "test" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses error_description from JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      errorResponse(400, { error_description: "Invalid query syntax" }),
    ));
    await expect(client.get("/bad")).rejects.toThrow("Invalid query syntax");
  });

  it("falls back to error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      errorResponse(400, { error: "bad_request" }),
    ));
    await expect(client.get("/bad")).rejects.toThrow("bad_request");
  });

  it("falls back to message field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      errorResponse(400, { message: "Validation failed" }),
    ));
    await expect(client.get("/bad")).rejects.toThrow("Validation failed");
  });

  it("falls back to statusText on unparseable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
      json: () => Promise.reject(new Error("not json")),
    }));
    await expect(client.get("/broken")).rejects.toThrow("Bad Request");
  });
});

// ─── Client-initiated cancellation ──────────────────────────────────────

describe("YouTrackClient AbortSignal cancellation", () => {
  let client: YouTrackClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new YouTrackClient({ baseUrl: "https://example.com", token: "test" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("throws non-transient error when signal is already aborted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    const controller = new AbortController();
    controller.abort();

    await expect(client.get("/test", undefined, undefined, controller.signal))
      .rejects.toThrow("Request cancelled by client");
  });

  it("does not retry when signal is aborted between retry attempts", async () => {
    const controller = new AbortController();
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        // Abort after first failure
        controller.abort();
        return Promise.resolve(errorResponse(503));
      }
      return Promise.resolve(okResponse());
    }));

    try {
      await drainWithTimers(client.get("/test", undefined, undefined, controller.signal));
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as YouTrackError;
      expect(err).toBeInstanceOf(YouTrackError);
      // Should not have retried — only 1 attempt
      expect(attempt).toBe(1);
    }
  });

  it("falls back to timeout-only when AbortSignal.any is unavailable (Node.js 18)", async () => {
    // Temporarily remove AbortSignal.any to simulate Node.js 18
    const originalAny = AbortSignal.any;
    // @ts-expect-error — testing runtime where .any doesn't exist
    delete AbortSignal.any;
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
      const controller = new AbortController();

      // Should not throw — falls back to AbortSignal.timeout only
      const result = await client.get("/test", undefined, undefined, controller.signal);
      expect(result).toEqual({ id: 1 });
    } finally {
      AbortSignal.any = originalAny;
    }
  });

  it("returns 'Request cancelled' when fetch throws non-timeout error while signal is aborted", async () => {
    // This tests the fetchJson branch at line 302-303:
    // fetch throws a generic error (not TimeoutError) AND signal is already aborted
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error("The operation was aborted"));
    }));

    await expect(client.get("/test", undefined, undefined, controller.signal))
      .rejects.toThrow("Request cancelled by client");
  });
});
