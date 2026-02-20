import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { run, READ_ONLY } from "../utils.js";

export function registerAgileTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("get_agile_boards", {
    title: "Get Agile Boards",
    description:
      "List all Agile boards. Returns lightweight metadata — use get_agile_board for full details.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ fields, limit, skip }, extra) => run(() =>
    client.get("/agiles", {
      fields: fields ?? F.AGILE_LIST,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_agile_board", {
    title: "Get Agile Board",
    description:
      "Get full details of an Agile board, including the sprint list and column configuration.",
    inputSchema: {
      agileId: z.string().describe("Agile board ID"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ agileId, fields }, extra) => run(() =>
    client.get(`/agiles/${agileId}`, { fields: fields ?? F.AGILE_DETAIL }, undefined, extra.signal)
  ));

  server.registerTool("get_agile_sprints", {
    title: "Get Agile Sprints",
    description:
      "List sprints for an Agile board (metadata only). " +
      "Use get_sprint_issues to fetch issues assigned to a sprint.",
    inputSchema: {
      agileId: z.string().describe("Agile board ID"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ agileId, fields, limit, skip }, extra) => run(() =>
    client.get(`/agiles/${agileId}/sprints`, {
      fields: fields ?? F.SPRINT,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_agile_sprint", {
    title: "Get Agile Sprint",
    description:
      "Get metadata for a specific sprint. " +
      "Use get_sprint_issues to fetch the issues within the sprint.",
    inputSchema: {
      agileId: z.string().describe("Agile board ID"),
      sprintId: z.string().describe("Sprint ID"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ agileId, sprintId, fields }, extra) => run(() =>
    client.get(`/agiles/${agileId}/sprints/${sprintId}`, {
      fields: fields ?? F.SPRINT,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_sprint_issues", {
    title: "Get Sprint Issues",
    description: "Get issues assigned to a specific sprint on an Agile board.",
    inputSchema: {
      agileId: z.string().describe("Agile board ID"),
      sprintId: z.string().describe("Sprint ID"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ agileId, sprintId, fields, limit, skip }, extra) => run(() =>
    client.get(`/agiles/${agileId}/sprints/${sprintId}/issues`, {
      fields: fields ?? F.SPRINT_ISSUE,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));
}
