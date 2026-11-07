// Code generation for join PINs and human-friendly resume codes.
// Pure + injectable RNG so it is deterministic under test.

// Ambiguous characters removed: I, O, 0, 1 (and L vs 1 risk → keep L, drop 1).
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no I, O
const ALNUM = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

export type Rng = () => number; // returns [0,1)

/** Kryptografisk tilfeldig heltall i [0, n) uten modulo-skjevhet (forkaster
 * verdier over den største n-multippelen under 2^32). Standard for alle koder. */
function secureInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}

/** Med injisert Rng (tester): deterministisk. Uten: crypto.getRandomValues. */
function intFn(rng?: Rng): (n: number) => number {
  return rng ? (n) => Math.floor(rng() * n) : secureInt;
}

function pick(alphabet: string, int: (n: number) => number): string {
  return alphabet[int(alphabet.length)];
}

/** 6-digit room PIN, e.g. "402815". Leading digits allowed. */
export function generatePin(rng?: Rng): string {
  const int = intFn(rng);
  let pin = "";
  for (let i = 0; i < 6; i++) pin += int(10).toString();
  return pin;
}

/** Resume code: 4 letters + dash + 2 alphanumerics, e.g. "KOLE-7F".
 * No ambiguous characters. Kort med vilje: elever skriver den inn selv. */
export function generateResumeCode(rng?: Rng): string {
  const int = intFn(rng);
  let head = "";
  for (let i = 0; i < 4; i++) head += pick(LETTERS, int);
  let tail = "";
  for (let i = 0; i < 2; i++) tail += pick(ALNUM, int);
  return `${head}-${tail}`;
}

/** Host code: 10 tegn fra samme utvetydige alfabet, vist som "K7MQX-4RT9B".
 * (~50 bit mot ~25 bit for gamle 4+2-koder.) Gamle koder virker fortsatt. */
export function generateHostCode(rng?: Rng): string {
  const int = intFn(rng);
  let code = "";
  for (let i = 0; i < 10; i++) {
    if (i === 5) code += "-";
    code += pick(ALNUM, int);
  }
  return code;
}

/** Mask a resume/host code for display on a shared screen, e.g. "KOLE-7F" →
 * "••••-••". Every character but the dash becomes a bullet, so the shape (and
 * therefore "this is a code") stays legible while the value doesn't. Works on
 * any length/format, not just the 4+2 shape, so it degrades safely if the
 * generator ever changes. */
export function maskCode(code: string): string {
  return code.replace(/[^-]/g, "•");
}

/** Normalise a user-typed code: uppercase, strip spaces, ensure single dash.
 * Kjenner begge former: 6 tegn -> "XXXX-XX" (elevkode + gammel vertskode),
 * 10 tegn -> "XXXXX-XXXXX" (ny vertskode). Alt annet slippes uendret igjennom. */
export function normalizeResumeCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length === 6) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  if (cleaned.length === 10) return `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
  return input.trim().toUpperCase();
}

// normalizeResumeCode PASSES ANYTHING THAT ISN'T 6 or 10 characters THROUGH
// unchanged (uppercased+trimmed), so a caller that hands its output straight to
// a `.eq("host_code", …)` lookup queries on arbitrary client input. Check the
// shape first and answer 400 — a code that cannot exist is a client error, not
// a database round-trip.
const RESUME_CODE_RE = /^[A-Z]{4}-[A-Z0-9]{2}$/;
const HOST_CODE_RE = /^[A-Z0-9]{5}-[A-Z0-9]{5}$/;

/** Elevens gjenopptakskode (og gamle vertskoder): 4 bokstaver, bindestrek, 2 tegn.
 * BEVISST uendret og streng: elevkoder skal ikke bli lengre eller mer permissive. */
export function isResumeCodeShape(code: unknown): code is string {
  return typeof code === "string" && RESUME_CODE_RE.test(code);
}

/** Vertskode: gammel kort form ELLER ny 10-tegns form (begge normalisert). */
export function isHostCodeShape(code: unknown): code is string {
  return (
    typeof code === "string" && (RESUME_CODE_RE.test(code) || HOST_CODE_RE.test(code))
  );
}

const PIN_RE = /^\d{6}$/;
export function isValidPin(input: string): boolean {
  return PIN_RE.test(input.trim());
}

// RFC-4122 shape (version 1-5, variant 8/9/a/b), case-insensitive — matches what
// Postgres's gen_random_uuid() produces. A malformed id (e.g. a bot probing
// `/api/tournament/probe`) must never reach Postgres: an id column rejects a
// non-UUID string with `22P02 invalid input syntax for type uuid`, which is a
// genuine client error, not a server outage — callers should check this FIRST
// and answer 404/400 instead of letting the query throw into a 503.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/** Generate a code guaranteed unique against an existing set (retry on clash). */
export function generateUnique(
  gen: (rng?: Rng) => string,
  taken: ReadonlySet<string>,
  rng?: Rng,
  maxTries = 50,
): string {
  for (let i = 0; i < maxTries; i++) {
    const code = gen(rng);
    if (!taken.has(code)) return code;
  }
  throw new Error("Could not generate a unique code");
}
