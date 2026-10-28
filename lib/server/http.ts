// Web-standard responses (no next/server dependency) so Route Handlers stay
// unit-testable in a plain Node environment.

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

export function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}

/** Stable error code for "the server (or its database) failed transiently".
 * Clients treat any 5xx as "try again" and keep their last good state — a
 * 5xx must never end a session (see shouldClearSession in lib/client/api.ts). */
export const TRANSIENT_ERROR = "server_error";

/** Thrown by the DB-backed wrong-code guard (lib/server/attempts.ts) when an IP
 * has failed too many codes for a scope. withApi turns it into a 429. */
export class RateLimitedError extends Error {
  constructor() {
    super("rate_limited");
  }
}

/** Wrap a route handler: any uncaught throw (typically a Supabase/network
 * error) becomes JSON 503 `server_error`, never Next's HTML 500 or a Worker
 * exception page. Handlers keep returning their own 4xx for client mistakes. */
export function withApi<A extends unknown[]>(
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof RateLimitedError) return fail(429, "rate_limited");
      const first = args[0];
      const where = first instanceof Request ? new URL(first.url).pathname : "?";
      console.error("[api]", where, e);
      return fail(503, TRANSIENT_ERROR);
    }
  };
}

/** Unwrap a supabase `{ data, error }` result: throw on error so an outage
 * surfaces as a failure (→ 503 via withApi) instead of an ignored write or an
 * empty read. */
export function must<T>(res: { data?: T | null; error: { message?: string } | null }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/** Parse a JSON body, returning null on malformed input. */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ---------- naive in-memory rate limiter ----------
// Per-process, best-effort. Good enough for a single-classroom deployment; the
// real backstop for abuse is server-side validation + the unique constraints.
// Documented in docs/RIG-TEST.md for a hardening pass (Upstash/edge KV) later.
//
// SELF-BOUNDING (critical on Cloudflare Workers): keys are high-cardinality
// (move:${ip}:${playerId} etc.) and the casual 1v1 feature mints endless new
// player ids, so without eviction this Map would grow for the whole isolate
// lifetime → memory pressure → Error 1102. Background timers don't run between
// Worker requests, so eviction must happen ON ACCESS: when the map gets large we
// sweep expired entries (and, as a last resort, evict the soonest-expiring) so
// it can never approach the 128 MB cliff.
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

function sweep(now: number): void {
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  if (buckets.size > MAX_BUCKETS) {
    // Still over cap with all entries live → drop the soonest-to-expire.
    const live = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const drop = buckets.size - MAX_BUCKETS;
    for (let i = 0; i < drop; i++) buckets.delete(live[i][0]);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) sweep(now);
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Test-only: reset limiter state between tests. */
export function __resetRateLimiter(): void {
  buckets.clear();
}

/** Test-only: current number of tracked buckets. */
export function __bucketCount(): number {
  return buckets.size;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

/** Limiter/attempt key for an IP. IPv4 → as is. IPv6 → the /64 prefix: a single
 * subscriber gets a whole /64 and can rotate through 2^64 addresses, so keying
 * on the full address would let one client mint a fresh bucket per request. */
export function ipKeyOf(ip: string): string {
  if (!ip.includes(":")) return ip;
  let a = ip.toLowerCase().split("%")[0];
  const v4 = a.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:1.2.3.4
  if (v4) {
    const o = v4[2].split(".").map(Number);
    if (o.some((n) => n > 255)) return ip;
    if (/^(::ffff:|0*:0*:0*:0*:0*:ffff:)$/.test(v4[1])) return v4[2];
    a = v4[1] + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, tail, extra] = a.split("::");
  if (extra !== undefined) return ip;
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return ip;
  const groups = [...h, ...Array(fill).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** THE key to use for wrong-code counting. */
export function ipKey(req: Request): string {
  return ipKeyOf(clientIp(req));
}
