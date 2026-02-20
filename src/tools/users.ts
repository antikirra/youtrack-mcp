import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { YouTrackClient, TTL_SESSION, TTL_HOUR } from "../client.js";
import * as F from "../fields.js";
import { run, READ_ONLY } from "../utils.js";

export function registerUserTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("get_current_user", {
    title: "Get Current User",
    description:
      "Get the currently authenticated YouTrack user. " +
      "Cached for the lifetime of the server process.",
    inputSchema: {},
    annotations: READ_ONLY,
  }, async (_args, extra) => run(() =>
    client.get("/users/me", { fields: F.USER }, TTL_SESSION, extra.signal)
  ));

  server.registerTool("get_users", {
    title: "Get Users",
    description: "List YouTrack users. Supports filtering by name or login via query.",
    inputSchema: {
      query: z.string().optional().describe("Filter by name or login"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ query, fields, limit, skip }, extra) => run(async () => {
    const params: Record<string, string | number> = {
      fields: fields ?? F.USER,
      $top: limit,
      $skip: skip,
    };
    if (query) params.query = query;
    return client.get("/users", params, undefined, extra.signal);
  }));

  server.registerTool("get_user", {
    title: "Get User",
    description: "Get a specific YouTrack user by database ID or login.",
    inputSchema: {
      userId: z.string().describe("User database ID or login"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ userId, fields }, extra) => run(() =>
    client.get(`/users/${userId}`, { fields: fields ?? F.USER }, undefined, extra.signal)
  ));

  server.registerTool("get_saved_queries", {
    title: "Get Saved Queries",
    description:
      "List saved search queries visible to the current user. " +
      "Use the query field value directly with search_issues.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ fields, limit, skip }, extra) => run(() =>
    client.get("/savedQueries", {
      fields: fields ?? F.SAVED_QUERY,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_tags", {
    title: "Get Tags",
    description: "List all tags available in YouTrack. Cached for 1 hour.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ fields, limit, skip }, extra) => run(() =>
    client.get("/tags", {
      fields: fields ?? F.TAG,
      $top: limit,
      $skip: skip,
    }, TTL_HOUR, extra.signal)
  ));
}
