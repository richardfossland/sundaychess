import { openTournamentByHostCode } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, ipKey, withApi } from "@/lib/server/http";
import { DEVICE_COOKIE, IP_MAX_FAILURES, isGuessBlocked, registerGuessFailure, withDeviceCookie } from "@/lib/server/deviceGuard";
import { signPairToken } from "@/lib/server/pair";
import { isResumeCodeShape, normalizeResumeCode } from "@/lib/codes";

// POST /api/tournament/open — reopen a tournament board with the host code.
export const POST = withApi(handlePost);

// Device + IP failure counting lives in lib/server/deviceGuard.ts (shared with the PIN routes).
export { DEVICE_COOKIE, IP_MAX_FAILURES };
const DEVICE_COOKIE_PATH = "/api/tournament/open";

async function handlePost(req: Request): Promise<Response> {
  return withDeviceCookie(req, DEVICE_COOKIE_PATH, (device) => handleOpen(req, device));
}

async function handleOpen(req: Request, device: string): Promise<Response> {
  const body = await readJson<{ hostCode?: string }>(req);
  const code = normalizeResumeCode(body?.hostCode?.toString() ?? "");
  if (!code) return fail(400, "missing_code");
  // H5: the shape check is the FIRST substantive line, ahead of EITHER rate
  // limiter below: a code that cannot exist is a 400, decided before the
  // database and before any limiter is touched.
  if (!isResumeCodeShape(code)) return fail(400, "invalid_code");

  if (
    !rateLimit(`open:dev:${device}`, 20, 60_000) ||
    !rateLimit(`open:ip:${ipKey(req)}`, 200, 60_000)
  ) {
    return fail(429, "rate_limited");
  }
  if (await isGuessBlocked("open", device, req)) return fail(429, "rate_limited");

  const t = await openTournamentByHostCode(code);
  if (!t) {
    if (await registerGuessFailure("open", device, req)) return fail(429, "rate_limited");
    return fail(404, "not_found");
  }
  // Correct code: confirm the block against the DB, not the per-isolate
  // negative cache (see AttemptOpts.fresh) — otherwise 200-vs-429 is an oracle.
  if (await isGuessBlocked("open", device, req, true)) return fail(429, "rate_limited");
  // pairToken: proof of a correct host code (null when PAIR_SECRET is unset).
  return ok({ id: t.id, pairToken: await signPairToken(t.id, t.host_code) });
}
