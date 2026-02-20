import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { YouTrackClient, TTL_5MIN, TTL_HOUR, TTL_SESSION } from "./client.js";
import * as F from "./fields.js";

/**
 * MCP Resources expose YouTrack reference data as URI-addressable documents.
 * Clients can read them on demand without consuming tool call slots.
 *
 * Static resources (stable reference data, cached):
 *   youtrack://projects         – all accessible projects       (5 min cache)
 *   youtrack://link-types       – issue link type catalog        (1 hr cache)
 *   youtrack://current-user     – authenticated user identity    (session cache)
 *
 * Dynamic resource template (live data, no cache):
 *   youtrack://issues/{issueId} – full details of a specific issue
 */
export function registerResources(server: McpServer, client: YouTrackClient) {

  // ── youtrack://projects ──────────────────────────────────────────────────
  server.registerResource(
    "projects",
    "youtrack://projects",
    {
      description: "All YouTrack projects accessible to the current user.",
      mimeType: "application/json",
    },
    async (uri: URL, extra) => {
      const projects = await client.get(
        "/admin/projects",
        { fields: F.PROJECT_DETAIL, $top: 200 },
        TTL_5MIN,
        extra.signal,
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(projects) }],
      };
    },
  );

  // ── youtrack://link-types ────────────────────────────────────────────────
  server.registerResource(
    "link-types",
    "youtrack://link-types",
    {
      description: "Issue link type catalog: depends on, duplicates, relates to, etc.",
      mimeType: "application/json",
    },
    async (uri: URL, extra) => {
      const types = await client.get(
        "/issueLinkTypes",
        { fields: F.LINK_TYPE },
        TTL_HOUR,
        extra.signal,
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(types) }],
      };
    },
  );

  // ── youtrack://current-user ──────────────────────────────────────────────
  server.registerResource(
    "current-user",
    "youtrack://current-user",
    {
      description: "Identity of the currently authenticated YouTrack user.",
      mimeType: "application/json",
    },
    async (uri: URL, extra) => {
      const user = await client.get("/users/me", { fields: F.USER }, TTL_SESSION, extra.signal);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(user) }],
      };
    },
  );

  // ── youtrack://issues/{issueId} ──────────────────────────────────────────
  //
  // URI template variable completions: when a client supports completions,
  // typing the beginning of an issue ID (e.g. "FOO-") will trigger a live
  // YouTrack search and return matching issue IDs as suggestions.
  server.registerResource(
    "issue",
    new ResourceTemplate("youtrack://issues/{issueId}", {
      list: undefined,
      complete: {
        issueId: async (value) => {
          if (!value) return [];
          try {
            const issues = await client.get<Array<{ idReadable: string }>>(
              "/issues",
              { fields: "idReadable", query: value, $top: 10 },
            );
            return issues.map(i => i.idReadable).filter(Boolean);
          } catch {
            return [];
          }
        },
      },
    }),
    {
      description:
        "Full details of a specific YouTrack issue. URI format: youtrack://issues/FOO-123",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Variables, extra) => {
      const issueId = variables["issueId"] as string;
      const issue = await client.get(
        `/issues/${issueId}`,
        { fields: F.ISSUE_DETAIL },
        undefined,
        extra.signal,
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(issue) }],
      };
    },
  );
}
