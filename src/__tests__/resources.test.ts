import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TTL_5MIN, TTL_HOUR, TTL_SESSION, type YouTrackClient } from "../client.js";
import * as F from "../fields.js";
import { registerResources } from "../resources.js";

type ResourceHandler = (uri: URL, extra: { signal: AbortSignal }) => Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}>;
type TemplateHandler = (uri: URL, variables: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}>;

interface ResourceRegistration {
  name: string;
  uri: unknown;
  opts: { description: string; mimeType: string };
  handler: ResourceHandler | TemplateHandler;
}

function mockClient(getResult: unknown = {}) {
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
  const resources: ResourceRegistration[] = [];
  const server = {
    registerTool: vi.fn(),
    registerPrompt: vi.fn(),
    registerResource: vi.fn(
      (name: string, uri: unknown, opts: ResourceRegistration["opts"], handler: ResourceHandler) => {
        resources.push({ name, uri, opts, handler });
      },
    ),
  };
  return { server, resources };
}

describe("registerResources", () => {
  let resources: ResourceRegistration[];
  let getSpy: ReturnType<typeof vi.fn>;
  const signal = new AbortController().signal;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([{ id: "p1", shortName: "FOO" }]);
    resources = srv.resources;
    getSpy = cli.getSpy;
    registerResources(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 4 resources", () => {
    expect(resources).toHaveLength(4);
    const names = resources.map(r => r.name);
    expect(names).toContain("projects");
    expect(names).toContain("link-types");
    expect(names).toContain("current-user");
    expect(names).toContain("issue");
  });

  describe("youtrack://projects", () => {
    it("fetches projects with TTL_5MIN cache", async () => {
      const res = resources.find(r => r.name === "projects")!;
      const result = await (res.handler as ResourceHandler)(
        new URL("youtrack://projects"),
        { signal },
      );

      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects",
        { fields: F.PROJECT_DETAIL, $top: 200 },
        TTL_5MIN,
        signal,
      );
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe("youtrack://projects");
      expect(result.contents[0].mimeType).toBe("application/json");
      expect(JSON.parse(result.contents[0].text)).toEqual([{ id: "p1", shortName: "FOO" }]);
    });
  });

  describe("youtrack://link-types", () => {
    it("fetches link types with TTL_HOUR cache", async () => {
      const res = resources.find(r => r.name === "link-types")!;
      await (res.handler as ResourceHandler)(
        new URL("youtrack://link-types"),
        { signal },
      );

      expect(getSpy).toHaveBeenCalledWith(
        "/issueLinkTypes",
        { fields: F.LINK_TYPE },
        TTL_HOUR,
        signal,
      );
    });
  });

  describe("youtrack://current-user", () => {
    it("fetches current user with TTL_SESSION cache", async () => {
      const res = resources.find(r => r.name === "current-user")!;
      await (res.handler as ResourceHandler)(
        new URL("youtrack://current-user"),
        { signal },
      );

      expect(getSpy).toHaveBeenCalledWith(
        "/users/me",
        { fields: F.USER },
        TTL_SESSION,
        signal,
      );
    });
  });

  describe("youtrack://issues/{issueId}", () => {
    it("fetches issue by ID from URI variables", async () => {
      const res = resources.find(r => r.name === "issue")!;
      const result = await (res.handler as TemplateHandler)(
        new URL("youtrack://issues/FOO-123"),
        { issueId: "FOO-123" },
        { signal },
      );

      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO-123",
        { fields: F.ISSUE_DETAIL },
        undefined,
        signal,
      );
      expect(result.contents[0].uri).toBe("youtrack://issues/FOO-123");
    });

    it("encodes special characters in issue ID", async () => {
      const res = resources.find(r => r.name === "issue")!;
      await (res.handler as TemplateHandler)(
        new URL("youtrack://issues/FOO%2FBAR-1"),
        { issueId: "FOO/BAR-1" },
        { signal },
      );

      expect(getSpy).toHaveBeenCalledWith(
        "/issues/FOO%2FBAR-1",
        expect.any(Object),
        undefined,
        signal,
      );
    });

    it("uses ResourceTemplate with issueId completion", () => {
      const res = resources.find(r => r.name === "issue")!;
      // URI should be a ResourceTemplate, not a plain string
      expect(res.uri).not.toBe("youtrack://issues/{issueId}");
      expect(typeof res.uri).toBe("object");
    });
  });
});
