// Coached post-game review — the PURE chess engine of the feature.
//
// Replays a stored PGN and, using the existing negamax `evaluateFen`, tags each
// move's eval swing (blunder / mistake / inaccuracy / good / best, plus the two
// special cases missed-mate and found-mate). This generalises the per-ply
// before/after comparison that `lib/client/HypeCallout.tsx` does for the
// projector, but here we keep ALL of it engine-derived and side-effect-free so
// it can be unit-tested and so it stays cheat-proof: every "truth" about the
// game comes from the engine, never from an LLM.
//
// No React, no network, no key. Safe to call on the server (per-player review).

import { Chess } from "chess.js";
import { evaluateFen } from "@/lib/chess/bot";

/** Severity tag for a single move, from the moving side's perspective. */
export type MoveTag =
  | "best" // essentially the engine's top choice (tiny or positive swing)
  | "good" // a reasonable move
  | "inaccuracy" // small drop
  | "mistake" // sizeable drop
  | "blunder" // game-changing drop
  | "missed_mate" // had a mate available, played something else
  | "found_mate"; // delivered checkmate

export type Side = "w" | "b";

export interface AnnotatedMove {
  /** 1-based ply index in the game. */
  ply: number;
  /** Move number (1, 1, 2, 2, …) as shown in notation. */
  moveNumber: number;
  /** Which side made this move. */
  side: Side;
  /** Standard algebraic notation, e.g. "Nf3", "Qxd5#". */
  san: string;
  from: string;
  to: string;
  /** Eval BEFORE the move, centipawns from the mover's perspective (+ = good
   * for the mover). null = position was already terminal (shouldn't happen). */
  cpBefore: number;
  /** Eval AFTER the move, still from the mover's perspective. */
  cpAfter: number;
  /** cpAfter − cpBefore, from the mover's perspective. Negative = the move hurt
   * the mover. This is the single number the coach narrates around. */
  delta: number;
  /** Did the mover have a forced mate available BEFORE moving? */
  hadMateBefore: boolean;
  /** Did this move deliver checkmate? */
  isMate: boolean;
  tag: MoveTag;
}

export interface PlayerReview {
  side: Side;
  name: string;
  moves: AnnotatedMove[];
  counts: Record<MoveTag, number>;
  /** Index into `moves` of the single worst move (most negative delta), or -1
   * if there were no moves for this side. */
  worstMoveIndex: number;
  /** Average centipawn loss across this player's moves (>= 0). A rough
   * "accuracy" proxy; lower is better. */
  averageCpLoss: number;
}

export interface GameReview {
  /** Per-ply annotations for the whole game (both sides interleaved). */
  moves: AnnotatedMove[];
  white: PlayerReview;
  black: PlayerReview;
  /** Final game result as understood from the PGN, if decisive. */
  result: "white_win" | "black_win" | "draw" | "unknown";
}

// Centipawn clamp so mate scores don't make a single Δ threshold meaningless.
// Mirrors HypeCallout.clampCp, widened a little for the finer review buckets.
const CP_CLAMP = 1500;
function clampCp(cp: number): number {
  return Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
}

// Δ thresholds (centipawns, from the mover's perspective). A move that loses
// more than this much eval gets the corresponding tag. Tuned a touch tighter
// than HypeCallout's single ±260 swing so the review has useful granularity.
const BLUNDER = -250;
const MISTAKE = -120;
const INACCURACY = -50;
// A move that does not lose ground (delta close to 0 or positive) is "best".
const BEST = -15;

/**
 * Classify a single move from its eval delta and mate context.
 *
 * Order matters: mate facts dominate centipawn deltas. Delivering mate is
 * always `found_mate`; throwing away a mate you had is always `missed_mate`,
 * even if the centipawn delta looks mild (the engine clamps mate to ±1500).
 */
export function classifyMove(args: {
  delta: number;
  hadMateBefore: boolean;
  isMate: boolean;
}): MoveTag {
  const { delta, hadMateBefore, isMate } = args;
  if (isMate) return "found_mate";
  if (hadMateBefore) return "missed_mate";
  if (delta <= BLUNDER) return "blunder";
  if (delta <= MISTAKE) return "mistake";
  if (delta <= INACCURACY) return "inaccuracy";
  if (delta <= BEST) return "good";
  return "best";
}

function emptyCounts(): Record<MoveTag, number> {
  return {
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    missed_mate: 0,
    found_mate: 0,
  };
}

/** Parse a PGN's `[Result "..."]` tag into our domain result. */
function resultFromPgn(pgn: string): GameReview["result"] {
  const m = pgn.match(/\[Result\s+"([^"]+)"\]/);
  switch (m?.[1]) {
    case "1-0":
      return "white_win";
    case "0-1":
      return "black_win";
    case "1/2-1/2":
      return "draw";
    default:
      return "unknown";
  }
}

/** Hard ceiling on how many plies get a (relatively expensive) engine eval.
 * `annotateGame` runs on a Cloudflare Worker (POST /api/review) where a runaway
 * synchronous negamax can trip the CPU limit (Error 1102), and on a Chromebook's
 * main thread (solo review). A normal classroom game is well under this; only a
 * pathological 100+-move marathon would hit it. Beyond the cap we still record
 * the move (so the move list is complete) but skip the eval (delta 0 → "best"),
 * which keeps the whole call bounded no matter how long the game ran. */
const MAX_EVAL_PLIES = 240;

/**
 * Replay `pgn` and annotate every move. Pure: no network, no key, no React.
 *
 * `evalDepth` is forwarded to `evaluateFen`. The default is 1: review's only
 * callers are the post-game summaries (server /api/review + solo SoloReview),
 * where a depth-2 negamax PER PLY, twice per move, is ~9× the cost and risks the
 * Worker CPU limit on long games. Depth 1 still surfaces blunders/hung pieces
 * (the eval swing is what the coach narrates) at a fraction of the cost. Eval
 * results are memoised per FEN, so the shared position between consecutive plies
 * (`after[i]` === `before[i+1]`) is only searched once — roughly halving the work.
 * Returns null if the PGN has no replayable moves (empty / overridden game).
 *
 * Each move is evaluated by:
 *   1. eval the position BEFORE the move (from the mover's perspective),
 *   2. eval the position AFTER the move (re-based to the same mover's
 *      perspective by negating, since `evaluateFen` is White-relative),
 *   3. delta = after − before, then `classifyMove`.
 */
export function annotateGame(
  pgn: string,
  whiteName: string,
  blackName: string,
  evalDepth = 1,
): GameReview | null {
  if (!pgn.trim()) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const hist = chess.history({ verbose: true });
  if (hist.length === 0) return null;

  // Memoise the engine eval per FEN: consecutive plies share a position
  // (`after[i]` === `before[i+1]`), so this halves the negamax searches.
  const evalCache = new Map<string, { cp: number; mate: 1 | -1 | null }>();
  const cachedEval = (fen: string) => {
    let v = evalCache.get(fen);
    if (!v) {
      v = evaluateFen(fen, evalDepth);
      evalCache.set(fen, v);
    }
    return v;
  };

  const moves: AnnotatedMove[] = [];
  hist.forEach((m, i) => {
    const side: Side = m.color; // "w" | "b"
    // `evaluateFen` is always from WHITE's perspective; re-base to the mover.
    const sign = side === "w" ? 1 : -1;

    // Past the cap, record the move but skip the eval (keeps the call bounded).
    const skipEval = i >= MAX_EVAL_PLIES;
    const beforeEval = skipEval ? { cp: 0, mate: null as 1 | -1 | null } : cachedEval(m.before);
    const afterEval = skipEval ? { cp: 0, mate: null as 1 | -1 | null } : cachedEval(m.after);
    const cpBefore = clampCp(beforeEval.cp * sign);
    const cpAfter = clampCp(afterEval.cp * sign);
    const delta = cpAfter - cpBefore;

    // The mover had a forced mate available iff, before moving, the engine saw
    // a mate in the mover's favour.
    const hadMateBefore = beforeEval.mate === sign;
    // chess.js marks checkmate with a trailing "#" in SAN.
    const isMate = m.san.endsWith("#");

    moves.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      side,
      san: m.san,
      from: m.from,
      to: m.to,
      cpBefore,
      cpAfter,
      delta,
      hadMateBefore,
      isMate,
      tag: classifyMove({ delta, hadMateBefore, isMate }),
    });
  });

  return {
    moves,
    white: summarise("w", whiteName, moves),
    black: summarise("b", blackName, moves),
    result: resultFromPgn(pgn),
  };
}

/** Roll up one side's moves into a PlayerReview. */
function summarise(side: Side, name: string, all: AnnotatedMove[]): PlayerReview {
  const mine = all.filter((m) => m.side === side);
  const counts = emptyCounts();
  let worstMoveIndex = -1;
  let worstDelta = Infinity;
  let cpLossSum = 0;
  mine.forEach((m, i) => {
    counts[m.tag]++;
    // Centipawn loss is the magnitude of a negative delta (0 for non-losing).
    cpLossSum += Math.max(0, -m.delta);
    if (m.delta < worstDelta) {
      worstDelta = m.delta;
      worstMoveIndex = i;
    }
  });
  return {
    side,
    name,
    moves: mine,
    counts,
    worstMoveIndex,
    averageCpLoss: mine.length > 0 ? Math.round(cpLossSum / mine.length) : 0,
  };
}
