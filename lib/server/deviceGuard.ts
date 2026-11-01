import "server-only";

import { isCodeBlocked, registerCodeFailure } from "@/lib/server/attempts";

// Who is guessing? (shared by /api/tournament/open and the PIN routes)
//
// A school puts a whole class behind ONE public IP. Counting wrong guesses per IP
// alone would let a few typos lock everybody out. So two layers:
//   1. per DEVICE (httpOnly random cookie `sc_dev`, set when missing): 20 wrong
//      guesses / 10 min block THAT device only.
//   2. per IP (IPv6 by /64): a much higher ceiling (200) against mass guessing —
//      a guesser who rotates the cookie to dodge (1) still hits this.
// Only WRONG guesses count; a correct code/PIN never does.
export const DEVICE_COOKIE = "sc_dev";
export const DEVICE_MAX_FAILURES = 20;
export const IP_MAX_FAILURES = 200;
const DEVICE_ID_RE = /^[0-9a-f]{32}$/;

export function readDeviceId(req: Request): string | null {
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

/** Run `handler` with a device id (existing valid cookie or a fresh one) and set the cookie when new. */
export async function withDeviceCookie(
  req: Request,
  cookiePath: string,
  handler: (device: string) => Promise<Response>,
): Promise<Response> {
  const existing = readDeviceId(req);
  const device = existing ?? newDeviceId();
  const res = await handler(device);
  if (!existing) {
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    res.headers.append(
      "set-cookie",
      `${DEVICE_COOKIE}=${device}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    );
  }
  return res;
}

/** Is this device (or its IP) blocked for `scope`? `fresh` = confirm against the DB (use on a CORRECT guess). */
export async function isGuessBlocked(scope: string, device: string, req: Request, fresh = false): Promise<boolean> {
  const f = fresh ? { fresh: true } : {};
  return (
    (await isCodeBlocked(`${scope}:d:${device}`, req, { max: DEVICE_MAX_FAILURES, ...f })) ||
    (await isCodeBlocked(scope, req, { max: IP_MAX_FAILURES, ...f }))
  );
}

/** Count a WRONG guess against device and IP. True when it tipped either into a block. */
export async function registerGuessFailure(scope: string, device: string, req: Request): Promise<boolean> {
  const [d, i] = await Promise.all([
    registerCodeFailure(`${scope}:d:${device}`, req, { max: DEVICE_MAX_FAILURES }),
    registerCodeFailure(scope, req, { max: IP_MAX_FAILURES }),
  ]);
  return d || i;
}
