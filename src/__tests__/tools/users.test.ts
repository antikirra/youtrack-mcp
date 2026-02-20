import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { TTL_HOUR, TTL_SESSION } from "../../client.js";
import * as F from "../../fields.js";
import { registerUserTools } from "../../tools/users.js";
import { makeExtra, mockClient, mockServer } from "./helpers.js";

describe("user tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient({ id: "u1", login: "admin" });
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerUserTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 5 user tools", () => {
    expect(tools.size).toBe(5);
  });

  describe("get_current_user", () => {
    it("calls /users/me with TTL_SESSION", async () => {
      await tools.get("get_current_user")!({}, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/users/me",
        { fields: F.USER },
        TTL_SESSION,
        extra.signal,
      );
    });
  });

  describe("get_users", () => {
    it("passes query filter when provided", async () => {
      await tools.get("get_users")!({ query: "john", limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/users",
        expect.objectContaining({ query: "john" }),
        undefined,
        extra.signal,
      );
    });

    it("omits query when not provided", async () => {
      await tools.get("get_users")!({ limit: 42, skip: 0 }, extra);
      const params = getSpy.mock.calls[0][1];
      expect(params).not.toHaveProperty("query");
    });
  });

  describe("get_user", () => {
    it("calls correct path", async () => {
      await tools.get("get_user")!({ userId: "admin" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/users/admin",
        { fields: F.USER },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_saved_queries", () => {
    it("calls /savedQueries without cache", async () => {
      await tools.get("get_saved_queries")!({ limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/savedQueries",
        { fields: F.SAVED_QUERY, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_tags", () => {
    it("calls /tags with TTL_HOUR cache", async () => {
      await tools.get("get_tags")!({ limit: 200, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/tags",
        { fields: F.TAG, $top: 200, $skip: 0 },
        TTL_HOUR,
        extra.signal,
      );
    });

    it("always passes $skip (even when 0) for consistent cache keys", async () => {
      await tools.get("get_tags")!({ limit: 200, skip: 0 }, extra);
      const params = getSpy.mock.calls[0][1];
      expect(params).toHaveProperty("$skip", 0);
    });

    it("includes $skip when > 0", async () => {
      await tools.get("get_tags")!({ limit: 200, skip: 50 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/tags",
        expect.objectContaining({ $skip: 50 }),
        TTL_HOUR,
        extra.signal,
      );
    });

    it("uses custom fields when provided", async () => {
      await tools.get("get_tags")!({ fields: "id,name", limit: 10, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/tags",
        expect.objectContaining({ fields: "id,name", $top: 10 }),
        TTL_HOUR,
        extra.signal,
      );
    });
  });

  describe("error propagation", () => {
    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Unauthorized", 401, false));

      const result = await tools.get("get_current_user")!({}, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 401]");
    });
  });
});
