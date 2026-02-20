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

  it("registers all 12 issue tools", () => {
    expect(tools.size).toBe(12);
    expect(tools.has("search_issues")).toBe(true);
    expect(tools.has("get_issue")).toBe(true);
    expect(tools.has("get_issue_comments")).toBe(true);
    expect(tools.has("get_issue_links")).toBe(true);
    expect(tools.has("get_issue_activities")).toBe(true);
    expect(tools.has("get_issue_attachments")).toBe(true);
    expect(tools.has("get_issue_tags")).toBe(true);
    expect(tools.has("get_work_items")).toBe(true);
    expect(tools.has("get_issue_link_types")).toBe(true);
    expect(tools.has("batch_get_issues")).toBe(true);
    expect(tools.has("batch_get_comments")).toBe(true);
    expect(tools.has("batch_get_activities")).toBe(true);
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

  describe("batch_get_issues", () => {
    it("fetches each issue individually and returns array", async () => {
      const handler = tools.get("batch_get_issues")!;
      const result = await handler({ issueIds: ["FOO-1", "FOO-2"] }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; issue: unknown }>;
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe("FOO-1");
      expect(data[1].id).toBe("FOO-2");
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it("calls correct path with ISSUE_DETAIL fields for each id", async () => {
      const handler = tools.get("batch_get_issues")!;
      await handler({ issueIds: ["FOO-1"] }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1",
        { fields: F.ISSUE_DETAIL },
        undefined,
        extra.signal,
      );
    });

    it("isolates failures — one error does not abort the batch", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockResolvedValueOnce({ id: "1", idReadable: "FOO-1" });
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));
      getSpy.mockResolvedValueOnce({ id: "3", idReadable: "FOO-3" });

      const handler = tools.get("batch_get_issues")!;
      const result = await handler({ issueIds: ["FOO-1", "FOO-2", "FOO-3"] }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; issue?: unknown; error?: string }>;

      expect(data).toHaveLength(3);
      expect(data[0]).toMatchObject({ id: "FOO-1", issue: { idReadable: "FOO-1" } });
      expect(data[1]).toMatchObject({ id: "FOO-2", error: expect.stringContaining("[YouTrack 404]") });
      expect(data[2]).toMatchObject({ id: "FOO-3", issue: { idReadable: "FOO-3" } });
    });

    it("uses custom fields when provided", async () => {
      const handler = tools.get("batch_get_issues")!;
      await handler({ issueIds: ["FOO-1"], fields: "id,summary" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1",
        { fields: "id,summary" },
        undefined,
        extra.signal,
      );
    });

    it("captures generic Error message in error field", async () => {
      getSpy.mockRejectedValueOnce(new Error("Network failure"));

      const handler = tools.get("batch_get_issues")!;
      const result = await handler({ issueIds: ["FOO-1"] }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", error: "Network failure" });
    });

    it("captures raw non-Error throw in error field", async () => {
      getSpy.mockRejectedValueOnce("raw error string");

      const handler = tools.get("batch_get_issues")!;
      const result = await handler({ issueIds: ["FOO-1"] }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", error: "raw error string" });
    });
  });

  describe("batch_get_comments", () => {
    it("fetches comments for each issue and returns array", async () => {
      const handler = tools.get("batch_get_comments")!;
      const result = await handler({ issueIds: ["FOO-1", "FOO-2"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; comments: unknown }>;
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe("FOO-1");
      expect(data[1].id).toBe("FOO-2");
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it("calls correct path with default fields and limit", async () => {
      const handler = tools.get("batch_get_comments")!;
      await handler({ issueIds: ["FOO-1"], limit: 42 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/comments",
        { fields: F.COMMENT, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });

    it("isolates failures per issue", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockResolvedValueOnce([{ id: "c1" }]);
      getSpy.mockRejectedValueOnce(new YouTrackError("Forbidden", 403, false));

      const handler = tools.get("batch_get_comments")!;
      const result = await handler({ issueIds: ["FOO-1", "FOO-2"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; comments?: unknown; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", comments: [{ id: "c1" }] });
      expect(data[1]).toMatchObject({ id: "FOO-2", error: expect.stringContaining("[YouTrack 403]") });
    });

    it("captures generic Error message in error field", async () => {
      getSpy.mockRejectedValueOnce(new Error("Timeout"));

      const handler = tools.get("batch_get_comments")!;
      const result = await handler({ issueIds: ["FOO-1"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", error: "Timeout" });
    });

    it("captures raw non-Error throw in error field", async () => {
      getSpy.mockRejectedValueOnce("raw error string");

      const handler = tools.get("batch_get_comments")!;
      const result = await handler({ issueIds: ["FOO-1"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", error: "raw error string" });
    });
  });

  describe("batch_get_activities", () => {
    it("fetches activities for each issue and returns array", async () => {
      const handler = tools.get("batch_get_activities")!;
      const result = await handler({ issueIds: ["FOO-1"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; activities: unknown }>;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe("FOO-1");
    });

    it("calls correct path with ACTIVITY fields", async () => {
      const handler = tools.get("batch_get_activities")!;
      await handler({ issueIds: ["FOO-1"], limit: 42 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/activities",
        { fields: F.ACTIVITY, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });

    it("includes categories filter when provided", async () => {
      const handler = tools.get("batch_get_activities")!;
      await handler({ issueIds: ["FOO-1"], categories: "CommentsCategory", limit: 42 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/activities",
        expect.objectContaining({ categories: "CommentsCategory" }),
        undefined,
        extra.signal,
      );
    });

    it("isolates failures per issue", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockResolvedValueOnce([{ id: "a1" }]);
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));

      const handler = tools.get("batch_get_activities")!;
      const result = await handler({ issueIds: ["FOO-1", "FOO-2"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; activities?: unknown; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", activities: [{ id: "a1" }] });
      expect(data[1]).toMatchObject({ id: "FOO-2", error: expect.stringContaining("[YouTrack 404]") });
    });

    it("captures generic Error message in error field", async () => {
      getSpy.mockRejectedValueOnce(new Error("Connection reset"));

      const handler = tools.get("batch_get_activities")!;
      const result = await handler({ issueIds: ["FOO-1"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", error: "Connection reset" });
    });

    it("captures raw non-Error throw in error field", async () => {
      getSpy.mockRejectedValueOnce("raw error string");

      const handler = tools.get("batch_get_activities")!;
      const result = await handler({ issueIds: ["FOO-1"], limit: 42 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result) as Array<{ id: string; error?: string }>;

      expect(data[0]).toMatchObject({ id: "FOO-1", error: "raw error string" });
    });
  });
});
