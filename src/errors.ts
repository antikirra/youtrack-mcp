/**
 * Structured error type for YouTrack API failures.
 *
 * Design goals:
 *   - Carry HTTP status code so the retry engine can classify the failure
 *   - Carry actionable hint text so the LLM gets a corrective suggestion inline,
 *     eliminating a full back-and-forth exchange for common mistakes
 *   - Track how many retries were performed so the LLM knows retrying itself is futile
 *
 * Error taxonomy:
 *   Transient  — 408, 425, 429, 5xx, network / timeout
 *                → automatically retried by the client; hint advises if retries exhausted
 *   Semantic   — 400, 401, 403, 404
 *                → not retried; hint points to the corrective action
 */

/** HTTP statuses that indicate a temporary condition worth retrying. */
export const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Short, actionable hint for each known HTTP status.
 * Surfaced inline in the tool error result so the LLM can self-correct.
 */
const STATUS_HINTS: Readonly<Record<number, string>> = {
  400: "Check field names, query syntax, or parameter values. " +
       "Tip: call inspect_project_schema to discover valid field names",
  401: "Authentication failed — verify YOUTRACK_TOKEN is valid and not expired. " +
       "Regenerate at: Profile → Account Security → Tokens",
  403: "Insufficient permissions — this resource requires elevated access rights",
  404: "Resource not found — verify the ID or shortName exists in this YouTrack instance",
  408: "Request timed out",
  429: "Rate limit exceeded — reduce request frequency",
  500: "YouTrack internal server error — may be transient",
  502: "YouTrack gateway error — instance may be starting up",
  503: "YouTrack service unavailable — instance may be under maintenance or overloaded",
  504: "YouTrack gateway timeout — upstream response too slow",
};

export class YouTrackError extends Error {
  /** HTTP status code, undefined for network / timeout errors. */
  readonly statusCode: number | undefined;

  /** Whether this failure is worth retrying (network, timeout, 5xx, 429). */
  readonly isTransient: boolean;

  /** Number of automatic retries already performed before this error was thrown. */
  readonly retryCount: number;

  /** Retry-After delay in ms, parsed from the response header on 429 responses. */
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    statusCode: number | undefined,
    isTransient: boolean,
    retryCount = 0,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "YouTrackError";
    this.statusCode = statusCode;
    this.isTransient = isTransient;
    this.retryCount = retryCount;
    this.retryAfterMs = retryAfterMs;
  }

  /** Actionable guidance derived from the HTTP status. */
  get hint(): string {
    if (this.statusCode !== undefined) {
      return STATUS_HINTS[this.statusCode] ?? `HTTP ${this.statusCode}`;
    }
    return "Network error — check connectivity to the YouTrack instance";
  }

  /**
   * Single-line error string for MCP tool content.
   * Format: [YouTrack <status>] <message> — <hint> (retried N×)
   *
   * Designed for minimal token usage while giving the LLM enough context
   * to self-correct without an additional round-trip.
   */
  toToolText(): string {
    const code = this.statusCode !== undefined ? ` ${this.statusCode}` : "";
    let text = `[YouTrack${code}] ${this.message} — ${this.hint}`;
    if (this.retryCount > 0) {
      text += ` (retried ${this.retryCount}×, further retries will not help)`;
    }
    return text;
  }
}

/** Returns true if the HTTP status code represents a transient, retryable condition. */
export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

/**
 * Parses the Retry-After header value into milliseconds.
 * Supports both delay-seconds (e.g. "120") and HTTP-date formats.
 * Returns undefined if the header is absent or unparseable.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  // Try HTTP-date format
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delay = date - Date.now();
    return delay > 0 ? delay : 0;
  }
  return undefined;
}
