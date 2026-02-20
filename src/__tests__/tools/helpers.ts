/**
 * Shared test helpers for tool handler tests.
 *
 * Strategy: mock McpServer.registerTool to capture handlers by name,
 * then call them directly with test args and a mock client.
 */
import { vi } from "vitest";
import type { YouTrackClient } from "../../client.js";

/** Minimal extra object matching RequestHandlerExtra shape. */
export function makeExtra(overrides?: { signal?: AbortSignal }) {
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    sendNotification: vi.fn().mockResolvedValue(undefined),
    _meta: {},
  };
}

/** Creates a mock YouTrackClient with a spied `get` method. */
export function mockClient(getResult: unknown = []): {
  client: YouTrackClient;
  getSpy: ReturnType<typeof vi.fn>;
  getBytesSpy: ReturnType<typeof vi.fn>;
} {
  const getSpy = vi.fn().mockResolvedValue(getResult);
  const getBytesSpy = vi.fn().mockResolvedValue({ data: "base64data", mimeType: "image/png" });
  const client = {
    baseUrl: "https://example.com",
    get: getSpy,
    refresh: vi.fn().mockResolvedValue(getResult),
    getBytes: getBytesSpy,
    onDegradation: undefined,
  } as unknown as YouTrackClient;
  return { client, getSpy, getBytesSpy };
}

type ToolHandler = (args: Record<string, unknown>, extra: ReturnType<typeof makeExtra>) => Promise<unknown>;

/**
 * Creates a mock McpServer that captures tool registrations.
 * Returns the mock server and a map of tool name → handler.
 */
export function mockServer(): {
  server: unknown;
  tools: Map<string, ToolHandler>;
} {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn(
      (name: string, _opts: unknown, handler: ToolHandler) => {
        tools.set(name, handler);
      },
    ),
    registerResource: vi.fn(),
    registerPrompt: vi.fn(),
  };
  return { server, tools };
}

/** Parses the JSON text from an ok() MCP result. Throws if the result indicates an error or has no content. */
export function parseOkResult(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): unknown {
  if (result.isError) {
    throw new Error(`Expected ok result but got isError: true — ${result.content[0]?.text}`);
  }
  if (result.content.length === 0) {
    throw new Error("Expected ok result but content array is empty");
  }
  const text = result.content[0]?.text;
  if (text === undefined) {
    throw new Error("Expected ok result but text is undefined");
  }
  return JSON.parse(text);
}
