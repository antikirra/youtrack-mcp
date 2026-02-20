import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { REFERENCE_PAGE_SIZE, TTL_5MIN } from "../../client.js";
import * as F from "../../fields.js";
import { registerProjectTools } from "../../tools/projects.js";
import { makeExtra, mockClient, mockServer } from "./helpers.js";

describe("project tools", () => {
  let tools: ReturnType<typeof mockServer>["tools"];
  let getSpy: ReturnType<typeof mockClient>["getSpy"];
  let extra: ReturnType<typeof makeExtra>;

  beforeEach(() => {
    const srv = mockServer();
    const cli = mockClient([{ id: "p1", shortName: "FOO" }]);
    tools = srv.tools;
    getSpy = cli.getSpy;
    extra = makeExtra();
    registerProjectTools(srv.server as unknown as McpServer, cli.client);
  });

  it("registers 3 project tools", () => {
    expect(tools.size).toBe(3);
    expect(tools.has("get_projects")).toBe(true);
    expect(tools.has("get_project")).toBe(true);
    expect(tools.has("get_project_custom_fields")).toBe(true);
  });

  describe("get_projects", () => {
    it("calls /admin/projects with defaults and TTL_5MIN cache", async () => {
      const handler = tools.get("get_projects")!;
      await handler({ limit: REFERENCE_PAGE_SIZE, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects",
        { fields: F.PROJECT_LIST, $top: REFERENCE_PAGE_SIZE, $skip: 0 },
        TTL_5MIN,
        extra.signal,
      );
    });

    it("includes $skip when > 0", async () => {
      const handler = tools.get("get_projects")!;
      await handler({ limit: 50, skip: 10 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects",
        expect.objectContaining({ $skip: 10 }),
        TTL_5MIN,
        extra.signal,
      );
    });

    it("always passes $skip (even when 0) for consistent cache keys", async () => {
      const handler = tools.get("get_projects")!;
      await handler({ limit: 50, skip: 0 }, extra);
      const params = getSpy.mock.calls[0][1];
      expect(params).toHaveProperty("$skip", 0);
    });
  });

  describe("get_project", () => {
    it("calls correct path with encoded projectId", async () => {
      const handler = tools.get("get_project")!;
      await handler({ projectId: "FOO" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects/FOO",
        { fields: F.PROJECT_DETAIL },
        TTL_5MIN,
        extra.signal,
      );
    });

    it("encodes special characters in projectId", async () => {
      const handler = tools.get("get_project")!;
      await handler({ projectId: "MY/PROJECT" }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects/MY%2FPROJECT",
        { fields: F.PROJECT_DETAIL },
        TTL_5MIN,
        extra.signal,
      );
    });
  });

  describe("error propagation", () => {
    it("returns isError on YouTrackError", async () => {
      const { YouTrackError } = await import("../../errors.js");
      getSpy.mockRejectedValueOnce(new YouTrackError("Not found", 404, false));

      const handler = tools.get("get_project")!;
      const result = await handler({ projectId: "NOPE" }, extra) as {
        content: Array<{ text: string }>; isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[YouTrack 404]");
    });
  });

  describe("get_project_custom_fields", () => {
    it("calls correct path with pagination", async () => {
      const handler = tools.get("get_project_custom_fields")!;
      await handler({ projectId: "FOO", limit: 42, skip: 0 }, extra);
      expect(getSpy).toHaveBeenCalledWith(
        "/admin/projects/FOO/customFields",
        { fields: F.PROJECT_CUSTOM_FIELD, $top: 42, $skip: 0 },
        TTL_5MIN,
        extra.signal,
      );
    });
  });
});
