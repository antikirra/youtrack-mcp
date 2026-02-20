import { describe, expect, it } from "vitest";
import { YouTrackError } from "../errors.js";
import { enc, fail, ok, run } from "../utils.js";

describe("enc", () => {
  it("passes through simple strings", () => {
    expect(enc("FOO-123")).toBe("FOO-123");
  });

  it("encodes path-breaking characters", () => {
    expect(enc("user/name")).toBe("user%2Fname");
    expect(enc("a b")).toBe("a%20b");
    expect(enc("key=val&x=y")).toContain("%3D");
    expect(enc("key=val&x=y")).toContain("%26");
  });

  it("encodes unicode", () => {
    const encoded = enc("привет");
    expect(encoded).not.toBe("привет");
    expect(decodeURIComponent(encoded)).toBe("привет");
  });

  it("handles empty string", () => {
    expect(enc("")).toBe("");
  });
});

describe("ok", () => {
  it("wraps object as JSON text content without isError flag", () => {
    const result = ok({ id: 1, name: "test" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: '{"id":1,"name":"test"}' });
    expect(result.isError).toBeUndefined();
  });

  it("guards against JSON.stringify(undefined) returning undefined", () => {
    // This was a P0 bug: ok(undefined) would produce { text: undefined }
    // which violates the MCP text content type contract
    const result = ok(undefined);
    const text = (result.content[0] as { text: string }).text;
    expect(typeof text).toBe("string");
    expect(text).toBe("null");
  });

  it("serializes null as the string 'null'", () => {
    expect((ok(null).content[0] as { text: string }).text).toBe("null");
  });

  it("produces compact JSON without whitespace (token-efficient)", () => {
    const result = ok({ a: [1, { b: "c" }], d: true });
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain(" ");
    expect(text).not.toContain("\n");
    expect(JSON.parse(text)).toEqual({ a: [1, { b: "c" }], d: true });
  });

  it("handles empty collections", () => {
    expect((ok([]).content[0] as { text: string }).text).toBe("[]");
    expect((ok({}).content[0] as { text: string }).text).toBe("{}");
  });
});

describe("fail", () => {
  it("sets isError: true on the result", () => {
    const result = fail(new Error("any"));
    expect(result.isError).toBe(true);
  });

  it("formats YouTrackError with status code, message, and hint", () => {
    const err = new YouTrackError("Not found", 404, false);
    const text = (fail(err).content[0] as { text: string }).text;
    // Verify the full toToolText structure, not just substrings
    expect(text).toMatch(/^\[YouTrack 404\] Not found — .+$/);
  });

  it("includes actionable hint in YouTrackError output", () => {
    const err = new YouTrackError("fail", 401, false);
    const text = (fail(err).content[0] as { text: string }).text;
    expect(text).toContain("Authentication failed");
    expect(text).toContain("YOUTRACK_TOKEN");
  });

  it("includes retry exhaustion info for retried YouTrackError", () => {
    const err = new YouTrackError("timeout", 503, true, 2);
    const text = (fail(err).content[0] as { text: string }).text;
    expect(text).toContain("retried 2×");
    expect(text).toContain("further retries will not help");
  });

  it("uses Error.message for generic errors", () => {
    expect((fail(new Error("oops")).content[0] as { text: string }).text).toBe("oops");
  });

  it("uses String() coercion for non-Error values", () => {
    expect((fail("string error").content[0] as { text: string }).text).toBe("string error");
    expect((fail(42).content[0] as { text: string }).text).toBe("42");
    expect((fail(null).content[0] as { text: string }).text).toBe("null");
    expect((fail(undefined).content[0] as { text: string }).text).toBe("undefined");
  });
});

describe("run", () => {
  it("wraps successful return value in ok()", async () => {
    const result = await run(async () => ({ x: 1 }));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ x: 1 });
  });

  it("wraps thrown Error in fail()", async () => {
    const result = await run(async () => { throw new Error("boom"); });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("boom");
  });

  it("preserves YouTrackError structure through fail()", async () => {
    const result = await run(async () => {
      throw new YouTrackError("bad query", 400, false);
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("[YouTrack 400]");
    expect(text).toContain("bad query");
    expect(text).toContain("inspect_project_schema");
  });

  it("handles non-Error throws via String coercion", async () => {
    const result = await run(async () => { throw "raw string"; });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("raw string");
  });

  it("converts undefined return to 'null' (P0 guard)", async () => {
    const result = await run(async () => undefined);
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe("null");
  });

  it("never returns isError and data simultaneously", async () => {
    const success = await run(async () => "data");
    expect(success.isError).toBeUndefined();

    const failure = await run(async () => { throw new Error("e"); });
    expect(failure.isError).toBe(true);
  });
});
