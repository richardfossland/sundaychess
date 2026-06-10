// Per-player chess clocks derived from move timestamps — no extra schema.
// Pure + shared: the SERVER computes the authoritative snapshot (flag-fall
// enforcement in /api/move and /api/game/claim); the CLIENT only ticks a
// received snapshot down locally.
//
// Time model: each side's used time is the sum of the gaps before their own
// moves; the side to move is also charged for the gap since the last move
// (or since the round started). t0 = the round's started_at, which is FIXED:
// the organizer's "+1 min" only grows rounds.extended_ms (the round
// countdown), so extensions never touch chess-clock accounting.

export interface MoveStamp {
  ply: number; // 1-based; odd = white's move
  createdAt: string;
}

export interface ClockSnapshot {
  whiteMs: number; // remaining, clamped at 0
  blackMs: number;
  /** the side that has run out of time, if any */
  flagged: "w" | "b" | null;
}

export function computeClocks(opts: {
  clockSec: number;
  startedAt: string;
  /** moves ordered by ply ascending */
  moves: MoveStamp[];
  /** side to move now */
  turn: "w" | "b";
  now: number | string | Date;
  /** false once the game is over — the running side stops accruing */
  running: boolean;
}): ClockSnapshot {
  const total = opts.clockSec * 1000;
  const nowMs = new Date(opts.now).getTime();
  let prev = new Date(opts.startedAt).getTime();
  let whiteUsed = 0;
  let blackUsed = 0;

  for (const m of opts.moves) {
    const at = new Date(m.createdAt).getTime();
    const dur = Math.max(0, at - prev);
    if (m.ply % 2 === 1) whiteUsed += dur;
    else blackUsed += dur;
    prev = at;
  }

  if (opts.running) {
    const thinking = Math.max(0, nowMs - prev);
    if (opts.turn === "w") whiteUsed += thinking;
    else blackUsed += thinking;
  }

  const whiteMs = Math.max(0, total - whiteUsed);
  const blackMs = Math.max(0, total - blackUsed);
  // Only one side can meaningfully be flagged; prefer the side to move (the
  // paused side can only be at 0 from a historic overshoot).
  const flagged =
    opts.turn === "w" && whiteMs <= 0
      ? "w"
      : opts.turn === "b" && blackMs <= 0
        ? "b"
        : whiteMs <= 0
          ? "w"
          : blackMs <= 0
            ? "b"
            : null;
  return { whiteMs, blackMs, flagged };
}

/** mm:ss (or s.t under 20s) for clock displays. */
export function fmtClock(ms: number): string {
  if (ms < 20_000) return (ms / 1000).toFixed(1);
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
