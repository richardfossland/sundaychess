// The trust model behind every Realtime payload (see lib/realtime.ts, §7).
//
// WHY THIS FILE EXISTS
//
// Realtime is reached with the PUBLIC anon key — every student's browser holds
// it — and every topic name is derivable from the unauthenticated
// `GET /api/tournament/[id]` payload, which lists every game id. So the app has
// no way to tell a broadcast the SERVER sent from one a classmate typed into a
// console. `lib/realtime.ts` has always said broadcasts are "hints to refetch
// authoritative state, never the source of truth"; these helpers are what makes
// that true in the consumers rather than only in the comment.
//
// THE RULE, in three parts:
//
//   1. SHAPE FIRST. A payload that is not exactly the shape the server sends is
//      dropped whole, so nothing downstream has to defend against a FEN that is
//      an object or a status that is a number.
//   2. `status` IS NEVER READ FROM A PAYLOAD. A game ends when an authoritative
//      fetch says it ended, and only then. A forged `result` used to end a
//      classmate's game permanently — the poll stops the moment status leaves
//      "live", so nothing ever healed it.
//   3. A `position` MAY BE APPLIED for snappiness, but what it produces is
//      PROVISIONAL: the next authoritative fetch ISSUED AFTER it wins, whatever
//      ply the broadcast claimed. The monotonic ply guard arbitrates only
//      between two AUTHORITATIVE sources (a fetch vs. a fetch, a fetch vs. the
//      player's own optimistic move) — never between a fetch and a broadcast.
//      Without part 3 a forged `position` carrying a very high ply would be
//      accepted by the guard and then BLOCK the real position from ever being
//      adopted again.

import type { GameStatus, Turn } from "@/lib/types";

export const GAME_STATUSES: readonly GameStatus[] = [
  "live",
  "white_win",
  "black_win",
  "draw",
  "bye",
  "aborted",
];

// --- primitive shape checks -------------------------------------------------

export function isTurn(v: unknown): v is Turn {
  return v === "w" || v === "b";
}

export function isGameStatus(v: unknown): v is GameStatus {
  return typeof v === "string" && (GAME_STATUSES as string[]).includes(v);
}

const FEN_RANK = /^[prnbqkPRNBQK1-8]+$/;
const FEN_CASTLING = /^(-|K?Q?k?q?)$/;
const FEN_EN_PASSANT = /^(-|[a-h][36])$/;
const SQUARE = /^[a-h][1-8]$/;

/** A standard FEN: six space-separated fields, eight ranks that each account for
 * exactly eight files, a side to move of `w`/`b`, and plain numeric clocks.
 *
 * Stricter than "a string with 6 fields" on purpose — the value is handed
 * straight to `plyOf()` and to react-chessboard, so a merely well-shaped
 * nonsense board would still render as garbage or throw inside the board. All
 * three variants this app ships (lib/chess/variants.ts) are ordinary FENs, so
 * nothing legitimate is turned away. */
export function isFenString(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 100) return false;
  const f = v.split(" ");
  if (f.length !== 6) return false;
  const ranks = f[0].split("/");
  if (ranks.length !== 8) return false;
  for (const rank of ranks) {
    if (!FEN_RANK.test(rank)) return false;
    let files = 0;
    for (const c of rank) files += c >= "1" && c <= "8" ? Number(c) : 1;
    if (files !== 8) return false;
  }
  if (!isTurn(f[1])) return false;
  // `^(-|K?Q?k?q?)$` also matches the empty string — an absent field, not "no
  // castling rights" — so reject that explicitly.
  if (f[2] === "" || !FEN_CASTLING.test(f[2])) return false;
  if (!FEN_EN_PASSANT.test(f[3])) return false;
  return /^\d{1,3}$/.test(f[4]) && /^[1-9]\d{0,3}$/.test(f[5]);
}

/** A server clock snapshot as it arrives on the wire (no local receipt stamp). */
export interface ClockWire {
  whiteMs: number;
  blackMs: number;
  turn: Turn;
  running: boolean;
}

function isFiniteMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

export function isClockWire(v: unknown): v is ClockWire {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isFiniteMs(c.whiteMs) &&
    isFiniteMs(c.blackMs) &&
    isTurn(c.turn) &&
    typeof c.running === "boolean"
  );
}

export interface LastMoveWire {
  from: string;
  to: string;
  san?: string;
}

function isLastMoveWire(v: unknown): v is LastMoveWire {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  if (!SQUARE.test(String(m.from)) || !SQUARE.test(String(m.to))) return false;
  // SAN is only a display/sound hint; absent is fine, oversized is not.
  return (
    m.san === undefined ||
    m.san === null ||
    (typeof m.san === "string" && m.san.length > 0 && m.san.length <= 10)
  );
}

// --- payload validators -----------------------------------------------------

/** What the game channel's `position` event carries. NOTE the deliberate
 * absence of `status` from what consumers may USE: the server does put one on
 * the wire, and it is validated here so a malformed payload is still dropped
 * whole, but rule 2 above forbids reading it. */
export interface PositionPayload {
  fen: string;
  turn: Turn;
  status: GameStatus;
  lastMove?: LastMoveWire | null;
  clock?: ClockWire | null;
}

export function isValidPositionPayload(v: unknown): v is PositionPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (!isFenString(p.fen) || !isTurn(p.turn) || !isGameStatus(p.status)) return false;
  // The FEN's own side-to-move is the one the board renders from; a payload
  // whose `turn` disagrees with it is not something the server can produce.
  if (p.fen.split(" ")[1] !== p.turn) return false;
  if (p.lastMove != null && !isLastMoveWire(p.lastMove)) return false;
  if (p.clock != null && !isClockWire(p.clock)) return false;
  return true;
}

export interface ResultPayload {
  status: GameStatus;
}

export function isValidResultPayload(v: unknown): v is ResultPayload {
  if (typeof v !== "object" || v === null) return false;
  return isGameStatus((v as Record<string, unknown>).status);
}

/** The tournament-wide spectate feed adds the game id (one topic, many games). */
export interface SpectatePositionPayload {
  gameId: string;
  fen: string;
  clock?: ClockWire | null;
}

export function isValidSpectatePosition(v: unknown): v is SpectatePositionPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.gameId !== "string" || p.gameId.length === 0) return false;
  if (!isFenString(p.fen)) return false;
  return p.clock == null || isClockWire(p.clock);
}

export interface SpectateResultPayload {
  gameId: string;
  status: GameStatus;
}

export function isValidSpectateResult(v: unknown): v is SpectateResultPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.gameId === "string" && p.gameId.length > 0 && isGameStatus(p.status);
}

/** A draw offer / decline names its sender. Only the OPPONENT may raise or
 * withdraw a banner on my screen; anyone else's `by` is somebody poking at the
 * topic. (The 3 s poll reconciles `drawOfferedBy` anyway — this just stops the
 * banner from flickering in at all.) */
export function isValidDrawEvent(
  v: unknown,
  knownPlayers: ReadonlySet<string>,
): v is { by: string } {
  if (typeof v !== "object" || v === null) return false;
  const by = (v as Record<string, unknown>).by;
  return typeof by === "string" && knownPlayers.has(by);
}

// --- provisional state ------------------------------------------------------

/** One monotonic counter for the whole tab. Both sides of the comparison below
 * draw from it, so "was this fetch issued before or after that broadcast?" is
 * an exact question rather than a wall-clock guess. */
let stampCounter = 0;
export function nextStamp(): number {
  return ++stampCounter;
}

/** Marks board state that only an UNTRUSTED broadcast vouches for. */
export interface Provisional {
  /** `nextStamp()` taken at the instant the broadcast was applied. */
  stamp: number;
}

/** May an AUTHORITATIVE response (a `load()` fetch, or our own move's reply)
 * overwrite what the board currently shows?
 *
 * - `current.ply` — ply of the freshest position we are treating as settled.
 * - `incoming.ply` — ply the authoritative response carries.
 * - `incoming.issuedStamp` — `nextStamp()` taken when that request was SENT.
 * - `provisional` — non-null while the shown position came from a broadcast.
 *
 * A request issued after the broadcast landed reads server state at or after
 * the move that broadcast claimed (the server broadcasts only after committing
 * the move), so its answer is the truth about that claim — adopt it whatever
 * its ply. That is what heals a forged position, and it is the ONLY way a
 * lower ply is ever adopted. A response that was already in flight before the
 * broadcast proves nothing about it, so it falls back to the ply guard and
 * cannot roll a legitimate move back off the board. */
export function resolveAuthoritative(
  current: { ply: number },
  incoming: { ply: number; issuedStamp: number },
  provisional: Provisional | null,
): boolean {
  if (provisional && incoming.issuedStamp >= provisional.stamp) return true;
  return incoming.ply >= current.ply;
}

// --- reactions --------------------------------------------------------------

/** Incoming emoji reactions are client→client broadcasts: no server ever sees
 * them, so they are the one payload with NO authoritative version to fall back
 * on. The only defence is the gate below — allowlist, known sender, and a cap
 * on how many may land per second, since the harm here is a screenful of
 * floating emoji over a live board rather than a wrong position.
 *
 * The window is global rather than per-sender on purpose: it is the OVERLAY
 * being protected, and it fills up just as fast from five spoofed senders as
 * from one. */
export const REACTION_RATE_LIMIT_PER_SEC = 5;

export type ReactionGate = (
  payload: unknown,
  senders: ReadonlySet<string>,
) => string | null;

export function createReactionGate(
  allowed: readonly string[],
  limitPerSecond: number = REACTION_RATE_LIMIT_PER_SEC,
  now: () => number = Date.now,
): ReactionGate {
  const recent: number[] = [];
  return (payload, senders) => {
    if (typeof payload !== "object" || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.emoji !== "string" || !allowed.includes(p.emoji)) return null;
    if (typeof p.by !== "string" || !senders.has(p.by)) return null;
    const t = now();
    while (recent.length > 0 && t - recent[0] >= 1000) recent.shift();
    if (recent.length >= limitPerSecond) return null;
    recent.push(t);
    return p.emoji;
  };
}
