import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { YouTrackError } from "./errors.js";

// ─── Response helpers ──────────────────────────────────────────────────────

/** Successful tool result with compact JSON (no whitespace = fewer tokens). */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * Tool error result — sets isError so the MCP client signals failure.
 *
 * YouTrackErrors are rendered with their structured hint so the LLM receives
 * actionable context in a single message, avoiding an extra round-trip.
 * Format: [YouTrack <status>] <detail> — <hint> (retried N×)
 */
export function fail(e: unknown): CallToolResult {
  const text = e instanceof YouTrackError
    ? e.toToolText()
    : e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Wraps an async call, catching any thrown errors and converting to an MCP
 * error result with isError: true. Eliminates repetitive try-catch in every handler.
 */
export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

// ─── Tool annotations ──────────────────────────────────────────────────────

/**
 * All tools in this server are read-only YouTrack REST GET calls.
 * Declaring these annotations lets the MCP client (Claude Desktop, etc.) know
 * that tools are safe to call without risk of side effects or data modification.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,      // Does not modify YouTrack state
  destructiveHint: false,  // Explicitly non-destructive (implied by readOnlyHint, but stated for clarity)
  idempotentHint: true,    // Repeated calls produce the same result
  openWorldHint: true,     // Interacts with the external YouTrack instance
};

// ─── Pagination schema helpers ─────────────────────────────────────────────

/**
 * Standard pagination parameters shared by all list endpoints.
 * Server hard-caps responses at ~42 entries per request.
 */
export const PAGINATION = {
  limit: {
    type: "number" as const,
    description: "Max results to return (server caps at ~42)",
    default: 42,
  },
  skip: {
    type: "number" as const,
    description: "Results to skip for pagination",
    default: 0,
  },
};
