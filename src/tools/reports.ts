import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PAGE_SIZE, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { enc, READ_ONLY, run } from "../utils.js";

export function registerReportTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("get_reports", {
    title: "Get Reports",
    description: "List YouTrack reports visible to the current user.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
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
      reportId: z.string().min(1).describe("Report ID"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ reportId, fields }, extra) => run(() =>
    client.get(`/reports/${enc(reportId)}`, { fields: fields ?? F.REPORT }, undefined, extra.signal)
  ));
}
