import "server-only";

// Pairing token: proof that a device once presented the CORRECT host code for a
// tournament. Lets the teacher's device skip the per-IP wrong-code block (a
// school hall shares ONE public IP, so a pupil guessing wrong codes must never
// lock the teacher out). Stateless: HMAC-SHA256(PAIR_SECRET,
// "host|<tournamentId>|<host_code>") — it stops verifying the moment the host
// code changes. Needs PAIR_SECRET (Worker secret). Missing in production →
// tokens are disabled and the code-block path applies as before (logged once,
// never a crash). Dev/test without the secret uses a fixed string.

const DEV_SECRET = "dev-only-pair-secret-do-not-use-in-production";
let warned = false;

export const PAIR_HEADER = "x-pair-token";

function secret(): string | null {
  const s = process.env.PAIR_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV !== "production") return DEV_SECRET;
  if (!warned) {
    warned = true;
    console.error("[pair] PAIR_SECRET missing in production – pairing tokens disabled");
  }
  return null;
}

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison. */
export function ctEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(message: string): Promise<string | null> {
  const s = secret();
  if (!s) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Sign a token for (tournament, host code); null when tokens are disabled. */
export async function signPairToken(
  tournamentId: string,
  hostCode: string,
): Promise<string | null> {
  return hmac(`host|${tournamentId}|${hostCode}`);
}

/** Physical-tournament host token. Own message prefix (`phys|`), so a token for
 * a chess tournament can never authenticate a physical one or vice versa. */
export async function signPhysicalToken(id: string, hostCode: string): Promise<string | null> {
  return hmac(`phys|${id}|${hostCode}`);
}

export async function verifyPhysicalToken(id: string, hostCode: string, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return false;
  const expected = await signPhysicalToken(id, hostCode);
  return expected !== null && ctEqual(expected, token);
}

/** Board key `k` printed in the QR on a board card: proves the reporter holds
 * that card. Unforgeable without PAIR_SECRET; null when it is missing. */
export async function signBoardKey(id: string, round: number, board: number): Promise<string | null> {
  return hmac(`board|${id}|${round}|${board}`);
}

export async function verifyBoardKey(id: string, round: number, board: number, k: unknown): Promise<boolean> {
  if (typeof k !== "string" || k.length === 0 || k.length > 200) return false;
  const expected = await signBoardKey(id, round, board);
  return expected !== null && ctEqual(expected, k);
}

/** True only for a token minted for exactly this tournament + host code. */
export async function verifyPairToken(
  tournamentId: string,
  hostCode: string,
  token: unknown,
): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return false;
  const expected = await signPairToken(tournamentId, hostCode);
  return expected !== null && ctEqual(expected, token);
}

/** Test-only: re-arm the one-time warning. */
export function __resetPairWarning(): void {
  warned = false;
}
