import { openTournamentByHostCode } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, ipKey, withApi } from "@/lib/server/http";
import { isCodeBlocked, registerCodeFailure } from "@/lib/server/attempts";
import { signPairToken } from "@/lib/server/pair";
import { isResumeCodeShape, normalizeResumeCode } from "@/lib/codes";

// POST /api/tournament/open — reopen a tournament board with the host code.
export const POST = withApi(handlePost);

// Who is guessing? (the rule, in one place)
//
// A school puts a whole class behind ONE public IP. If failures were counted per
// IP alone, 20 wrong guesses by pupils would lock the TEACHER out of reopening
// their own board — and the teacher's pair token cannot help, because this very
// route is what mints it. So the counting has two layers:
//   1. per DEVICE (an httpOnly random cookie, set here when missing): 20 wrong
//      guesses / 10 min block THAT device only. Other devices on the same IP are
//      unaffected, so pupils' failures never block the teacher's device.
//   2. per IP (IPv6 by /64): a much higher ceiling (IP_MAX_FAILURES) against mass
//      guessing — a guesser who rotates the cookie to dodge (1) still hits this.
// Request-rate limits follow the same split (device 20/min, IP 200/min).
// Only WRONG guesses count; a correct code never does.
export const DEVICE_COOKIE = "sc_dev";
const DEVICE_COOKIE_PATH = "/api/tournament/open";
const DEVICE_MAX_FAILURES = 20;
export const IP_MAX_FAILURES = 200;
const DEVICE_ID_RE = /^[0-9a-f]{32}$/;

function readDeviceId(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw || raw.length > 4096) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== DEVICE_COOKIE) continue;
    const v = part.slice(i + 1).trim();
    return DEVICE_ID_RE.test(v) ? v : null; // validated by FORM, never trusted raw
  }
  return null;
}

function newDeviceId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function handlePost(req: Request): Promise<Response> {
  const existing = readDeviceId(req);
  const device = existing ?? newDeviceId();
  const res = await handleOpen(req, device);
  if (!existing) {
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    res.headers.append(
      "set-cookie",
      `${DEVICE_COOKIE}=${device}; Path=${DEVICE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    );
  }
  return res;
}

async function handleOpen(req: Request, device: string): Promise<Response> {
  const body = await readJson<{ hostCode?: string }>(req);
  const code = normalizeResumeCode(body?.hostCode?.toString() ?? "");
  if (!code) return fail(400, "missing_code");
  // H5: the shape check is the FIRST substantive line, ahead of EITHER rate
  // limiter below: a code that cannot exist is a 400, decided before the
  // database and before any limiter is touched.
  if (!isResumeCodeShape(code)) return fail(400, "invalid_code");

  const devScope = `open:d:${device}`;
  if (
    !rateLimit(`open:dev:${device}`, 20, 60_000) ||
    !rateLimit(`open:ip:${ipKey(req)}`, 200, 60_000)
  ) {
    return fail(429, "rate_limited");
  }
  if (
    (await isCodeBlocked(devScope, req, { max: DEVICE_MAX_FAILURES })) ||
    (await isCodeBlocked("open", req, { max: IP_MAX_FAILURES }))
  ) {
    return fail(429, "rate_limited");
  }

  const t = await openTournamentByHostCode(code);
  if (!t) {
    const [d, i] = await Promise.all([
      registerCodeFailure(devScope, req, { max: DEVICE_MAX_FAILURES }),
      registerCodeFailure("open", req, { max: IP_MAX_FAILURES }),
    ]);
    if (d || i) return fail(429, "rate_limited");
    return fail(404, "not_found");
  }
  // Correct code: confirm the block against the DB, not the per-isolate
  // negative cache (see AttemptOpts.fresh) — otherwise 200-vs-429 is an oracle.
  if (
    (await isCodeBlocked(devScope, req, { max: DEVICE_MAX_FAILURES, fresh: true })) ||
    (await isCodeBlocked("open", req, { max: IP_MAX_FAILURES, fresh: true }))
  ) {
    return fail(429, "rate_limited");
  }
  // pairToken: proof of a correct host code (null when PAIR_SECRET is unset).
  return ok({ id: t.id, pairToken: await signPairToken(t.id, t.host_code) });
}
