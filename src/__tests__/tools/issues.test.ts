import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { TTL_HOUR } from "../../client.js";
import * as F from "../../fields.js";
import { registerIssueTools } from "../../tools/issues.js";
import { makeExtra, mockClient, mockServer, parseOkResult } from "./helpers.js";

describe("issue tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([{ id: "1", idReadable: "FOO-1", summary: "Test" }]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerIssueTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers all 9 issue tools", () => {
    expect(tools.size).toBe(9);
    expect(tools.has("search_issues")).toBe(true);
    expect(tools.has("get_issue")).toBe(true);
    expect(tools.has("get_issue_comments")).toBe(true);
    expect(tools.has("get_issue_links")).toBe(true);
    expect(tools.has("get_issue_activities")).toBe(true);
    expect(tools.has("get_issue_attachments")).toBe(true);
    expect(tools.has("get_issue_tags")).toBe(true);
    expect(tools.has("get_work_items")).toBe(true);
    expect(tools.has("get_issue_link_types")).toBe(true);
  });

  describe("search_issues", () => {
    it("calls /issues with default params", async () => {
      const handler = tools.get("search_issues")!;
      await handler({ limit: 25, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues",
        { fields: F.ISSUE_LIST, $top: 25, $skip: 0 },
        undefined,
        extra.signal,
      );
    });

    it("passes query when provided", async () => {
      const handler = tools.get("search_issues")!;
      await handler({ query: "project: FOO #Unresolved", limit: 10, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues",
        expect.objectContaining({ query: "project: FOO #Unresolved", $top: 10 }),
        undefined,
        extra.signal,
      );
    });

    it("uses custom fields when provided", async () => {
      const handler = tools.get("search_issues")!;
      await handler({ fields: "id,summary", limit: 25, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues",
        expect.objectContaining({ fields: "id,summary" }),
        undefined,
        extra.signal,
      );
    });

    it("returns ok result with data", async () => {
      const handler = tools.get("search_issues")!;
      const result = await handler({ limit: 25, skip: 0 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result);
      expect(data).toEqual([{ id: "1", idReadable: "FOO-1", summary: "Test" }]);
    });
  });

  describe("get_issue", () => {
    it("calls correct path with encoded issueId", async () => {
      const handler = tools.get("get_issue")!;
      await handler({ issueId: "FOO-123" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-123",
        { fields: F.ISSUE_DETAIL },
        undefined,
        extra.signal,
      );
    });

    it("encodes special characters in issueId", async () => {
      const handler = tools.get("get_issue")!;
      await handler({ issueId: "FOO/BAR-1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO%2FBAR-1",
        { fields: F.ISSUE_DETAIL },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_issue_comments", () => {
    it("calls correct path with pagination", async () => {
      const handler = tools.get("get_issue_comments")!;
      await handler({ issueId: "FOO-1", limit: 10, skip: 5 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/comments",
        { fields: F.COMMENT, $top: 10, $skip: 5 },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_issue_links", () => {
    it("calls correct path with default fields", async () => {
      const handler = tools.get("get_issue_links")!;
      await handler({ issueId: "FOO-1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/links",
        { fields: F.LINK },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_issue_activities", () => {
    it("passes category and time filters", async () => {
      const handler = tools.get("get_issue_activities")!;
      await handler({
        issueId: "FOO-1",
        categories: "CommentsCategory",
        author: "me",
        start: 1000,
        end: 2000,
        reverse: true,
        limit: 20,
        skip: 0,
      }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/activities",
        expect.objectContaining({
          categories: "CommentsCategory",
          author: "me",
          start: 1000,
          end: 2000,
          reverse: true,
          $top: 20,
        }),
        undefined,
        extra.signal,
      );
    });

    it("omits optional filters when not provided", async () => {
      const handler = tools.get("get_issue_activities")!;
      await handler({ issueId: "FOO-1", reverse: false, limit: 42, skip: 0 }, extra);
      const call = getSpy.mock.calls[0];
      const params = call[1];
      expect(params).not.toHaveProperty("categories");
      expect(params).not.toHaveProperty("author");
      expect(params).not.toHaveProperty("start");
      expect(params).not.toHaveProperty("end");
    });
  });

  describe("get_issue_attachments", () => {
    it("calls correct path with defaults", async () => {
      const handler = tools.get("get_issue_attachments")!;
      await handler({ issueId: "FOO-1", limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/attachments",
        { fields: F.ATTACHMENT, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_issue_tags", () => {
    it("calls correct path with F.TAG fields", async () => {
      const handler = tools.get("get_issue_tags")!;
      await handler({ issueId: "FOO-1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/tags",
        { fields: F.TAG },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_work_items", () => {
    it("calls correct path", async () => {
      const handler = tools.get("get_work_items")!;
      await handler({ issueId: "FOO-1", limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/timeTracking/workItems",
        { fields: F.WORK_ITEM, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });
  });

  describe("get_issue_link_types", () => {
    it("calls with TTL_HOUR cache", async () => {
      const handler = tools.get("get_issue_link_types")!;
      await handler({}, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issueLinkTypes",
        { fields: F.LINK_TYPE },
        TTL_HOUR,
        extra.signal,
      );
    });
  });

  describe("error propagation", () => {
    it("returns isError with YouTrackError hint on 404", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Issue not found", 404, false));

      const handler = tools.get("get_issue")!;
      const result = await handler({ issueId: "NOPE-999" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
      expect(result.content[0].text).toContain("Issue not found");
      expect(result.content[0].text).toContain("Resource not found");
    });

    it("returns isError with hint on 400 (bad query)", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Bad query syntax", 400, false));

      const handler = tools.get("search_issues")!;
      const result = await handler({ query: "bad:::query", limit: 25, skip: 0 }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 400]");
      expect(result.content[0].text).toContain("inspect_project_schema");
    });

    it("returns isError with retry info on transient failure", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Service unavailable", 503, true, 2));

      const handler = tools.get("get_issue_comments")!;
      const result = await handler({ issueId: "FOO-1", limit: 10, skip: 0 }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("retried 2×");
      expect(result.content[0].text).toContain("further retries will not help");
    });

    it("returns isError for generic Error", async () => {
      getSpy.mockRejectedValueOnce(new Error("Network failure"));

      const handler = tools.get("get_issue_links")!;
      const result = await handler({ issueId: "FOO-1" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Network failure");
    });

    it("returns isError for non-Error throw", async () => {
      getSpy.mockRejectedValueOnce("raw string error");

      const handler = tools.get("get_issue_tags")!;
      const result = await handler({ issueId: "FOO-1" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("raw string error");
    });

    it("returns isError with auth hint on 401", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Unauthorized", 401, false));

      const handler = tools.get("get_work_items")!;
      const result = await handler({ issueId: "FOO-1", limit: 42, skip: 0 }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication failed");
    });
  });
});
