import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../../fields.js";
import { registerImageTools } from "../../tools/images.js";
import { makeExtra, mockClient, mockServer } from "./helpers.js";

describe("image tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let getBytesSpy: ReturnType<typeof mockClient>["getBytesSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    getBytesSpy = cli.getBytesSpy;
    extra = makeExtra();
    registerImageTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 1 image tool", () => {
    expect(tools.size).toBe(1);
    expect(tools.has("get_issue_images")).toBe(true);
  });

  describe("get_issue_images", () => {
    it("returns 'no images' message when no image attachments", async () => {
      getSpy.mockResolvedValueOnce([]); // attachments
      getSpy.mockResolvedValueOnce([]); // comments

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("No image attachments found");
    });

    it("fetches thumbnails using getBytes in thumbnail mode", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "screenshot.png", mimeType: "image/png", size: 1024, thumbnailURL: "/thumb/a1" },
      ]);
      getSpy.mockResolvedValueOnce([]); // comments

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

      expect(getBytesSpy).toHaveBeenCalledWith("/thumb/a1", extra.signal);
      // Should have summary + label + image
      expect(result.content.length).toBe(3);
      expect(result.content[0].text).toContain("1 image(s)");
      expect(result.content[2].type).toBe("image");
      expect(result.content[2].data).toBe("base64data");
    });

    it("uses field constants from fields.ts for thumbnail mode", async () => {
      getSpy.mockResolvedValueOnce([]);
      getSpy.mockResolvedValueOnce([]);

      await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra);

      // First call: attachments
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/attachments",
        { fields: F.IMAGE_ATTACHMENT_THUMB, $top: 30 },
        undefined,
        extra.signal,
      );
      // Second call: comments
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/comments",
        { fields: F.IMAGE_COMMENT_THUMB, $top: 200 },
        undefined,
        extra.signal,
      );
    });

    it("uses full-resolution field constants", async () => {
      getSpy.mockResolvedValueOnce([]);

      await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: false,
        includeCommentImages: false,
        limit: 10,
      }, extra);

      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/attachments",
        { fields: F.IMAGE_ATTACHMENT_FULL, $top: 30 },
        undefined,
        extra.signal,
      );
    });

    it("parses base64Content data URI in full-resolution mode", async () => {
      getSpy.mockResolvedValueOnce([
        {
          id: "a1",
          name: "screen.png",
          mimeType: "image/png",
          size: 512,
          base64Content: "data:image/png;base64,iVBOR==",
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: false,
        includeCommentImages: false,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

      expect(result.content.length).toBe(3); // summary + label + image
      expect(result.content[2].type).toBe("image");
      expect(result.content[2].data).toBe("iVBOR==");
      expect(result.content[2].mimeType).toBe("image/png");
    });

    it("skips non-image attachments", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "doc.pdf", mimeType: "application/pdf", size: 1024 },
        { id: "a2", name: "img.jpg", mimeType: "image/jpeg", size: 2048, thumbnailURL: "/thumb/a2" },
      ]);
      getSpy.mockResolvedValueOnce([]); // comments

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string }> };

      expect(getBytesSpy).toHaveBeenCalledTimes(1);
      expect(result.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining("1 image(s)") }));
    });

    it("skips removed attachments", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "old.png", mimeType: "image/png", size: 100, removed: true, thumbnailURL: "/t" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("No image attachments found");
    });

    it("includes images from comments when includeCommentImages is true", async () => {
      getSpy.mockResolvedValueOnce([]); // no direct attachments
      getSpy.mockResolvedValueOnce([
        {
          id: "c1",
          author: { login: "user1", fullName: "User One" },
          created: 1700000000000,
          attachments: [
            { id: "a1", name: "comment-img.png", mimeType: "image/png", size: 512, thumbnailURL: "/thumb/a1" },
          ],
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("1 image(s)");
      // Label should mention the comment author
      expect(result.content[1].text).toContain("User One");
    });

    it("respects limit on number of images", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "1.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
        { id: "a2", name: "2.png", mimeType: "image/png", size: 100, thumbnailURL: "/t2" },
        { id: "a3", name: "3.png", mimeType: "image/png", size: 100, thumbnailURL: "/t3" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 2,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      // Only 2 images downloaded
      expect(getBytesSpy).toHaveBeenCalledTimes(2);
      // Summary mentions "showing first 2 of 3"
      expect(result.content[0].text).toContain("showing first 2 of 3");
    });

    it("handles download failures gracefully", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "fail.png", mimeType: "image/png", size: 100, thumbnailURL: "/fail" },
      ]);
      getSpy.mockResolvedValueOnce([]);
      getBytesSpy.mockRejectedValueOnce(new Error("Network error"));

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      // Should have summary + error text (no image block)
      const texts = result.content.filter(c => c.type === "text").map(c => c.text);
      expect(texts.some(t => t?.includes("download failed"))).toBe(true);
    });

    it("sends progress notifications when progressToken is present", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const extraWithProgress = makeExtra();
      extraWithProgress._meta = { progressToken: "tok-1" };

      await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extraWithProgress);

      expect(extraWithProgress.sendNotification).toHaveBeenCalled();
    });

    it("does not send progress notifications without progressToken", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra);

      expect(extra.sendNotification).not.toHaveBeenCalled();
    });

    it("falls back to url when thumbnailURL is absent", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 200, url: "/full/a1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; data?: string }> };

      expect(getBytesSpy).toHaveBeenCalledWith("/full/a1", extra.signal);
      expect(result.content[2].type).toBe("image");
    });

    it("shows 'no URL available' when both thumbnailURL and url are absent", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100 },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      const texts = result.content.filter(c => c.type === "text").map(c => c.text);
      expect(texts.some(t => t?.includes("no URL available"))).toBe(true);
    });

    it("shows 'base64Content not available' in full-res mode without base64Content", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100 },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: false,
        includeCommentImages: false,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      const texts = result.content.filter(c => c.type === "text").map(c => c.text);
      expect(texts.some(t => t?.includes("base64Content not available"))).toBe(true);
    });

    it("shows parse error for invalid data URI format", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100, base64Content: "not-a-data-uri" },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: false,
        includeCommentImages: false,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      const texts = result.content.filter(c => c.type === "text").map(c => c.text);
      expect(texts.some(t => t?.includes("could not parse base64Content format"))).toBe(true);
    });

    it("formats size correctly for 0 bytes", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "empty.png", mimeType: "image/png", size: 0, thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      // Label should show "0B" not "unknown size"
      expect(result.content[1].text).toContain("0B");
      expect(result.content[1].text).not.toContain("unknown size");
    });

    it("formats size as KB and MB", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "kb.png", mimeType: "image/png", size: 2048, thumbnailURL: "/t1" },
        { id: "a2", name: "mb.png", mimeType: "image/png", size: 2 * 1024 * 1024, thumbnailURL: "/t2" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[1].text).toContain("2KB");
      expect(result.content[3].text).toContain("2.0MB");
    });

    it("shows 'unknown size' when size is undefined", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "nosize.png", mimeType: "image/png", thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[1].text).toContain("unknown size");
    });

    it("formats direct attachment source correctly", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "direct.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[1].text).toContain("direct issue attachment");
    });

    it("formats comment source with login fallback when fullName is absent", async () => {
      getSpy.mockResolvedValueOnce([]); // no direct attachments
      getSpy.mockResolvedValueOnce([
        {
          id: "c1",
          author: { login: "jdoe" },
          created: 1700000000000,
          attachments: [
            { id: "a1", name: "img.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
          ],
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[1].text).toContain("comment by jdoe");
    });

    it("formats comment source with unknown author and date", async () => {
      getSpy.mockResolvedValueOnce([]); // no direct attachments
      getSpy.mockResolvedValueOnce([
        {
          id: "c1",
          attachments: [
            { id: "a1", name: "img.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
          ],
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[1].text).toContain("comment by unknown");
      expect(result.content[1].text).toContain("unknown date");
    });

    it("skips removed comment attachments", async () => {
      getSpy.mockResolvedValueOnce([]); // no direct attachments
      getSpy.mockResolvedValueOnce([
        {
          id: "c1",
          author: { login: "user1" },
          attachments: [
            { id: "a1", name: "removed.png", mimeType: "image/png", size: 100, removed: true, thumbnailURL: "/t1" },
            { id: "a2", name: "active.png", mimeType: "image/png", size: 100, thumbnailURL: "/t2" },
          ],
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("1 image(s)");
      expect(getBytesSpy).toHaveBeenCalledTimes(1);
    });

    it("returns fail result when client.get throws", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
    });

    it("uses default name 'image' when attachment name is missing", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[1].text).toContain("[image ");
    });

    it("skips comments without attachments array", async () => {
      getSpy.mockResolvedValueOnce([]); // no direct
      getSpy.mockResolvedValueOnce([
        { id: "c1", author: { login: "user1" } },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("No image attachments found");
    });

    it("includes full-resolution comment images with field constants", async () => {
      getSpy.mockResolvedValueOnce([]); // direct attachments
      getSpy.mockResolvedValueOnce([
        {
          id: "c1",
          author: { login: "user1", fullName: "User One" },
          created: 1700000000000,
          attachments: [
            { id: "a1", name: "img.png", mimeType: "image/png", size: 100, base64Content: "data:image/png;base64,abc==" },
          ],
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: false,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

      // Verify full-res field constants were used
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/attachments",
        { fields: F.IMAGE_ATTACHMENT_FULL, $top: 30 },
        undefined,
        extra.signal,
      );
      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-1/comments",
        { fields: F.IMAGE_COMMENT_FULL, $top: 200 },
        undefined,
        extra.signal,
      );
      // Verify image parsed correctly
      expect(result.content[2].type).toBe("image");
      expect(result.content[2].data).toBe("abc==");
    });

    it("encodes issueId with special characters in URL", async () => {
      getSpy.mockResolvedValueOnce([]);
      getSpy.mockResolvedValueOnce([]);

      await tools.get("get_issue_images")!({
        issueId: "FOO/BAR-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra);

      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO%2FBAR-1/attachments",
        expect.any(Object),
        undefined,
        extra.signal,
      );
    });

    it("shows thumbnail mode in summary", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
      ]);
      getSpy.mockResolvedValueOnce([]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("mode: thumbnails");
    });

    it("shows full-resolution mode in summary", async () => {
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "img.png", mimeType: "image/png", size: 100, base64Content: "data:image/png;base64,x==" },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: false,
        includeCommentImages: false,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      expect(result.content[0].text).toContain("mode: full-resolution");
    });

    it("deduplicates comment attachments already present in issue-level response", async () => {
      // /issues/{id}/attachments returns ALL attachments including comment-attached ones.
      // When includeCommentImages is true, comment attachments are fetched separately
      // from /comments. Without deduplication, the same image would appear twice.
      getSpy.mockResolvedValueOnce([
        // Direct issue attachment (no comment field)
        { id: "a1", name: "direct.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
        // Comment attachment returned by /attachments endpoint (has comment field)
        { id: "a2", name: "from-comment.png", mimeType: "image/png", size: 200, thumbnailURL: "/t2", comment: { id: "c1" } },
      ]);
      getSpy.mockResolvedValueOnce([
        {
          id: "c1",
          author: { login: "user1", fullName: "User One" },
          created: 1700000000000,
          attachments: [
            // Same attachment a2 returned by the comment endpoint
            { id: "a2", name: "from-comment.png", mimeType: "image/png", size: 200, thumbnailURL: "/t2" },
          ],
        },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      // Should have exactly 2 unique images, not 3
      expect(result.content[0].text).toContain("2 image(s)");
      expect(getBytesSpy).toHaveBeenCalledTimes(2);
    });

    it("keeps comment-attached images from /attachments when includeCommentImages is false", async () => {
      // When includeCommentImages is false, we don't fetch comments separately,
      // so comment-attached images from /attachments should be kept.
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "direct.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
        { id: "a2", name: "from-comment.png", mimeType: "image/png", size: 200, thumbnailURL: "/t2", comment: { id: "c1" } },
      ]);

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: false,
        limit: 10,
      }, extra) as { content: Array<{ type: string; text?: string }> };

      // Both images should be returned — no comment fetch, no dedup needed
      expect(result.content[0].text).toContain("2 image(s)");
      expect(getBytesSpy).toHaveBeenCalledTimes(2);
    });

    it("stops downloading when AbortSignal is aborted mid-loop", async () => {
      // 3 images available, but we abort after the first download starts
      getSpy.mockResolvedValueOnce([
        { id: "a1", name: "1.png", mimeType: "image/png", size: 100, thumbnailURL: "/t1" },
        { id: "a2", name: "2.png", mimeType: "image/png", size: 100, thumbnailURL: "/t2" },
        { id: "a3", name: "3.png", mimeType: "image/png", size: 100, thumbnailURL: "/t3" },
      ]);
      getSpy.mockResolvedValueOnce([]); // comments

      const controller = new AbortController();
      const abortExtra = makeExtra({ signal: controller.signal });

      // After first getBytes call, abort the signal
      getBytesSpy.mockImplementation(async () => {
        controller.abort();
        return { data: "base64data", mimeType: "image/png" };
      });

      const result = await tools.get("get_issue_images")!({
        issueId: "FOO-1",
        useThumbnails: true,
        includeCommentImages: true,
        limit: 10,
      }, abortExtra) as { content: Array<{ type: string }> };

      // Should have stopped after first image — not all 3 downloaded
      expect(getBytesSpy).toHaveBeenCalledTimes(1);
      // Result still has the summary + the one image that completed
      const imageBlocks = result.content.filter(c => c.type === "image");
      expect(imageBlocks.length).toBe(1);
    });
  });
});
