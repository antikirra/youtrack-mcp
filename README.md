# youtrack-mcp

Read-only [MCP](https://modelcontextprotocol.io/) server for [JetBrains YouTrack](https://www.jetbrains.com/youtrack/). Gives AI assistants structured access to issues, projects, agile boards, knowledge base, and more — **without any ability to modify your data**.

Every tool uses HTTP GET exclusively. No POST, PUT, DELETE. You can safely point this at a production instance.

## Quick start

### Claude Code

```bash
claude mcp add youtrack \
  -e YOUTRACK_BASE_URL=https://yourcompany.youtrack.cloud \
  -e YOUTRACK_TOKEN=perm:your-token \
  -- npx -y @antikirra/youtrack-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

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

## Configuration

| Variable | Description | Example |
|---|---|---|
| `YOUTRACK_BASE_URL` | YouTrack instance URL | `https://yourcompany.youtrack.cloud` |
| `YOUTRACK_TOKEN` | Permanent token (`Profile > Account Security > Tokens`) | `perm:xxx...` |

Read-only access scope is sufficient for all server functionality.

## What's included

- **30+ tools** — issues, comments, activities, links, attachments, projects, agile boards, sprints, users, tags, reports, knowledge base articles, schema discovery, image analysis
- **Batch operations** — fetch details/comments/activities for multiple issues in parallel
- **Schema discovery** — AI can inspect custom fields, board layouts, and bundle values to build correct queries autonomously
- **Visual analysis** — image attachments returned as MCP image content for direct visual reasoning
- **Resources & prompts** — URI-addressable reference data and reusable workflow templates
- TTL caching with background refresh, automatic retries, health monitoring, structured error hints

## Development

```bash
npm install && npm run build   # build
npm run dev                    # run with hot-reload
npm test                       # run tests
```

## License

[MIT](LICENSE)
