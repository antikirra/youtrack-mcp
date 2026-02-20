import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PAGE_SIZE, REFERENCE_PAGE_SIZE, TTL_5MIN, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { enc, READ_ONLY, run } from "../utils.js";

export function registerProjectTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("get_projects", {
    title: "Get Projects",
    description:
      "List all YouTrack projects accessible to the current user. " +
      "Results are cached for 5 minutes.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(REFERENCE_PAGE_SIZE).default(REFERENCE_PAGE_SIZE).describe(
        "Max results. Defaults to 200 — reference data is pre-cached at startup."
      ),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ fields, limit, skip }, extra) => run(() => {
    return client.get("/admin/projects", {
      fields: fields ?? F.PROJECT_LIST,
      $top: limit,
      $skip: skip,
    }, TTL_5MIN, extra.signal);
  }));

  server.registerTool("get_project", {
    title: "Get Project",
    description: "Get details of a single YouTrack project by database ID or shortName.",
    inputSchema: {
      projectId: z.string().min(1).describe("Project database ID or shortName (e.g. FOO)"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ projectId, fields }, extra) => run(() =>
    client.get(`/admin/projects/${enc(projectId)}`, {
      fields: fields ?? F.PROJECT_DETAIL,
    }, TTL_5MIN, extra.signal)
  ));

  server.registerTool("get_project_custom_fields", {
    title: "Get Project Custom Fields",
    description:
      "Get all custom field definitions for a project, including their types and allowed values. " +
      "Useful for understanding what values are valid for state, priority, type, etc.",
    inputSchema: {
      projectId: z.string().min(1).describe("Project database ID or shortName"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ projectId, fields, limit, skip }, extra) => run(() =>
    client.get(`/admin/projects/${enc(projectId)}/customFields`, {
      fields: fields ?? F.PROJECT_CUSTOM_FIELD,
      $top: limit,
      $skip: skip,
    }, TTL_5MIN, extra.signal)
  ));
}
