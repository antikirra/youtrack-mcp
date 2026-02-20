import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../../fields.js";
import { registerReportTools } from "../../tools/reports.js";
import { makeExtra, mockClient, mockServer } from "./helpers.js";

describe("report tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerReportTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 2 report tools", () => {
    expect(tools.size).toBe(2);
  });

  describe("get_reports", () => {
    it("calls /reports with default fields", async () => {
      await tools.get("get_reports")!({ limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/reports",
        { fields: F.REPORT, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_report", () => {
    it("calls correct path with encoded reportId", async () => {
      await tools.get("get_report")!({ reportId: "r-123" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/reports/r-123",
        { fields: F.REPORT },
        undefined,
        extra.signal,
      );
    });
  });

  describe("error propagation", () => {
    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));

      const result = await tools.get("get_report")!({ reportId: "nope" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
    });
  });
});
