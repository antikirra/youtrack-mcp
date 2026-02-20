# youtrack-mcp

Read-only [MCP](https://modelcontextprotocol.io/) server for [JetBrains YouTrack](https://www.jetbrains.com/youtrack/). Gives AI assistants structured access to issues, projects, agile boards, users, reports, and more — **without any ability to modify your data**.

## Safety: strictly read-only

This server is designed with a single, non-negotiable constraint: **it cannot change anything in your YouTrack instance**.

- Every tool uses HTTP GET exclusively — no POST, PUT, DELETE requests exist in the codebase
- Every tool is annotated with MCP `readOnlyHint: true` and `destructiveHint: false`, signaling to the AI client that calls are safe and side-effect-free
- The token you provide only needs read permissions — create a token with the minimum scope required
- No issue creation, no status changes, no comment posting, no field updates — by design, not by configuration

You can safely point this server at a production YouTrack instance. The worst case scenario is reading data you already have access to.

## Features

- **28 tools** for searching issues, reading comments, inspecting project schemas, downloading image attachments, and more
- **4 resources** exposing reference data as URI-addressable documents
- **3 prompts** providing reusable workflow templates (issue deep-dive, sprint status, search & analyze)
- **Schema discovery** — the AI can inspect custom field definitions, board layouts, and bundle values to build correct queries autonomously
- **Visual analysis** — image attachments (screenshots in comments, etc.) are downloaded and returned as MCP image content for direct visual reasoning
- TTL-based caching with background refresh for zero-latency reference data
- Automatic retries with exponential backoff on transient failures (5xx, timeouts, rate limits)
- Health degradation monitoring with MCP logging
- Structured error messages with actionable hints for LLM self-correction
- Node.js 18, 20, 22 support

## Quick start

### Claude Code (one command)

```bash
claude mcp add youtrack -e YOUTRACK_BASE_URL=https://yourcompany.youtrack.cloud -e YOUTRACK_TOKEN=perm:your-token -- npx -y @antikirra/youtrack-mcp
```

This registers the MCP server in your Claude Code environment. Start a new session and the YouTrack tools become immediately available.

To verify the server is registered:

```bash
claude mcp list
```

To remove:

```bash
claude mcp remove youtrack
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "youtrack": {
      "command": "npx",
      "args": ["-y", "@antikirra/youtrack-mcp"],
      "env": {
        "YOUTRACK_BASE_URL": "https://yourcompany.youtrack.cloud",
        "YOUTRACK_TOKEN": "perm:your-token-here"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/antikirra/youtrack-mcp.git
cd youtrack-mcp
npm install && npm run build
```

Then add to Claude Desktop:

```json
{
  "mcpServers": {
    "youtrack": {
      "command": "node",
      "args": ["/absolute/path/to/youtrack-mcp/dist/index.js"],
      "env": {
        "YOUTRACK_BASE_URL": "https://yourcompany.youtrack.cloud",
        "YOUTRACK_TOKEN": "perm:your-token-here"
      }
    }
  }
}
```

## Configuration

The server requires two environment variables:

| Variable | Description | Example |
|---|---|---|
| `YOUTRACK_BASE_URL` | YouTrack instance URL (no trailing slash) | `https://yourcompany.youtrack.cloud` |
| `YOUTRACK_TOKEN` | Permanent token for API access | `perm:xxx...` |

### Creating a token

1. Open YouTrack → **Profile** → **Account Security** → **Tokens**
2. Click **New token**
3. Grant the minimum scope needed — read-only access is sufficient for all server functionality
4. Copy the token (it starts with `perm:`)

The server validates the token at startup and logs the authenticated user identity via MCP logging.

## Tools

### Issues (10 tools)

| Tool | Description |
|---|---|
| `search_issues` | Search issues using YouTrack query language |
| `get_issue` | Get full details of a specific issue |
| `get_issue_comments` | Get comments for an issue (newest first) |
| `get_issue_links` | Get links to related issues (depends on, duplicates, etc.) |
| `get_issue_activities` | Get change history with category filtering |
| `get_issue_attachments` | List files attached to an issue |
| `get_issue_tags` | Get tags applied to an issue |
| `get_work_items` | Get time tracking work items |
| `get_issue_link_types` | Get all link type definitions (cached 1h) |
| `get_issue_images` | Download image attachments for visual analysis |

### Projects (3 tools)

| Tool | Description |
|---|---|
| `get_projects` | List all accessible projects (cached 5min) |
| `get_project` | Get project details by ID or shortName |
| `get_project_custom_fields` | Get custom field definitions for a project |

### Agile Boards (5 tools)

| Tool | Description |
|---|---|
| `get_agile_boards` | List all agile boards |
| `get_agile_board` | Get full board details with sprints and columns |
| `get_agile_sprints` | List sprints for a board |
| `get_agile_sprint` | Get metadata for a specific sprint |
| `get_sprint_issues` | Get issues assigned to a sprint |

### Users & Tags (5 tools)

| Tool | Description |
|---|---|
| `get_current_user` | Get the authenticated user (cached for session) |
| `get_users` | List users with optional name/login filter |
| `get_user` | Get a specific user by ID or login |
| `get_saved_queries` | List saved search queries |
| `get_tags` | List all tags (cached 1h) |

### Reports (2 tools)

| Tool | Description |
|---|---|
| `get_reports` | List reports visible to the current user |
| `get_report` | Get a specific report by ID |

### Schema Discovery (4 tools)

| Tool | Description |
|---|---|
| `inspect_project_schema` | Get complete custom field schema with query syntax hints |
| `inspect_board_structure` | Get full board layout: columns, swimlanes, estimation fields |
| `get_global_custom_fields` | List all global custom field definitions (cached 1h) |
| `get_custom_field_bundle` | Get all allowed values for a specific bundle (enum, state, version, etc.) |

## Resources

| URI | Description |
|---|---|
| `youtrack://projects` | All accessible projects (cached 5min) |
| `youtrack://link-types` | Issue link type catalog (cached 1h) |
| `youtrack://current-user` | Authenticated user identity (cached for session) |
| `youtrack://issues/{issueId}` | Full details of a specific issue (live, with ID completion) |

## Prompts

| Prompt | Description |
|---|---|
| `issue-deep-dive` | Comprehensive issue analysis: details, comments, history, links |
| `sprint-status` | Sprint status report: scope, progress, blockers, outlook |
| `search-and-analyze` | Search and analyze issues with patterns and insights |

## Architecture

```
Client (Claude, etc.)
  │
  ▼
MCP Server (stdio transport)
  ├── Tools ────────── YouTrack REST API (GET only)
  ├── Resources ────── Cached reference data
  ├── Prompts ──────── Workflow templates
  ├── TTL Cache ────── 3 tiers: session / 5min / 1h
  ├── Retry Engine ─── Exponential backoff on transient failures
  └── Health Monitor ─ Degradation detection at 3 and 5 consecutive failures
```

**Caching strategy**: reference data (projects, link types, custom fields, tags) is pre-loaded at startup and refreshed in the background on a timer. This means the first tool call never pays a cold-miss latency penalty. Live data (search results, issue details) is never cached.

**Error handling**: every YouTrack API error is enriched with an actionable hint (e.g., "Check field names — call `inspect_project_schema` to discover valid values"). This allows the AI to self-correct without extra round-trips.

## Development

```bash
npm run dev    # Run with tsx (hot-reload)
npm run build  # Compile TypeScript
npm test       # Run tests (103 tests)
npm run lint   # Run Biome linter
```

## License

[MIT](LICENSE)
