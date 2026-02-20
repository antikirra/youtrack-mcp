import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { run, READ_ONLY } from "../utils.js";

export function registerReportTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("get_reports", {
    title: "Get Reports",
    description: "List YouTrack reports visible to the current user.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(42),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ fields, limit, skip }, extra) => run(() =>
    client.get("/reports", {
      fields: fields ?? F.REPORT,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_report", {
    title: "Get Report",
    description:
      "Get a specific YouTrack report by ID. " +
      "The $type field indicates the report variant (IssueCountReport, TimeTrackingReport, etc.).",
    inputSchema: {
      reportId: z.string().describe("Report ID"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ reportId, fields }, extra) => run(() =>
    client.get(`/reports/${reportId}`, { fields: fields ?? F.REPORT }, undefined, extra.signal)
  ));
}
