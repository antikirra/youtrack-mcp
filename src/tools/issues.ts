import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PAGE_SIZE, TTL_HOUR, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { enc, READ_ONLY, run } from "../utils.js";

const ACTIVITY_CATEGORIES =
  "CommentsCategory, AttachmentsCategory, IssueCreatedCategory, IssueResolvedCategory, " +
  "LinksCategory, TagsCategory, CustomFieldCategory, SprintCategory, " +
  "SummaryCategory, DescriptionCategory, UsedInCategory, VcsChangeCategory, " +
  "WorkItemCategory, TotalVotesCategory, ProjectCategory";

export function registerIssueTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("search_issues", {
    title: "Search Issues",
    description:
      "Search YouTrack issues using query language. " +
      "Omitting query returns all accessible issues — always prefer scoping to a project.",
    inputSchema: {
      query: z.string().optional().describe(
        "YouTrack query, e.g. 'project: FOO #Unresolved assignee: me'"
      ),
      fields: z.string().optional().describe("Custom field projection (overrides default)"),
      limit: z.number().int().min(1).max(100).default(25).describe(
        "Max results to return"
      ),
      skip: z.number().int().min(0).default(0).describe("Offset for pagination"),
    },
    annotations: READ_ONLY,
  }, async ({ query, fields, limit, skip }, extra) => run(async () => {
    const params: Record<string, string | number> = {
      fields: fields ?? F.ISSUE_LIST,
      $top: limit,
      $skip: skip,
    };
    if (query) params.query = query;
    return client.get("/issues", params, undefined, extra.signal);
  }));

  server.registerTool("get_issue", {
    title: "Get Issue",
    description: "Get full details of a YouTrack issue by ID.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, fields }, extra) => run(() =>
    client.get(`/issues/${enc(issueId)}`, { fields: fields ?? F.ISSUE_DETAIL }, undefined, extra.signal)
  ));

  server.registerTool("get_issue_comments", {
    title: "Get Issue Comments",
    description: "Get comments for a YouTrack issue, oldest first by default.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, fields, limit, skip }, extra) => run(() =>
    client.get(`/issues/${enc(issueId)}/comments`, {
      fields: fields ?? F.COMMENT,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_issue_links", {
    title: "Get Issue Links",
    description:
      "Get links to related issues (duplicates, depends on, relates to, etc.). " +
      "Use get_issue_link_types to see all available link type names.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, fields }, extra) => run(() =>
    client.get(`/issues/${enc(issueId)}/links`, { fields: fields ?? F.LINK }, undefined, extra.signal)
  ));

  server.registerTool("get_issue_activities", {
    title: "Get Issue Activities",
    description:
      "Get the change history of a YouTrack issue. " +
      "Filter by categories to reduce noise, e.g. only state/field changes.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      categories: z.string().optional().describe(
        `Comma-separated categories. Available: ${ACTIVITY_CATEGORIES}`
      ),
      author: z.string().optional().describe(
        "Filter by author: user database ID, login, or 'me'"
      ),
      start: z.number().int().optional().describe("Start timestamp (ms UTC)"),
      end: z.number().int().optional().describe("End timestamp (ms UTC)"),
      reverse: z.boolean().default(false).describe(
        "true = newest-to-oldest, false = oldest-to-newest"
      ),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, categories, author, start, end, reverse, fields, limit, skip }, extra) =>
    run(async () => {
      const params: Record<string, string | number | boolean> = {
        fields: fields ?? F.ACTIVITY,
        $top: limit,
        $skip: skip,
        reverse,
      };
      if (categories) params.categories = categories;
      if (author) params.author = author;
      if (start !== undefined) params.start = start;
      if (end !== undefined) params.end = end;
      // /activities supports $top/$skip offset pagination
      // /activitiesPage uses cursor-based pagination — incompatible with skip
      return client.get(`/issues/${enc(issueId)}/activities`, params, undefined, extra.signal);
    })
  );

  server.registerTool("get_issue_attachments", {
    title: "Get Issue Attachments",
    description: "List files attached to a YouTrack issue.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, fields, limit, skip }, extra) => run(() =>
    client.get(`/issues/${enc(issueId)}/attachments`, {
      fields: fields ?? F.ATTACHMENT,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_issue_tags", {
    title: "Get Issue Tags",
    description: "Get tags applied to a YouTrack issue.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
    },
    annotations: READ_ONLY,
  }, async ({ issueId }, extra) => run(() =>
    client.get(`/issues/${enc(issueId)}/tags`, {
      fields: F.TAG,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_work_items", {
    title: "Get Work Items",
    description: "Get time tracking work items (logged hours) for a YouTrack issue.",
    inputSchema: {
      issueId: z.string().min(1).describe("Issue ID, e.g. FOO-123"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ issueId, fields, limit, skip }, extra) => run(() =>
    client.get(`/issues/${enc(issueId)}/timeTracking/workItems`, {
      fields: fields ?? F.WORK_ITEM,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));

  server.registerTool("get_issue_link_types", {
    title: "Get Issue Link Types",
    description:
      "Get all link type definitions: 'depends on', 'duplicates', 'relates to', etc. " +
      "Cached for 1 hour as this data rarely changes.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ fields }, extra) => run(() =>
    client.get("/issueLinkTypes", { fields: fields ?? F.LINK_TYPE }, TTL_HOUR, extra.signal)
  ));
}
