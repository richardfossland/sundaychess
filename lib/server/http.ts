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

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IP_MAX_LEN = 64;
/** Bucket key for anything that is not a well-formed IP. One shared bucket:
 * raw header text is never stored or used as a key. */
export const INVALID_IP = "invalid";

/** Strict parse of a WHOLE header value. Returns the canonical text form
 * (IPv4 dotted, IPv6 lowercase) or null. */
function parseIp(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > IP_MAX_LEN) return null;
  if (IPV4_RE.test(v)) return v;
  if (!v.includes(":")) return null;
  let a = v.toLowerCase().split("%")[0];
  if (!/^[0-9a-f:.]+$/.test(a)) return null;
  const v4 = a.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:1.2.3.4
  if (v4) {
    if (!IPV4_RE.test(v4[2])) return null;
    const o = v4[2].split(".").map(Number);
    a = v4[1] + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const parts = a.split("::");
  if (parts.length > 2) return null;
  const h = parts[0] ? parts[0].split(":") : [];
  const t = parts.length === 1 ? [] : parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 1 ? 0 : 8 - h.length - t.length;
  if (fill < 1 && parts.length === 2) return null; // "::" must stand for ≥1 group
  if (parts.length === 1 && h.length !== 8) return null;
  const groups = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

/** The caller's IP, or a safe sentinel. Behind Cloudflare the edge sets
 * CF-Connecting-IP and the caller cannot spoof it; X-Forwarded-For is
 * client-supplied (its first hop is attacker-controlled), so it is trusted ONLY
 * outside production (local dev / tests). The whole value must parse as an IP —
 * anything else becomes INVALID_IP (a single shared bucket). */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf !== null) return parseIp(cf) ?? INVALID_IP;
  if (process.env.NODE_ENV !== "production") {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd !== null) {
      if (fwd.length > 512) return INVALID_IP;
      return parseIp(fwd.split(",")[0]) ?? INVALID_IP;
    }
  }
  return "local";
}

/** Limiter/attempt key for an IP. IPv4 → as is. IPv6 → the /64 prefix: a single
 * subscriber gets a whole /64 and can rotate through 2^64 addresses, so keying
 * on the full address would let one client mint a fresh bucket per request.
 * Anything that is not a valid IP → "invalid" (never raw text). */
export function ipKeyOf(ip: string): string {
  if (ip === "local") return ip;
  const p = parseIp(ip);
  if (!p) return INVALID_IP;
  if (!p.includes(":")) return p;
  const m = p.match(/^0:0:0:0:0:ffff:([0-9a-f]+):([0-9a-f]+)$/); // IPv4-mapped
  if (m) {
    const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return p.split(":").slice(0, 4).join(":") + "::/64";
}

/** THE key to use for wrong-code counting. */
export function ipKey(req: Request): string {
  return ipKeyOf(clientIp(req));
}
