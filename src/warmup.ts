/**
 * Startup warmup and background cache refresh.
 *
 * Goals:
 *   1. Pre-populate the TTL cache with stable reference data at startup so the
 *      first tool call never incurs a cold-miss latency or token cost.
 *   2. Confirm connectivity and token validity immediately on start, not on the
 *      first tool call.
 *   3. Keep reference data perpetually fresh via background timers so the LLM
 *      always works with current project lists, field definitions, etc.
 *
 * Warmup entries by TTL tier:
 *
 *   TTL_SESSION  — /users/me
 *     Fetched once. Confirms the token is valid. Logs "authenticated as …"
 *     so the operator immediately sees which account is being used.
 *     Never refreshed — user identity is stable for the process lifetime.
 *
 *   TTL_5MIN     — /admin/projects
 *     Projects are the primary scope for almost every tool call.
 *     Pre-caching them eliminates a round-trip on the very first search_issues.
 *     Refreshed every 5 minutes so newly created projects appear quickly.
 *
 *   TTL_HOUR     — /issueLinkTypes, /admin/customFieldSettings/customFields, /tags
 *     Stable reference catalogs. Pre-caching allows the LLM to reason about
 *     link types and custom field taxonomy without an extra tool call.
 *     Refreshed every hour — these rarely change, but the refresh ensures that
 *     schema changes (new field, new enum value) propagate within an hour.
 *
 * Failure handling:
 *   - All warmup fetches run in parallel. Individual failures are non-fatal.
 *   - If current-user fails → log error (token / URL likely wrong).
 *   - If other entries fail → log warning (partial data, tools still work).
 *   - Background refresh failures are logged as warnings; the stale cached
 *     value (if any) remains available until the next successful refresh.
 *
 * Background timers call client.refresh(), which bypasses the TTL cache and
 * writes a fresh value with a new TTL, maintaining a perpetual "always warm" state.
 */

import { REFERENCE_PAGE_SIZE, TTL_5MIN, TTL_HOUR, TTL_SESSION, type YouTrackClient } from "./client.js";
import * as F from "./fields.js";

type LogFn = (level: "info" | "warning" | "error", data: string) => void;

interface WarmupEntry {
  readonly label: string;
  readonly path: string;
  readonly params: Record<string, string | number>;
  readonly ttl: number;
}

// ─── Warmup catalogue ──────────────────────────────────────────────────────

const CURRENT_USER: WarmupEntry = {
  label: "current-user",
  path: "/users/me",
  params: { fields: F.USER },
  ttl: TTL_SESSION,
};

const FIVE_MIN_ENTRIES: readonly WarmupEntry[] = [
  {
    // Warms the cache for the get_projects tool (LIST projection)
    label: "projects",
    path: "/admin/projects",
    params: { fields: F.PROJECT_LIST, $top: REFERENCE_PAGE_SIZE },
    ttl: TTL_5MIN,
  },
  {
    // Warms the cache for the youtrack://projects resource (DETAIL projection)
    label: "projects-detail",
    path: "/admin/projects",
    params: { fields: F.PROJECT_DETAIL, $top: REFERENCE_PAGE_SIZE },
    ttl: TTL_5MIN,
  },
];

const HOUR_ENTRIES: readonly WarmupEntry[] = [
  {
    label: "link-types",
    path: "/issueLinkTypes",
    params: { fields: F.LINK_TYPE },
    ttl: TTL_HOUR,
  },
  {
    label: "global-custom-fields",
    path: "/admin/customFieldSettings/customFields",
    params: { fields: F.GLOBAL_CUSTOM_FIELD, $top: REFERENCE_PAGE_SIZE },
    ttl: TTL_HOUR,
  },
  {
    label: "tags",
    path: "/tags",
    params: { fields: F.TAG, $top: REFERENCE_PAGE_SIZE },
    ttl: TTL_HOUR,
  },
];

// ─── Fetch helpers ─────────────────────────────────────────────────────────

async function fetchEntry(client: YouTrackClient, entry: WarmupEntry): Promise<void> {
  await client.refresh(entry.path, entry.params, entry.ttl);
}

async function fetchBatch(
  client: YouTrackClient,
  entries: readonly WarmupEntry[],
): Promise<{ ok: string[]; failed: Array<{ label: string; reason: string }> }> {
  const results = await Promise.allSettled(entries.map(e => fetchEntry(client, e)));
  const ok: string[] = [];
  const failed: Array<{ label: string; reason: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      ok.push(entries[i].label);
    } else {
      failed.push({
        label: entries[i].label,
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  return { ok, failed };
}

// ─── Startup warmup ────────────────────────────────────────────────────────

async function runStartupWarmup(client: YouTrackClient, log: LogFn): Promise<void> {
  // Fetch current user first — it's both a connectivity check and an identity confirmation.
  // Run separately so we can provide a tailored log message and distinguish auth failures.
  let userLabel = "unknown";
  try {
    const user = await client.refresh<{ login?: string; fullName?: string }>(
      CURRENT_USER.path,
      CURRENT_USER.params,
      CURRENT_USER.ttl,
    );
    userLabel = user.fullName ?? user.login ?? "unknown";
  } catch (e) {
    log(
      "error",
      `Warmup: failed to authenticate — ${e instanceof Error ? e.message : String(e)}. ` +
      "Check YOUTRACK_BASE_URL and YOUTRACK_TOKEN.",
    );
    // Non-fatal: proceed with remaining entries even if auth check failed.
    // The error will surface naturally when tools are called.
  }

  // Fetch remaining reference entries in parallel
  const rest = [...FIVE_MIN_ENTRIES, ...HOUR_ENTRIES];
  const { ok, failed } = await fetchBatch(client, rest);

  if (failed.length === 0) {
    log(
      "info",
      `Warmup complete — authenticated as ${userLabel}, ` +
      `${ok.length} reference datasets cached (${ok.join(", ")})`,
    );
  } else {
    const failSummary = failed.map(f => `${f.label}: ${f.reason}`).join("; ");
    log(
      "warning",
      `Warmup partial — authenticated as ${userLabel}, ` +
      `cached: ${ok.join(", ")}; ` +
      `failed: ${failSummary}`,
    );
  }
}

// ─── Background refresh ─────────────────────────────────────────────────────

function scheduleRefreshBatch(
  client: YouTrackClient,
  entries: readonly WarmupEntry[],
  intervalMs: number,
  log: LogFn,
): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { failed } = await fetchBatch(client, entries);
      if (failed.length > 0) {
        const failSummary = failed.map(f => `${f.label}: ${f.reason}`).join("; ");
        log("warning", `Background refresh failed: ${failSummary}`);
      }
      // Successful refreshes are silent — no need to pollute the log on every cycle
    } catch (e) {
      log("warning", `Background refresh error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  }, intervalMs);

  // Do not prevent process exit if the event loop drains
  timer.unref();
  return timer;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Starts non-blocking startup warmup and schedules perpetual background refresh.
 *
 * Must be called AFTER server.connect() so that log messages can be sent
 * through the MCP transport.
 *
 * Returns a cleanup function that cancels all background timers.
 * Call it on SIGTERM / SIGINT for graceful shutdown.
 */
export function scheduleWarmup(client: YouTrackClient, log: LogFn): () => void {
  // Fire-and-forget: warmup runs concurrently, server is immediately available
  runStartupWarmup(client, log).catch(e => {
    log("error", `Warmup threw unexpectedly: ${e instanceof Error ? e.message : String(e)}`);
  });

  const timers: NodeJS.Timeout[] = [
    scheduleRefreshBatch(client, FIVE_MIN_ENTRIES, TTL_5MIN, log),
    scheduleRefreshBatch(client, HOUR_ENTRIES, TTL_HOUR, log),
  ];

  return () => timers.forEach(clearInterval);
}
