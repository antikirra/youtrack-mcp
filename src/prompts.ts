import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { REFERENCE_PAGE_SIZE, TTL_5MIN, type YouTrackClient } from "./client.js";
import { issueIdCompleter } from "./completions.js";

/**
 * MCP Prompts are reusable workflow templates.
 * They guide the AI to orchestrate multiple tools in a coordinated sequence,
 * producing richer analysis than a single tool call.
 *
 * Prompt arguments use `completable()` so MCP clients that support completions
 * (e.g. Claude Desktop with completion UI) can autocomplete IDs inline.
 * The completion callbacks hit the YouTrack API (cached where possible) and
 * return matching values — no extra LLM token exchange required.
 */

// ─── Completion helpers ────────────────────────────────────────────────────

/**
 * Completes Agile board IDs from a live board list.
 * Matches by board ID prefix or board name substring.
 */
function agileIdCompleter(client: YouTrackClient) {
  return async (value: string): Promise<string[]> => {
    try {
      const boards = await client.get<Array<{ id: string; name: string }>>(
        "/agiles",
        { fields: "id,name", $top: 50 },
      );
      const lower = value.toLowerCase();
      return boards
        .filter(b => !lower || b.id.startsWith(lower) || b.name.toLowerCase().includes(lower))
        .map(b => b.id);
    } catch {
      return [];
    }
  };
}

/**
 * Completes YouTrack search queries by suggesting project-scoped query templates.
 * Uses the warmup-cached project list for instant (zero-latency) suggestions.
 * When the value already starts with "project:", further narrows by shortName prefix.
 */
function queryCompleter(client: YouTrackClient) {
  return async (value: string): Promise<string[]> => {
    try {
      const projects = await client.get<Array<{ shortName: string }>>(
        "/admin/projects",
        { fields: "shortName", $top: REFERENCE_PAGE_SIZE },
        TTL_5MIN,
      );
      const lower = value.toLowerCase();
      const projectPrefix = lower.startsWith("project:")
        ? lower.slice("project:".length).trim()
        : lower;
      return projects
        .filter(p => !projectPrefix || p.shortName.toLowerCase().startsWith(projectPrefix))
        .map(p => `project: ${p.shortName} #Unresolved`);
    } catch {
      return [];
    }
  };
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerPrompts(server: McpServer, client: YouTrackClient) {

  // ── Issue deep-dive ────────────────────────────────────────────────────
  server.registerPrompt("issue-deep-dive", {
    title: "Issue Deep Dive",
    description:
      "Comprehensive analysis of a YouTrack issue: full details, comments, state history, and linked issues.",
    argsSchema: {
      issueId: completable(
        z.string().describe("Issue ID, e.g. FOO-123"),
        issueIdCompleter(client),
      ),
    },
  }, ({ issueId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Perform a thorough analysis of YouTrack issue **${issueId}**:`,
          "",
          "1. Call `get_issue` to get the full issue details including description and custom fields.",
          "2. Call `get_issue_comments` to read the full discussion thread.",
          "3. Call `get_issue_links` to understand how this issue relates to others.",
          "4. Call `get_issue_activities` with `categories=\"CustomFieldCategory,IssueResolvedCategory,LinksCategory\"` to see key state transitions.",
          "",
          "Then provide a structured report:",
          "- **Current status**: state, assignee, priority, sprint",
          "- **Summary**: what the issue is about (based on description + comments)",
          "- **Key decisions**: important choices made in the discussion",
          "- **Related issues**: links and their significance",
          "- **History**: how the issue evolved (field changes, resolution attempts)",
          "- **Next steps**: recommended actions based on current state",
        ].join("\n"),
      },
    }],
  }));

  // ── Sprint status ──────────────────────────────────────────────────────
  server.registerPrompt("sprint-status", {
    title: "Sprint Status Report",
    description:
      "Current sprint status for an Agile board: scope, progress, blockers, and completion outlook.",
    argsSchema: {
      agileId: completable(
        z.string().describe("Agile board ID"),
        agileIdCompleter(client),
      ),
    },
  }, ({ agileId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Generate a sprint status report for Agile board **${agileId}**:`,
          "",
          "1. Call `get_agile_board` to get board details and identify the current sprint ID.",
          "2. Call `get_agile_sprint` with the current sprint ID to get sprint dates and goal.",
          "3. Call `get_sprint_issues` to get all issues in the sprint.",
          "4. For any blocked or unresolved issues, optionally call `get_issue_links` to check dependencies.",
          "",
          "Produce a concise report:",
          "- **Sprint goal** and timeline (start/end dates)",
          "- **Scope**: total issues, resolved vs unresolved, by state breakdown",
          "- **Progress**: percentage complete, on-track assessment",
          "- **Blockers**: issues stuck in progress or explicitly blocked",
          "- **At risk**: issues that may not complete before sprint end",
          "- **Highlights**: recently resolved issues",
        ].join("\n"),
      },
    }],
  }));

  // ── Search and analyze ────────────────────────────────────────────────
  server.registerPrompt("search-and-analyze", {
    title: "Search and Analyze Issues",
    description:
      "Search for issues matching a query and produce an actionable analysis with patterns and insights.",
    argsSchema: {
      query: completable(
        z.string().describe("YouTrack search query, e.g. 'project: FOO #Unresolved'"),
        queryCompleter(client),
      ),
      focus: z.string().optional().describe(
        "What to focus the analysis on, e.g. 'bottlenecks', 'assignee distribution', 'overdue items'"
      ),
    },
  }, ({ query, focus }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Search for issues matching \`${query}\` and analyze the results.`,
          "",
          "1. Call `search_issues` with the query. Increase limit if needed for a complete picture.",
          "2. If the result set is large, call `search_issues` with additional filters to drill down.",
          "3. For representative issues (blockers, oldest, high-priority), call `get_issue` for details.",
          "",
          focus
            ? `Focus the analysis on: **${focus}**`
            : "Provide a general analysis of the issue set.",
          "",
          "Produce an actionable report:",
          "- **Overview**: count, project distribution, state breakdown",
          "- **Patterns**: recurring themes, common blockers, problem areas",
          "- **Priority items**: issues needing immediate attention",
          "- **Recommendations**: concrete next steps to improve the situation",
        ].join("\n"),
      },
    }],
  }));
}
