import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PAGE_SIZE, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { enc, READ_ONLY, run } from "../utils.js";

export function registerArticleTools(server: McpServer, client: YouTrackClient) {

  server.registerTool("search_articles", {
    title: "Search Articles",
    description:
      "Search YouTrack knowledge base articles. " +
      "Omitting query returns all accessible articles — prefer scoping to a project. " +
      "Complement issue research with documentation: answers may live in articles, not issues.",
    inputSchema: {
      query: z.string().optional().describe(
        "Article search query, e.g. 'authentication setup' or 'project: KB deployment'"
      ),
      fields: z.string().optional().describe("Custom field projection (overrides default)"),
      limit: z.number().int().min(1).max(100).default(25).describe("Max results to return"),
      skip: z.number().int().min(0).default(0).describe("Offset for pagination"),
    },
    annotations: READ_ONLY,
  }, async ({ query, fields, limit, skip }, extra) => run(async () => {
    const params: Record<string, string | number> = {
      fields: fields ?? F.ARTICLE_LIST,
      $top: limit,
      $skip: skip,
    };
    if (query) params.query = query;
    return client.get("/articles", params, undefined, extra.signal);
  }));

  server.registerTool("get_article", {
    title: "Get Article",
    description:
      "Get the full content of a YouTrack knowledge base article by ID. " +
      "Returns article content, parent/child article tree, tags, and attachments.",
    inputSchema: {
      articleId: z.string().min(1).describe("Article ID, e.g. KB-T-1"),
      fields: z.string().optional().describe("Custom field projection"),
    },
    annotations: READ_ONLY,
  }, async ({ articleId, fields }, extra) => run(() =>
    client.get(`/articles/${enc(articleId)}`, { fields: fields ?? F.ARTICLE_DETAIL }, undefined, extra.signal)
  ));

  server.registerTool("get_article_comments", {
    title: "Get Article Comments",
    description: "Get comments for a YouTrack knowledge base article.",
    inputSchema: {
      articleId: z.string().min(1).describe("Article ID, e.g. KB-T-1"),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ articleId, fields, limit, skip }, extra) => run(() =>
    client.get(`/articles/${enc(articleId)}/comments`, {
      fields: fields ?? F.COMMENT,
      $top: limit,
      $skip: skip,
    }, undefined, extra.signal)
  ));
}
