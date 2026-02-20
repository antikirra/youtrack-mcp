import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { REFERENCE_PAGE_SIZE, TTL_5MIN, TTL_HOUR, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { enc, READ_ONLY, run } from "../utils.js";

/**
 * Proactive exploration tools.
 *
 * YouTrack is highly customisable — every project can have unique field sets,
 * custom states, custom link types, board layouts, etc. These tools let the AI
 * discover the exact schema before performing searches or analysis, enabling:
 *   - Correct filter values in search_issues queries
 *   - Understanding of which states are "resolved" vs "open"
 *   - Board layout awareness (column → field value mappings)
 *   - Global field landscape across all projects
 *
 * Recommended orchestration pattern:
 *   1. Call inspect_project_schema before building search queries for a project
 *   2. Call inspect_board_structure before sprint analysis or board reporting
 *   3. Call get_global_custom_fields to understand the field ecosystem
 *   4. Call get_custom_field_bundle when you need all values for a specific field
 */

// Bundle types supported by YouTrack admin API
const BUNDLE_TYPES = ["enum", "state", "version", "ownedField", "build"] as const;
type BundleType = typeof BUNDLE_TYPES[number];

export function registerInspectTools(server: McpServer, client: YouTrackClient) {

  // ── inspect_project_schema ───────────────────────────────────────────────
  server.registerTool("inspect_project_schema", {
    title: "Inspect Project Schema",
    description:
      "Get the complete custom field schema for a YouTrack project: every field with its " +
      "type, allowed values, resolution status, and configuration. " +
      "Call this first when working with an unfamiliar project to understand valid " +
      "filter values for search_issues (e.g. State: Open, Priority: Critical, " +
      "Assignee: me, Type: Bug). " +
      "Results cached for 5 minutes.",
    inputSchema: {
      projectId: z.string().min(1).describe("Project database ID or shortName (e.g. FOO)"),
    },
    annotations: READ_ONLY,
  }, async ({ projectId }, extra) => run(async () => {
    const [project, customFields] = await Promise.all([
      client.get<unknown>(`/admin/projects/${enc(projectId)}`, {
        fields: F.PROJECT_DETAIL,
      }, TTL_5MIN, extra.signal),
      client.get<unknown[]>(`/admin/projects/${enc(projectId)}/customFields`, {
        fields: F.PROJECT_SCHEMA_FIELD,
        $top: REFERENCE_PAGE_SIZE,
      }, TTL_5MIN, extra.signal),
    ]);
    return {
      project,
      customFields,
      // Inline query syntax hints — helps AI build correct YouTrack query strings
      queryHints: {
        state: "State: {valueName}  or  #valueName  or  #Unresolved  or  #Resolved",
        assignee: "Assignee: {login}  or  assignee: me  or  Assignee: {Full Name}",
        reporter: "reporter: {login}  or  reporter: me",
        priority: "Priority: {valueName}",
        type: "Type: {valueName}",
        tag: "tag: {tagName}",
        project: "project: {shortName}",
        dates: "created: {date..date}  or  updated: today",
        text: "summary: {text}  or  description: {text}",
        noField: "has: -{fieldName}  (issues where field is empty)",
        customEnum: "{fieldName}: {valueName}",
      },
    };
  }));

  // ── inspect_board_structure ──────────────────────────────────────────────
  server.registerTool("inspect_board_structure", {
    title: "Inspect Board Structure",
    description:
      "Get the full structural layout of an Agile board: column definitions with " +
      "their field value mappings, swimlane configuration ($type reveals if swimlanes " +
      "are attribute-based or issue-based), estimation and velocity fields, " +
      "color coding, and sprint sync settings. " +
      "Essential before sprint analysis or when interpreting board column semantics.",
    inputSchema: {
      agileId: z.string().min(1).describe("Agile board ID"),
    },
    annotations: READ_ONLY,
  }, async ({ agileId }, extra) => run(() =>
    client.get(`/agiles/${enc(agileId)}`, { fields: F.BOARD_STRUCTURE }, undefined, extra.signal)
  ));

  // ── get_global_custom_fields ─────────────────────────────────────────────
  server.registerTool("get_global_custom_fields", {
    title: "Get Global Custom Fields",
    description:
      "List all custom field definitions registered globally in YouTrack " +
      "(across all projects). Shows field name, $type (e.g. EnumIssueCustomField, " +
      "StateIssueCustomField, UserIssueCustomField, PeriodIssueCustomField, etc.), " +
      "and whether it auto-attaches to new projects. " +
      "Use this to understand the complete field ecosystem before inspecting individual projects. " +
      "Cached for 1 hour.",
    inputSchema: {
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(REFERENCE_PAGE_SIZE).default(REFERENCE_PAGE_SIZE).describe(
        "Max results. Defaults to 200 — reference data is pre-cached at startup."
      ),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ fields, limit, skip }, extra) => run(() =>
    client.get("/admin/customFieldSettings/customFields", {
      fields: fields ?? F.GLOBAL_CUSTOM_FIELD,
      $top: limit,
      $skip: skip,
    }, TTL_HOUR, extra.signal)
  ));

  // ── get_custom_field_bundle ──────────────────────────────────────────────
  server.registerTool("get_custom_field_bundle", {
    title: "Get Custom Field Bundle Values",
    description:
      "Get all allowed values for a specific bundle (enum, state, version, ownedField, or build). " +
      "Bundle IDs are found in inspect_project_schema under field.bundle.id. " +
      "Returns name, localizedName, isResolved (for state bundles), archived status, " +
      "ordinal (sort order), and color. " +
      "Use this to get the complete value list including archived entries that may " +
      "appear in historical data. " +
      "Cached for 1 hour.",
    inputSchema: {
      bundleType: z.enum(BUNDLE_TYPES).describe(
        "Bundle type: enum | state | version | ownedField | build"
      ),
      bundleId: z.string().min(1).describe(
        "Bundle ID — obtain from inspect_project_schema: field.bundle.id"
      ),
      includeArchived: z.boolean().default(false).describe(
        "Include archived values (appear in historical issues but no longer selectable)"
      ),
      fields: z.string().optional().describe("Custom field projection"),
      limit: z.number().int().min(1).max(500).default(REFERENCE_PAGE_SIZE),
      skip: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  }, async ({ bundleType, bundleId, includeArchived, fields, limit, skip }, extra) =>
    run(async () => {
      const params: Record<string, string | number | boolean> = {
        fields: fields ?? F.BUNDLE_VALUE,
        $top: limit,
        $skip: skip,
      };
      // YouTrack filters archived values by default; pass explicit flag to include them
      if (includeArchived) params.includeArchived = true;

      const values = await client.get(
        `/admin/customFieldSettings/bundles/${enc(bundleType as BundleType)}/${enc(bundleId)}/values`,
        params,
        TTL_HOUR,
        extra.signal,
      );
      return { bundleType, bundleId, values };
    })
  );
}
