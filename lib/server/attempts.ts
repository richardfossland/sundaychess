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

const CACHE_MAX = 2000;
const NOT_BLOCKED_TTL_MS = 30_000;
const cache = new Map<string, { blocked: boolean; until: number }>();

function remember(key: string, blocked: boolean, ttlMs: number): void {
  cache.delete(key);
  cache.set(key, { blocked, until: Date.now() + ttlMs });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Test-only. */
export function __resetAttemptsCache(): void {
  cache.clear();
}

export async function isCodeBlocked(scope: string, req: Request): Promise<boolean> {
  const key = `${scope}|${ipKey(req)}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.blocked;
  try {
    const { data, error } = await createServiceClient().rpc("code_blocked", {
      p_scope: scope,
      p_ip: ipKey(req),
      p_window_s: CODE_WINDOW_S,
      p_max: CODE_MAX_FAILURES,
    });
    if (error) throw error;
    if (data === true) return true; // not cached: re-ask, the window may have lapsed
    remember(key, false, NOT_BLOCKED_TTL_MS);
    return false;
  } catch (e) {
    console.error("[code_blocked] fail-open", e);
    return false;
  }
}

/** Record one wrong guess. Returns true when the IP is now blocked. */
export async function registerCodeFailure(scope: string, req: Request): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("register_code_failure", {
      p_scope: scope,
      p_ip: ipKey(req),
      p_window_s: CODE_WINDOW_S,
      p_max: CODE_MAX_FAILURES,
    });
    if (error) throw error;
    if (data === true) remember(`${scope}|${ipKey(req)}`, true, CODE_WINDOW_S * 1000);
    return data === true;
  } catch (e) {
    console.error("[register_code_failure] fail-open", e);
    return false;
  }
}
