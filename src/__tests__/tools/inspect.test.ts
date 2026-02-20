import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { REFERENCE_PAGE_SIZE, TTL_5MIN, TTL_HOUR } from "../../client.js";
import * as F from "../../fields.js";
import { registerInspectTools } from "../../tools/inspect.js";
import { makeExtra, mockClient, mockServer, parseOkResult } from "./helpers.js";

describe("inspect tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerInspectTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 4 inspect tools", () => {
    expect(tools.size).toBe(4);
  });

  describe("inspect_project_schema", () => {
    it("fetches project + customFields in parallel", async () => {
      getSpy
        .mockResolvedValueOnce({ id: "p1", shortName: "FOO" })
        .mockResolvedValueOnce([{ id: "cf1", name: "State" }]);

      const result = await tools.get("inspect_project_schema")!({ projectId: "FOO" }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as { project: unknown; customFields: unknown; queryHints: unknown };

      expect(getSpy).toHaveBeenCalledTimes(2);
      // First call: project detail
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects/FOO",
        { fields: F.PROJECT_DETAIL },
        TTL_5MIN,
        extra.signal,
      );
      // Second call: custom fields
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects/FOO/customFields",
        { fields: F.PROJECT_SCHEMA_FIELD, $top: REFERENCE_PAGE_SIZE },
        TTL_5MIN,
        extra.signal,
      );
      // Result includes queryHints
      expect(data.queryHints).toBeDefined();
      expect(data.project).toEqual({ id: "p1", shortName: "FOO" });
      expect(data.customFields).toEqual([{ id: "cf1", name: "State" }]);
    });
  });

  describe("inspect_board_structure", () => {
    it("calls with BOARD_STRUCTURE fields, no cache", async () => {
      await tools.get("inspect_board_structure")!({ agileId: "b1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/b1",
        { fields: F.BOARD_STRUCTURE },
        undefined,
        extra.signal,
      );
    });

    it("encodes special characters in agileId", async () => {
      await tools.get("inspect_board_structure")!({ agileId: "board/special" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/board%2Fspecial",
        { fields: F.BOARD_STRUCTURE },
        undefined,
        extra.signal,
      );
    });
  });

  describe("error propagation", () => {
    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));

      const result = await tools.get("inspect_board_structure")!({ agileId: "nope" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
    });
  });

  describe("get_global_custom_fields", () => {
    it("calls with TTL_HOUR cache", async () => {
      await tools.get("get_global_custom_fields")!({ limit: REFERENCE_PAGE_SIZE, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/customFieldSettings/customFields",
        { fields: F.GLOBAL_CUSTOM_FIELD, $top: REFERENCE_PAGE_SIZE, $skip: 0 },
        TTL_HOUR,
        extra.signal,
      );
    });

    it("always passes $skip (even when 0) for consistent cache keys", async () => {
      await tools.get("get_global_custom_fields")!({ limit: 200, skip: 0 }, extra);
      const params = getSpy.mock.calls[0][1];
      expect(params).toHaveProperty("$skip", 0);
    });

    it("includes $skip when > 0", async () => {
      await tools.get("get_global_custom_fields")!({ limit: 200, skip: 10 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/customFieldSettings/customFields",
        expect.objectContaining({ $skip: 10 }),
        TTL_HOUR,
        extra.signal,
      );
    });
  });

  describe("get_custom_field_bundle", () => {
    it("calls correct bundle path with type and id", async () => {
      getSpy.mockResolvedValueOnce([{ id: "v1", name: "Open" }]);
      const result = await tools.get("get_custom_field_bundle")!({
        bundleType: "state",
        bundleId: "bundle-1",
        includeArchived: false,
        limit: 200,
        skip: 0,
      }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as { bundleType: string; bundleId: string; values: unknown };

      expect(getSpy).toHaveBeenCalledWith(
        "/admin/customFieldSettings/bundles/state/bundle-1/values",
        { fields: F.BUNDLE_VALUE, $top: 200, $skip: 0 },
        TTL_HOUR,
        extra.signal,
      );
      expect(data.bundleType).toBe("state");
      expect(data.bundleId).toBe("bundle-1");
    });

    it("passes includeArchived when true", async () => {
      await tools.get("get_custom_field_bundle")!({
        bundleType: "enum",
        bundleId: "b1",
        includeArchived: true,
        limit: 200,
        skip: 0,
      }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ includeArchived: true }),
        TTL_HOUR,
        extra.signal,
      );
    });
  });
});
