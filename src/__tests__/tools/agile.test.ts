import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../../fields.js";
import { registerAgileTools } from "../../tools/agile.js";
import { makeExtra, mockClient, mockServer } from "./helpers.js";

describe("agile tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerAgileTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 5 agile tools", () => {
    expect(tools.size).toBe(5);
  });

  describe("get_agile_boards", () => {
    it("calls /agiles with default fields", async () => {
      await tools.get("get_agile_boards")!({ limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles",
        { fields: F.AGILE_LIST, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });

    it("uses custom fields when provided", async () => {
      await tools.get("get_agile_boards")!({ fields: "id,name", limit: 10, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles",
        expect.objectContaining({ fields: "id,name" }),
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_agile_board", () => {
    it("calls correct path with encoded agileId", async () => {
      await tools.get("get_agile_board")!({ agileId: "board-1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/board-1",
        { fields: F.AGILE_DETAIL },
        undefined,
        extra.signal,
      );
    });

    it("encodes special characters in agileId", async () => {
      await tools.get("get_agile_board")!({ agileId: "board/special" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/board%2Fspecial",
        { fields: F.AGILE_DETAIL },
        undefined,
        extra.signal,
      );
    });
  });

  describe("error propagation", () => {
    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));

      const result = await tools.get("get_agile_board")!({ agileId: "nope" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
    });
  });

  describe("get_agile_sprints", () => {
    it("calls correct path with pagination", async () => {
      await tools.get("get_agile_sprints")!({ agileId: "b1", limit: 10, skip: 5 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/b1/sprints",
        { fields: F.SPRINT, $top: 10, $skip: 5 },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_agile_sprint", () => {
    it("calls correct nested path", async () => {
      await tools.get("get_agile_sprint")!({ agileId: "b1", sprintId: "s1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/b1/sprints/s1",
        { fields: F.SPRINT },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_sprint_issues", () => {
    it("calls correct path with SPRINT_ISSUE fields", async () => {
      await tools.get("get_sprint_issues")!({ agileId: "b1", sprintId: "s1", limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/agiles/b1/sprints/s1/issues",
        { fields: F.SPRINT_ISSUE, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });
  });
});
