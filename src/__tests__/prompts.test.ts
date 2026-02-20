import { getCompleter } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YouTrackClient } from "../client.js";
import { registerPrompts } from "../prompts.js";

type PromptHandler = (args: Record<string, string>, extra: unknown) => unknown;

interface PromptRegistration {
  name: string;
  opts: { argsSchema?: Record<string, unknown> };
  handler: PromptHandler;
}

function mockClient(getResult: unknown = []) {
  const getSpy = vi.fn().mockResolvedValue(getResult);
  const client = {
    baseUrl: "https://example.com",
    get: getSpy,
    refresh: vi.fn(),
    getBytes: vi.fn(),
    onDegradation: undefined,
  } as unknown as YouTrackClient;
  return { client, getSpy };
}

function mockServer() {
  const prompts: PromptRegistration[] = [];
  const server = {
    registerTool: vi.fn(),
    registerResource: vi.fn(),
    registerPrompt: vi.fn(
      (name: string, opts: PromptRegistration["opts"], handler: PromptHandler) => {
        prompts.push({ name, opts, handler });
      },
    ),
  };
  return { server, prompts };
}

describe("registerPrompts", () => {
  let prompts: PromptRegistration[];

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient();
    prompts = srv.prompts;
    registerPrompts(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 3 prompts", () => {
    expect(prompts).toHaveLength(3);
    const names = prompts.map(p => p.name);
    expect(names).toContain("issue-deep-dive");
    expect(names).toContain("sprint-status");
    expect(names).toContain("search-and-analyze");
  });

  describe("issue-deep-dive", () => {
    it("returns message with issue ID in content", () => {
      const prompt = prompts.find(p => p.name === "issue-deep-dive")!;
      const result = prompt.handler({ issueId: "FOO-42" }, {}) as {
        messages: Array<{ role: string; content: { text: string } }>;
      };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.text).toContain("FOO-42");
      expect(result.messages[0].content.text).toContain("get_issue");
      expect(result.messages[0].content.text).toContain("get_issue_comments");
      expect(result.messages[0].content.text).toContain("get_issue_links");
      expect(result.messages[0].content.text).toContain("get_issue_activities");
    });

    it("has completable issueId argument", () => {
      const prompt = prompts.find(p => p.name === "issue-deep-dive")!;
      const schema = prompt.opts.argsSchema!;
      const completer = getCompleter(schema.issueId);
      expect(completer).toBeDefined();
      expect(typeof completer).toBe("function");
    });
  });

  describe("sprint-status", () => {
    it("returns message with agile ID in content", () => {
      const prompt = prompts.find(p => p.name === "sprint-status")!;
      const result = prompt.handler({ agileId: "board-1" }, {}) as {
        messages: Array<{ role: string; content: { text: string } }>;
      };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content.text).toContain("board-1");
      expect(result.messages[0].content.text).toContain("get_agile_board");
      expect(result.messages[0].content.text).toContain("get_sprint_issues");
    });

    it("has completable agileId argument", () => {
      const prompt = prompts.find(p => p.name === "sprint-status")!;
      const completer = getCompleter(prompt.opts.argsSchema!.agileId);
      expect(completer).toBeDefined();
    });
  });

  describe("search-and-analyze", () => {
    it("returns message with query in content", () => {
      const prompt = prompts.find(p => p.name === "search-and-analyze")!;
      const result = prompt.handler({ query: "project: FOO #Unresolved" }, {}) as {
        messages: Array<{ role: string; content: { text: string } }>;
      };
      expect(result.messages[0].content.text).toContain("project: FOO #Unresolved");
      expect(result.messages[0].content.text).toContain("search_issues");
    });

    it("includes focus topic when provided", () => {
      const prompt = prompts.find(p => p.name === "search-and-analyze")!;
      const result = prompt.handler({ query: "q", focus: "bottlenecks" }, {}) as {
        messages: Array<{ role: string; content: { text: string } }>;
      };
      expect(result.messages[0].content.text).toContain("bottlenecks");
    });

    it("uses general analysis when focus is absent", () => {
      const prompt = prompts.find(p => p.name === "search-and-analyze")!;
      const result = prompt.handler({ query: "q" }, {}) as {
        messages: Array<{ role: string; content: { text: string } }>;
      };
      expect(result.messages[0].content.text).toContain("general analysis");
    });

    it("has completable query argument", () => {
      const prompt = prompts.find(p => p.name === "search-and-analyze")!;
      const completer = getCompleter(prompt.opts.argsSchema!.query);
      expect(completer).toBeDefined();
    });
  });
});

describe("agileIdCompleter", () => {
  it("returns matching board IDs by ID prefix", async () => {
    const { client, getSpy } = mockClient([
      { id: "board-1", name: "Sprint Board" },
      { id: "board-2", name: "Kanban" },
      { id: "other-3", name: "Other" },
    ]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "sprint-status")!;
    const completer = getCompleter(prompt.opts.argsSchema!.agileId);
    const result = await completer!("board");

    expect(getSpy).toHaveBeenCalledWith("/agiles", { fields: "id,name", $top: 50 });
    expect(result).toContain("board-1");
    expect(result).toContain("board-2");
    expect(result).not.toContain("other-3");
  });

  it("returns matching board IDs by name substring", async () => {
    const { client } = mockClient([
      { id: "123", name: "Sprint Board" },
      { id: "456", name: "Kanban Board" },
    ]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "sprint-status")!;
    const completer = getCompleter(prompt.opts.argsSchema!.agileId);
    const result = await completer!("sprint");

    expect(result).toEqual(["123"]);
  });

  it("returns all boards for empty value", async () => {
    const { client } = mockClient([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "sprint-status")!;
    const completer = getCompleter(prompt.opts.argsSchema!.agileId);
    const result = await completer!("");

    expect(result).toEqual(["a", "b"]);
  });

  it("returns empty array on API error", async () => {
    const { client, getSpy } = mockClient();
    getSpy.mockRejectedValueOnce(new Error("Network error"));
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "sprint-status")!;
    const completer = getCompleter(prompt.opts.argsSchema!.agileId);
    const result = await completer!("anything");

    expect(result).toEqual([]);
  });
});

describe("queryCompleter", () => {
  it("returns project-scoped unresolved query templates", async () => {
    const { client } = mockClient([
      { shortName: "FOO" },
      { shortName: "BAR" },
    ]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "search-and-analyze")!;
    const completer = getCompleter(prompt.opts.argsSchema!.query);
    const result = await completer!("");

    expect(result).toEqual([
      "project: FOO #Unresolved",
      "project: BAR #Unresolved",
    ]);
  });

  it("filters projects by shortName prefix", async () => {
    const { client } = mockClient([
      { shortName: "FOO" },
      { shortName: "FAB" },
      { shortName: "BAR" },
    ]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "search-and-analyze")!;
    const completer = getCompleter(prompt.opts.argsSchema!.query);
    const result = await completer!("F");

    expect(result).toEqual([
      "project: FOO #Unresolved",
      "project: FAB #Unresolved",
    ]);
  });

  it("narrows when value starts with 'project:'", async () => {
    const { client } = mockClient([
      { shortName: "FOO" },
      { shortName: "FAB" },
      { shortName: "BAR" },
    ]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "search-and-analyze")!;
    const completer = getCompleter(prompt.opts.argsSchema!.query);
    const result = await completer!("project: FO");

    expect(result).toEqual(["project: FOO #Unresolved"]);
  });

  it("uses TTL_5MIN cache for project list", async () => {
    const { client, getSpy } = mockClient([{ shortName: "X" }]);
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "search-and-analyze")!;
    const completer = getCompleter(prompt.opts.argsSchema!.query);
    await completer!("");

    expect(getSpy).toHaveBeenCalledWith(
      "/admin/projects",
      { fields: "shortName", $top: 200 },
      300_000,
    );
  });

  it("returns empty array on API error", async () => {
    const { client, getSpy } = mockClient();
    getSpy.mockRejectedValueOnce(new Error("fail"));
    const srv = mockServer();
    registerPrompts(srv.server as unknown as McpServer, client);

    const prompt = srv.prompts.find(p => p.name === "search-and-analyze")!;
    const completer = getCompleter(prompt.opts.argsSchema!.query);
    const result = await completer!("FOO");

    expect(result).toEqual([]);
  });
});
