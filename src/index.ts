#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, type YouTrackClient } from "./client.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerAgileTools } from "./tools/agile.js";
import { registerImageTools } from "./tools/images.js";
import { registerInspectTools } from "./tools/inspect.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerReportTools } from "./tools/reports.js";
import { registerUserTools } from "./tools/users.js";
import { scheduleWarmup } from "./warmup.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// ─── Configuration ─────────────────────────────────────────────────────────

let client: YouTrackClient;
try {
  client = createClient();
} catch (err) {
  process.stderr.write(`[youtrack-mcp] ${(err as Error).message}\n`);
  process.exit(1);
}

// ─── Server ────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "youtrack-mcp", version },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      logging: {},
      completions: {},   // completable() args in prompts + resource template variables
    },
  },
);

// ─── Logging helper ────────────────────────────────────────────────────────
//
// Single MCP log helper shared by health monitoring, warmup, and background
// refresh. Failures are silently swallowed — logging is best-effort.

const log = (level: "info" | "warning" | "error", data: string) => {
  server.sendLoggingMessage({ level, data }).catch(() => {});
};

// ─── Health monitoring ─────────────────────────────────────────────────────
//
// Wire the client's degradation callback to MCP logging so health events are
// visible in the orchestrator's log channel rather than polluting tool results.
// Fires at 3 consecutive transient failures (warning) and 5 (error).

client.onDegradation = (level, message) => log(level, `[health] ${message}`);

// ─── Registration ──────────────────────────────────────────────────────────
//
// Tool groups:
//   Core data retrieval   — issues, projects, reports, agile, users
//   Proactive exploration — inspect (schema, board structure, global fields, bundles)
//   Visual analysis       — images (screenshots from issue + comment attachments)
//   Resources             — URI-addressable reference data
//   Prompts               — reusable workflow templates

registerIssueTools(server, client);
registerProjectTools(server, client);
registerReportTools(server, client);
registerAgileTools(server, client);
registerUserTools(server, client);
registerInspectTools(server, client);
registerImageTools(server, client);
registerResources(server, client);
registerPrompts(server, client);

// ─── Transport ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
  await server.sendLoggingMessage({
    level: "info",
    data: `youtrack-mcp v${version} started — ${process.env.YOUTRACK_BASE_URL}`,
  });
} catch (err) {
  process.stderr.write(`[youtrack-mcp] Failed to start: ${(err as Error).message}\n`);
  process.exit(1);
}

// ─── Warmup ─────────────────────────────────────────────────────────────────
//
// Pre-populates the TTL cache with reference data (projects, link types, custom
// fields, tags) so the first tool call never pays a cold-miss penalty.
// Also confirms token validity and logs "authenticated as …" immediately.
// Background timers keep the cache perpetually fresh.

const stopWarmup = scheduleWarmup(client, log);

// Cancel background refresh timers on graceful shutdown
process.once("SIGTERM", stopWarmup);
process.once("SIGINT", stopWarmup);
