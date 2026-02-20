import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../../fields.js";
import { registerArticleTools } from "../../tools/articles.js";
import { makeExtra, mockClient, mockServer, parseOkResult } from "./helpers.js";

describe("article tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([{ id: "1", idReadable: "KB-T-1", summary: "Test Article" }]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerArticleTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 3 article tools", () => {
    expect(tools.size).toBe(3);
    expect(tools.has("search_articles")).toBe(true);
    expect(tools.has("get_article")).toBe(true);
    expect(tools.has("get_article_comments")).toBe(true);
  });

  describe("search_articles", () => {
    it("calls /articles with default params when no query", async () => {
      const handler = tools.get("search_articles")!;
      await handler({ limit: 25, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles",
        { fields: F.ARTICLE_LIST, $top: 25, $skip: 0 },
        undefined,
        extra.signal,
      );
    });

    it("passes query param when provided", async () => {
      const handler = tools.get("search_articles")!;
      await handler({ query: "authentication setup", limit: 10, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles",
        expect.objectContaining({ query: "authentication setup", $top: 10 }),
        undefined,
        extra.signal,
      );
    });

    it("does not include query param when query is omitted", async () => {
      const handler = tools.get("search_articles")!;
      await handler({ limit: 25, skip: 0 }, extra);
      const params = getSpy.mock.calls[0][1];
      expect(params).not.toHaveProperty("query");
    });

    it("uses custom fields when provided", async () => {
      const handler = tools.get("search_articles")!;
      await handler({ fields: "id,summary", limit: 25, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles",
        expect.objectContaining({ fields: "id,summary" }),
        undefined,
        extra.signal,
      );
    });

    it("returns ok result with data", async () => {
      const handler = tools.get("search_articles")!;
      const result = await handler({ limit: 25, skip: 0 }, extra) as { content: Array<{ text: string }> };
      const data = parseOkResult(result);
      expect(data).toEqual([{ id: "1", idReadable: "KB-T-1", summary: "Test Article" }]);
    });

    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Bad query", 400, false));

      const handler = tools.get("search_articles")!;
      const result = await handler({ query: "bad:::query", limit: 25, skip: 0 }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 400]");
    });
  });

  describe("get_article", () => {
    it("calls correct path with ARTICLE_DETAIL fields", async () => {
      const handler = tools.get("get_article")!;
      await handler({ articleId: "KB-T-1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles/KB-T-1",
        { fields: F.ARTICLE_DETAIL },
        undefined,
        extra.signal,
      );
    });

    it("encodes special characters in articleId", async () => {
      const handler = tools.get("get_article")!;
      await handler({ articleId: "KB/T-1" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles/KB%2FT-1",
        { fields: F.ARTICLE_DETAIL },
        undefined,
        extra.signal,
      );
    });

    it("returns isError on 404", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Article not found", 404, false));

      const handler = tools.get("get_article")!;
      const result = await handler({ articleId: "NOPE-1" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
      expect(result.content[0].text).toContain("Resource not found");
    });
  });

  describe("get_article_comments", () => {
    it("calls correct path with pagination and COMMENT fields", async () => {
      const handler = tools.get("get_article_comments")!;
      await handler({ articleId: "KB-T-1", limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles/KB-T-1/comments",
        { fields: F.COMMENT, $top: 42, $skip: 0 },
        undefined,
        extra.signal,
      );
    });

    it("passes custom fields projection", async () => {
      const handler = tools.get("get_article_comments")!;
      await handler({ articleId: "KB-T-1", fields: "id,text", limit: 10, skip: 5 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/articles/KB-T-1/comments",
        { fields: "id,text", $top: 10, $skip: 5 },
        undefined,
        extra.signal,
      );
    });

    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Forbidden", 403, false));

      const handler = tools.get("get_article_comments")!;
      const result = await handler({ articleId: "KB-T-1", limit: 42, skip: 0 }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 403]");
    });
  });
});
