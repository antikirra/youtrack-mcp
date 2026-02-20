import { describe, expect, it, vi } from "vitest";
import type { YouTrackClient } from "../client.js";
import { issueIdCompleter } from "../completions.js";

function mockClient(getResult: unknown = []) {
  const getSpy = vi.fn().mockResolvedValue(getResult);
  const client = {
    baseUrl: "https://example.com",
    get: getSpy,
    refresh: vi.fn(),
    getBytes: vi.fn(),
    onDegradation: undefined,
  } as unknown as YouTrackClient;
  return { client, getSpy };
}

describe("issueIdCompleter", () => {
  it("returns empty array for empty value", async () => {
    const { client } = mockClient();
    const completer = issueIdCompleter(client);
    const result = await completer("");
    expect(result).toEqual([]);
  });

  it("searches issues and returns idReadable values", async () => {
    const { client, getSpy } = mockClient([
      { idReadable: "FOO-1" },
      { idReadable: "FOO-2" },
      { idReadable: "FOO-10" },
    ]);
    const completer = issueIdCompleter(client);
    const result = await completer("FOO-");

    expect(getSpy).toHaveBeenCalledWith(
      "/issues",
      { fields: "idReadable", query: "FOO-", $top: 10 },
    );
    expect(result).toEqual(["FOO-1", "FOO-2", "FOO-10"]);
  });

  it("filters out falsy idReadable values", async () => {
    const { client } = mockClient([
      { idReadable: "FOO-1" },
      { idReadable: "" },
      { idReadable: null },
    ]);
    const completer = issueIdCompleter(client);
    const result = await completer("FOO");
    expect(result).toEqual(["FOO-1"]);
  });

  it("returns empty array on API error", async () => {
    const { client, getSpy } = mockClient();
    getSpy.mockRejectedValueOnce(new Error("Network error"));
    const completer = issueIdCompleter(client);
    const result = await completer("FOO-");
    expect(result).toEqual([]);
  });
});
