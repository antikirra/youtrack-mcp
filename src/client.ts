import { YouTrackError, isTransientStatus } from "./errors.js";

export interface YouTrackConfig {
  baseUrl: string;
  token: string;
}

type Params = Record<string, string | number | boolean>;

// ─── Retry configuration ───────────────────────────────────────────────────

/** Delays between successive retry attempts. Length = max retry count. */
const RETRY_DELAYS_MS = [500, 1500] as const;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns an AbortSignal that fires after `timeoutMs` OR when `signal` fires,
 * whichever comes first. On Node.js < 20 where AbortSignal.any() is unavailable,
 * falls back to timeout-only (client cancellation is not propagated but 30s
 * timeout still protects against indefinite hangs).
 */
function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  if (!signal) return AbortSignal.timeout(timeoutMs);
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") {
    return any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  // Node.js 18 fallback
  return AbortSignal.timeout(timeoutMs);
}

// ─── TTL cache ─────────────────────────────────────────────────────────────

class TTLCache {
  private readonly store = new Map<string, { value: unknown; exp: number }>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, exp: Date.now() + ttlMs });
  }
}

// ─── Client ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000;

/**
 * Health degradation thresholds.
 * After this many consecutive transient failures the onDegradation callback fires.
 */
const DEGRADATION_THRESHOLDS = [
  { count: 3, level: "warning" as const },
  { count: 5, level: "error" as const },
] as const;

export class YouTrackClient {
  /** Base URL without /api suffix — used for constructing attachment URLs. */
  readonly baseUrl: string;

  private readonly apiBase: string;
  private readonly authHeader: string;
  private readonly cache = new TTLCache();

  /**
   * Count of consecutive transient failures across all API calls.
   * Reset on any successful response or on semantic (4xx) errors,
   * because 4xx means the instance is reachable — the request is just wrong.
   */
  private consecutiveFailures = 0;

  /**
   * Optional callback fired when consecutive transient failure count crosses a
   * degradation threshold. Wire to server.sendLoggingMessage in index.ts so
   * health events flow through the MCP logging channel, not tool results.
   */
  onDegradation?: (level: "warning" | "error", message: string) => void;

  constructor(config: YouTrackConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiBase = this.baseUrl + "/api";
    this.authHeader = `Bearer ${config.token}`;
  }

  /**
   * Performs a GET request against the YouTrack REST API, returning JSON.
   *
   * @param path    API path, e.g. `/issues/FOO-1`
   * @param params  Query parameters (fields, $top, $skip, etc.)
   * @param ttlMs   Optional TTL for in-memory cache. Omit to skip caching.
   */
  /**
   * @param signal  Optional AbortSignal from RequestHandlerExtra. When provided,
   *                the HTTP request is cancelled if the MCP client abandons the call.
   *                Uses AbortSignal.any() on Node.js 20+; falls back to timeout-only
   *                on Node.js 18.
   */
  async get<T>(path: string, params?: Params, ttlMs?: number, signal?: AbortSignal): Promise<T> {
    const urlStr = this.buildUrl(path, params);

    const cacheKey = ttlMs !== undefined ? urlStr : null;
    if (cacheKey) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) return cached;
    }

    const data = await this.fetchWithRetry<T>(() => this.fetchJson<T>(urlStr, signal), signal);
    if (cacheKey) this.cache.set(cacheKey, data, ttlMs!);
    return data;
  }

  /**
   * Force-fetches path bypassing the TTL cache, then re-populates it.
   * Used by the warmup and background refresh scheduler to keep reference data
   * current without waiting for TTL expiry.
   *
   * The cache key is identical to what `get` produces for the same arguments,
   * so subsequent `get` calls will hit the freshly populated entry.
   */
  async refresh<T>(path: string, params?: Params, ttlMs?: number, signal?: AbortSignal): Promise<T> {
    const urlStr = this.buildUrl(path, params);
    const data = await this.fetchWithRetry<T>(() => this.fetchJson<T>(urlStr, signal), signal);
    if (ttlMs !== undefined) this.cache.set(urlStr, data, ttlMs);
    return data;
  }

  private buildUrl(path: string, params?: Params): string {
    const url = new URL(`${this.apiBase}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /**
   * Downloads a binary resource (e.g. image attachment, thumbnail) from an
   * absolute or root-relative URL, authenticating with the YouTrack token.
   *
   * Returns base64-encoded content and the resolved MIME type.
   * Transient failures (timeout, 5xx) are automatically retried.
   */
  async getBytes(url: string, signal?: AbortSignal): Promise<{ data: string; mimeType: string }> {
    const absoluteUrl = /^https?:\/\//i.test(url)
      ? url
      : `${this.baseUrl}${url.startsWith("/") ? url : "/" + url}`;

    return this.fetchWithRetry(async () => {
      let response: Response;
      try {
        response = await fetch(absoluteUrl, {
          headers: { Authorization: this.authHeader },
          signal: withTimeout(TIMEOUT_MS, signal),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new YouTrackError(
            `Attachment download timed out: ${absoluteUrl}`,
            undefined,
            true,
          );
        }
        // Distinguish cancellation from network errors
        if (signal?.aborted) {
          throw new YouTrackError("Attachment download cancelled", undefined, false);
        }
        throw new YouTrackError(
          err instanceof Error ? err.message : "Network error during attachment download",
          undefined,
          true,
        );
      }

      if (!response.ok) {
        throw new YouTrackError(
          `Attachment download failed: ${absoluteUrl}`,
          response.status,
          isTransientStatus(response.status),
        );
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const mimeType = contentType.split(";")[0].trim();
      const buffer = await response.arrayBuffer();
      const data = Buffer.from(buffer).toString("base64");
      return { data, mimeType };
    }, signal);
  }

  /**
   * Generic retry wrapper.
   *
   * Retries the supplied async function on transient YouTrackErrors only.
   * Semantic errors (400, 401, 403, 404) are thrown immediately — they will not
   * resolve on their own and the LLM can act on the enriched hint text directly.
   *
   * On final failure the error is re-thrown with retryCount set so the LLM knows
   * retrying itself is futile.
   */
  private async fetchWithRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      // If the client cancelled, stop immediately — no point retrying
      if (signal?.aborted) {
        throw new YouTrackError("Request cancelled by client", undefined, false);
      }

      try {
        const result = await fn();
        this.consecutiveFailures = 0;
        return result;
      } catch (err) {
        const transient = err instanceof YouTrackError && err.isTransient;
        const hasRetries = attempt < RETRY_DELAYS_MS.length;

        // Don't retry if the client has cancelled
        if (transient && hasRetries && !signal?.aborted) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }

        // Final failure — update health counters, enrich error with retry info, re-throw
        this.recordFailure(err);

        if (err instanceof YouTrackError && attempt > 0) {
          throw new YouTrackError(err.message, err.statusCode, err.isTransient, attempt);
        }
        throw err;
      }
    }
  }

  /**
   * Updates consecutive failure counter and fires onDegradation at thresholds.
   * Only transient errors count against availability.
   */
  private recordFailure(err: unknown): void {
    if (err instanceof YouTrackError && err.isTransient) {
      this.consecutiveFailures++;
      for (const { count, level } of DEGRADATION_THRESHOLDS) {
        if (this.consecutiveFailures === count) {
          this.onDegradation?.(
            level,
            `YouTrack ${level === "error" ? "appears unreachable" : "appears unstable"} — ` +
            `${this.consecutiveFailures} consecutive transient failures. ` +
            `Base URL: ${this.baseUrl}. Last: ${err.message}`,
          );
          break;
        }
      }
    } else {
      // Semantic 4xx: instance is reachable, reset counter
      this.consecutiveFailures = 0;
    }
  }

  private async fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
        },
        signal: withTimeout(TIMEOUT_MS, signal),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new YouTrackError(`Request timed out after ${TIMEOUT_MS}ms`, undefined, true);
      }
      if (signal?.aborted) {
        throw new YouTrackError("Request cancelled by client", undefined, false);
      }
      throw new YouTrackError(
        err instanceof Error ? err.message : "Network error",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      const detail = await parseErrorBody(response);
      throw new YouTrackError(detail, response.status, isTransientStatus(response.status));
    }

    return response.json() as Promise<T>;
  }
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const json = await response.json() as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    return json.error_description ?? json.error ?? json.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

// ─── Cache TTLs ────────────────────────────────────────────────────────────

/** Reference data that almost never changes (link types, custom field bundles). */
export const TTL_HOUR = 60 * 60 * 1000;

/** Organisational data that changes rarely (project list, schemas). */
export const TTL_5MIN = 5 * 60 * 1000;

/** User identity for the duration of the MCP server process. */
export const TTL_SESSION = Number.MAX_SAFE_INTEGER;

// ─── Factory ───────────────────────────────────────────────────────────────

export function createClient(): YouTrackClient {
  const baseUrl = process.env.YOUTRACK_BASE_URL;
  const token = process.env.YOUTRACK_TOKEN;

  if (!baseUrl) {
    throw new Error(
      "YOUTRACK_BASE_URL is required.\n" +
      "  Example: https://yourcompany.youtrack.cloud"
    );
  }
  if (!token) {
    throw new Error(
      "YOUTRACK_TOKEN is required.\n" +
      "  Create one at: Profile → Account Security → Tokens"
    );
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`YOUTRACK_BASE_URL is not a valid URL: "${baseUrl}"`);
  }

  return new YouTrackClient({ baseUrl, token });
}
