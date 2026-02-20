import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { REFERENCE_PAGE_SIZE, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { enc, fail, READ_ONLY } from "../utils.js";

/**
 * Image extraction tool.
 *
 * Screenshots in comments are often the richest source of context for issue analysis.
 * This tool fetches all image attachments from an issue and its comments,
 * returning them as MCP image content blocks so Claude can visually analyse them.
 *
 * Two fetch modes:
 *
 *   useThumbnails: true (default)
 *     — Downloads thumbnailURL via HTTP with auth headers.
 *     — Smaller payload, faster, sufficient for visual overview.
 *     — Falls back to base64Content if thumbnailURL is absent.
 *
 *   useThumbnails: false
 *     — Requests base64Content field directly from the YouTrack REST API.
 *     — Single round-trip per attachment, full resolution.
 *     — Use when screenshots contain readable text that needs analysis.
 *     — Format from API: "data:image/png;base64,[data]" — parsed automatically.
 */

interface RawAttachment {
  id: string;
  name?: string;
  mimeType?: string | null;
  size?: number;
  url?: string | null;
  thumbnailURL?: string | null;
  base64Content?: string | null;
  removed?: boolean;
  comment?: {
    id: string;
    author?: { login?: string; fullName?: string };
    created?: number;
  } | null;
}

interface RawComment {
  id: string;
  author?: { login?: string; fullName?: string };
  created?: number;
  attachments?: RawAttachment[];
}

const IMAGE_MIME_RE = /^image\//i;

/**
 * Parses a YouTrack base64Content Data URI.
 * Format: "data:[mimeType];base64,[data]"
 */
function parseDataUri(dataUri: string): { mimeType: string; data: string } | null {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function formatSize(bytes?: number): string {
  if (bytes == null) return "unknown size";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatSource(attachment: RawAttachment): string {
  if (!attachment.comment) return "direct issue attachment";
  const author = attachment.comment.author?.fullName
    ?? attachment.comment.author?.login
    ?? "unknown";
  const when = attachment.comment.created
    ? new Date(attachment.comment.created).toISOString().slice(0, 10)
    : "unknown date";
  return `comment by ${author} on ${when}`;
}

export function registerImageTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("get_issue_images", {
    title: "Get Issue Images",
    description:
      "Download all image attachments from a YouTrack issue and its comments, " +
      "returning them as MCP image content for direct visual analysis. " +
      "Screenshots in comments provide critical context that text alone cannot convey. " +
      "\n\n" +
      "useThumbnails: true (default) — fetches smaller previews, good for overview. " +
      "useThumbnails: false — fetches full-resolution via base64Content field, " +
      "use this when screenshots contain text that needs to be read. " +
      "\n\n" +
      "Each image is preceded by a text block describing its filename, size, and source " +
      "(which comment it came from or if it's a direct attachment).",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      useThumbnails: z.boolean().default(true).describe(
        "true = smaller thumbnails (overview); false = full-resolution base64Content (for reading text)"
      ),
      includeCommentImages: z.boolean().default(true).describe(
        "Include images from comment attachments (usually the most informative)"
      ),
      limit: z.number().int().min(1).max(20).default(10).describe(
        "Maximum number of images to return"
      ),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, useThumbnails, includeCommentImages, limit }, extra) => {
    // Progress token: if provided by the client, send per-image download notifications.
    // This lets the orchestrator show a live progress indicator for long image fetches.
    const progressToken = extra._meta?.progressToken;
    const sendProgress = progressToken !== undefined
      ? (progress: number, total: number, message?: string) =>
          extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress, total, ...(message ? { message } : {}) },
          }).catch(() => {})
      : undefined;

    try {
      const issueAttachments = await client.get<RawAttachment[]>(
        `/issues/${enc(issueId)}/attachments`,
        {
          fields: useThumbnails ? F.IMAGE_ATTACHMENT_THUMB : F.IMAGE_ATTACHMENT_FULL,
          $top: limit * 3,
        },
        undefined,
        extra.signal,
      );
      // When includeCommentImages is on, comment attachments will be collected
      // from the /comments endpoint below (with richer attribution context).
      // Exclude them here to avoid duplicates — /attachments returns ALL attachments
      // including comment-attached ones (identifiable by non-null `comment` field).
      const allAttachments: RawAttachment[] = includeCommentImages
        ? issueAttachments.filter(a => !a.removed && !a.comment)
        : issueAttachments.filter(a => !a.removed);

      if (includeCommentImages) {
        const comments = await client.get<RawComment[]>(
          `/issues/${enc(issueId)}/comments`,
          {
            fields: useThumbnails ? F.IMAGE_COMMENT_THUMB : F.IMAGE_COMMENT_FULL,
            $top: REFERENCE_PAGE_SIZE,
          },
          undefined,
          extra.signal,
        );
        for (const comment of comments) {
          for (const att of comment.attachments ?? []) {
            if (!att.removed) {
              allAttachments.push({
                ...att,
                comment: {
                  id: comment.id,
                  author: comment.author,
                  created: comment.created,
                },
              });
            }
          }
        }
      }

      // Filter to images only, respect limit
      const images = allAttachments
        .filter(a => a.mimeType && IMAGE_MIME_RE.test(a.mimeType))
        .slice(0, limit);

      if (images.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No image attachments found on issue ${issueId}.`,
          }],
        };
      }

      const content: CallToolResult["content"] = [];

      for (let i = 0; i < images.length; i++) {
        // Abort download loop early if the client cancelled the request
        if (extra.signal.aborted) break;

        const img = images[i];
        const label =
          `[${img.name ?? "image"} · ${formatSize(img.size)} · ${formatSource(img)}]`;

        // Notify client of per-image download progress
        sendProgress?.(i, images.length, `Downloading ${img.name ?? "image"} (${i + 1}/${images.length})`);

        if (useThumbnails) {
          // Download thumbnail or fall back to full URL
          const fetchUrl = img.thumbnailURL ?? img.url;
          if (!fetchUrl) {
            content.push({ type: "text", text: `${label} — no URL available` });
            continue;
          }
          try {
            const { data, mimeType } = await client.getBytes(fetchUrl, extra.signal);
            content.push({ type: "text", text: label });
            content.push({ type: "image", data, mimeType });
          } catch (e) {
            content.push({
              type: "text",
              text: `${label} — download failed: ${(e as Error).message}`,
            });
          }
        } else {
          // Parse base64Content Data URI returned by YouTrack API
          if (!img.base64Content) {
            content.push({ type: "text", text: `${label} — base64Content not available` });
            continue;
          }
          const parsed = parseDataUri(img.base64Content);
          if (!parsed) {
            content.push({
              type: "text",
              text: `${label} — could not parse base64Content format`,
            });
            continue;
          }
          content.push({ type: "text", text: label });
          content.push({ type: "image", data: parsed.data, mimeType: parsed.mimeType });
        }
      }

      // Final progress notification: all images processed
      sendProgress?.(images.length, images.length);

      // Summary header prepended to the content
      const totalImages = allAttachments.filter(a => a.mimeType && IMAGE_MIME_RE.test(a.mimeType)).length;
      const summary =
        `Found ${images.length} image(s) on issue ${issueId}` +
        (images.length < totalImages ? ` (showing first ${limit} of ${totalImages})` : "") +
        ` · mode: ${useThumbnails ? "thumbnails" : "full-resolution"}`;

      return { content: [{ type: "text", text: summary }, ...content] };

    } catch (e) {
      return fail(e);
    }
  });
}
