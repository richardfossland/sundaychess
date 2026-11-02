import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { ipKey } from "@/lib/server/http";

// DB-backed wrong-code counter (migration 0015). A school hall puts 30 phones
// behind ONE public IP, so only FAILED code guesses count — correct phones are
// never throttled. 20 failures / 10 min per (scope, IP) blocks that IP for the
// scope. `scope` = tournament id (host code) or `open` (host-code lookup).
//
// FAIL OPEN: if the RPC errors (outage, migration not applied yet) we log and
// carry on — this limiter must never take an event down.

export const CODE_WINDOW_S = 600;
export const CODE_MAX_FAILURES = 20;

/** Optional per-call override of the failure threshold (default CODE_MAX_FAILURES). */
export type AttemptOpts = {
  max?: number;
  /** Window length in seconds (default CODE_WINDOW_S). */
  windowS?: number;
};

const CACHE_MAX = 2000;
/** Longest an isolate trusts a cached "blocked" (ms). The DB window is FIXED from
 * window_start (0015: it only restarts once expired), so the block ends at
 * window_start + window. An isolate that first sees the block late must not
 * cache it for a whole new window (~2x lockout, differing per isolate), so the
 * cache is only a short shield against hammering the RPC. */
export const BLOCK_CACHE_MS = 30_000;
// Only "blocked" is cached, and only briefly. "Not blocked" is NEVER
// cached: another isolate may have blocked the IP a moment ago, and a stale
// "clean" answer would give a CORRECT code 200 while wrong ones get 429 — an
// oracle for a guesser who has already hit the block.
const cache = new Map<string, { until: number }>();

function remember(key: string, ttlMs: number): void {
  cache.delete(key);
  cache.set(key, { until: Date.now() + Math.min(ttlMs, BLOCK_CACHE_MS) });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Test-only. */
export function __resetAttemptsCache(): void {
  cache.clear();
}

export async function isCodeBlocked(scope: string, req: Request, opts: AttemptOpts = {}): Promise<boolean> {
  const key = `${scope}|${ipKey(req)}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return true;
  try {
    const { data, error } = await createServiceClient().rpc("code_blocked", {
      p_scope: scope,
      p_ip: ipKey(req),
      p_window_s: opts.windowS ?? CODE_WINDOW_S,
      p_max: opts.max ?? CODE_MAX_FAILURES,
    });
    if (error) throw error;
    if (data === true) {
      remember(key, BLOCK_CACHE_MS);
      return true;
    }
    return false;
  } catch (e) {
    console.error("[code_blocked] fail-open", e);
    return false;
  }
}

/** Record one wrong guess. Returns true when the IP is now blocked. */
export async function registerCodeFailure(scope: string, req: Request, opts: AttemptOpts = {}): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("register_code_failure", {
      p_scope: scope,
      p_ip: ipKey(req),
      p_window_s: opts.windowS ?? CODE_WINDOW_S,
      p_max: opts.max ?? CODE_MAX_FAILURES,
    });
    if (error) throw error;
    // The failure that trips the block IS in the current fixed window, so the
    // block cannot outlast it; still capped at BLOCK_CACHE_MS (remember()).
    if (data === true) remember(`${scope}|${ipKey(req)}`, (opts.windowS ?? CODE_WINDOW_S) * 1000);
    return data === true;
  } catch (e) {
    console.error("[register_code_failure] fail-open", e);
    return false;
  }
}
