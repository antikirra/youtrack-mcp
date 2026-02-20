import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YouTrackClient } from "../client.js";
import { scheduleWarmup } from "../warmup.js";

function mockClient() {
  return {
    baseUrl: "https://example.com",
    get: vi.fn().mockResolvedValue({}),
    refresh: vi.fn().mockResolvedValue({ login: "admin", fullName: "Admin User" }),
    getBytes: vi.fn(),
    onDegradation: undefined,
  } as unknown as YouTrackClient & { refresh: ReturnType<typeof vi.fn> };
}

function mockLog() {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> &
    ((level: "info" | "warning" | "error", data: string) => void);
}

describe("scheduleWarmup", () => {
  let stopFn: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    stopFn = undefined;
  });

  afterEach(() => {
    // Always clean up timers
    stopFn?.();
    vi.useRealTimers();
  });

  it("calls refresh for current-user first, then batch entries", async () => {
    const client = mockClient();
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);

    // Flush microtasks to let the fire-and-forget startup warmup complete
    await vi.advanceTimersByTimeAsync(0);

    // current-user + 2 projects + link-types + global-custom-fields + tags = 6 refresh calls
    expect(client.refresh.mock.calls.length).toBeGreaterThanOrEqual(6);

    // First call should be /users/me
    expect(client.refresh.mock.calls[0][0]).toBe("/users/me");

    // Remaining calls should include reference data paths
    const paths = client.refresh.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(paths).toContain("/admin/projects");
    expect(paths).toContain("/issueLinkTypes");
    expect(paths).toContain("/admin/customFieldSettings/customFields");
    expect(paths).toContain("/tags");
  });

  it("logs authenticated user on success", async () => {
    const client = mockClient();
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);
    await vi.advanceTimersByTimeAsync(0);

    const infoCalls = log.mock.calls.filter((c: string[]) => c[0] === "info");
    expect(infoCalls.some((c: string[]) => c[1].includes("Admin User"))).toBe(true);
  });

  it("logs error when current-user fetch fails", async () => {
    const client = mockClient();
    client.refresh.mockRejectedValueOnce(new Error("401 Unauthorized"));
    // remaining entries succeed
    client.refresh.mockResolvedValue({});
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);
    await vi.advanceTimersByTimeAsync(0);

    const errorCalls = log.mock.calls.filter((c: string[]) => c[0] === "error");
    expect(errorCalls.some((c: string[]) => c[1].includes("failed to authenticate"))).toBe(true);
  });

  it("logs warning on partial warmup failure", async () => {
    const client = mockClient();
    // current-user succeeds
    client.refresh.mockResolvedValueOnce({ login: "admin", fullName: "Admin" });
    // One entry fails
    client.refresh.mockRejectedValueOnce(new Error("timeout"));
    // Rest succeed
    client.refresh.mockResolvedValue({});

    const log = mockLog();
    stopFn = scheduleWarmup(client, log);
    await vi.advanceTimersByTimeAsync(0);

    const warningCalls = log.mock.calls.filter((c: string[]) => c[0] === "warning");
    expect(warningCalls.length).toBeGreaterThan(0);
    expect(warningCalls.some((c: string[]) => c[1].includes("partial"))).toBe(true);
  });

  it("returns cleanup function that cancels timers", async () => {
    const client = mockClient();
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);
    await vi.advanceTimersByTimeAsync(0);

    const callsAfterStartup = client.refresh.mock.calls.length;

    // Stop all background timers
    stopFn();
    stopFn = undefined;

    // Advance time past refresh intervals — no new calls should happen
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(client.refresh.mock.calls.length).toBe(callsAfterStartup);
  });

  it("background refresh runs at 5-minute intervals", async () => {
    const client = mockClient();
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);

    // Let startup warmup complete
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStartup = client.refresh.mock.calls.length;

    // Advance by 5 minutes — should trigger the 5-min refresh batch
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(client.refresh.mock.calls.length).toBeGreaterThan(callsAfterStartup);
  });

  it("logs warning when background refresh fails", async () => {
    const client = mockClient();
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);
    await vi.advanceTimersByTimeAsync(0);

    // Make all refresh calls fail from now on
    client.refresh.mockRejectedValue(new Error("connection reset"));

    // Advance by 5 minutes to trigger background refresh
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const warningCalls = log.mock.calls.filter((c: string[]) => c[0] === "warning");
    expect(warningCalls.some((c: string[]) => c[1].includes("Background refresh failed"))).toBe(true);
  });

  it("logs error when startup warmup throws unexpectedly", async () => {
    const client = mockClient();
    // Make refresh throw a non-standard error that isn't caught by individual handlers
    client.refresh.mockImplementation(() => { throw null; });
    const log = mockLog();

    stopFn = scheduleWarmup(client, log);
    await vi.advanceTimersByTimeAsync(0);

    const errorCalls = log.mock.calls.filter((c: string[]) => c[0] === "error");
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it("skips concurrent background refresh when previous is still running", async () => {
    const client = mockClient();
    const log = mockLog();

    // Make refresh block until we resolve it
    let resolveRefresh!: () => void;
    const slowRefresh = new Promise<Record<string, never>>(r => {
      resolveRefresh = () => r({});
    });

    stopFn = scheduleWarmup(client, log);
    // Let startup warmup complete
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStartup = client.refresh.mock.calls.length;

    // Make subsequent refresh calls slow
    client.refresh.mockReturnValue(slowRefresh);

    // Trigger first background refresh (5 min interval)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const callsAfterFirst = client.refresh.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(callsAfterStartup);

    // Trigger second interval tick while first is still running
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    // Should NOT have more calls — concurrency guard blocks
    expect(client.refresh.mock.calls.length).toBe(callsAfterFirst);

    // Resolve the slow refresh
    resolveRefresh();
    await vi.advanceTimersByTimeAsync(0);

    // Now next interval should run again
    client.refresh.mockResolvedValue({});
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(client.refresh.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
