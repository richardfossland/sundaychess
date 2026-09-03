// Coaching helpers for solo "Coach" mode. PURE + node-testable.
//
// moveAdvice classifies a candidate move by how much worse it is than the best
// move available, using a shallow negamax over the shared evaluation. The
// beginner coach uses it to warn BEFORE a blunder; the "get better" coach uses
// it to tag each move played (Bra / Unøyaktig / Tabbe) and offer a do-over.
//
// adviceMap does the same work for EVERY legal move in one pass. The solo page
// runs it in the engine Web Worker the moment it becomes the student's turn, so
// the classification is a plain object lookup by the time the piece is dropped
// — the search never runs on the main thread on the move path.

import { Chess } from "chess.js";
import { evaluate } from "@/lib/chess/bot";
import type { MoveIntent } from "@/lib/chess/validateMove";

interface VMove {
  from: string;
  to: string;
  promotion?: string;
}

const MATE = 1_000_000;

function negamax(chess: Chess, depth: number, alpha: number, beta: number): number {
  if (chess.isGameOver()) {
    if (chess.isCheckmate()) return -MATE - depth;
    return 0;
  }
  if (depth === 0) return evaluate(chess);
  let best = -Infinity;
  for (const m of chess.moves({ verbose: true }) as unknown as VMove[]) {
    chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
    const s = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export type AdviceKind = "ok" | "inaccuracy" | "blunder";
export interface Advice {
  kind: AdviceKind;
  /** How many centipawns worse than the best move (0 = best, or forced). */
  lossCp: number;
}

/** Advice for every legal move of one position, keyed `from + to` (e.g. "e2e4").
 * Promotions collapse onto one key — moveAdvice ignores the promotion piece too. */
export type AdviceMap = Record<string, Advice>;

const INACCURACY_CP = 110;
const BLUNDER_CP = 280;

/** Value of the position after `m`, from the mover's point of view. */
function valueOf(chess: Chess, m: VMove, depth: number): number {
  chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
  const v = -negamax(chess, depth - 1, -Infinity, Infinity);
  chess.undo();
  return v;
}

/** Turn a centipawn loss into an Advice. Shared so the map and the single-move
 * path can never drift apart. */
function classify(loss: number): Advice {
  const l = Math.max(0, loss);
  const kind: AdviceKind =
    l >= BLUNDER_CP ? "blunder" : l >= INACCURACY_CP ? "inaccuracy" : "ok";
  return { kind, lossCp: Math.round(l) };
}

/** A move that is never judged (forced, illegal, or an unreadable FEN).
 * A factory, not a shared constant: these land in AdviceMap values. */
const forced = (): Advice => ({ kind: "ok", lossCp: 0 });

/**
 * Classify `move` from `fenBefore` by how much worse it is than the best legal
 * move, at a shallow search (`depth` plies, default 2). A forced move (≤1 legal)
 * is never judged. Deterministic.
 */
export function moveAdvice(
  fenBefore: string,
  move: MoveIntent,
  depth = 2,
): Advice {
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return forced();
  }
  const legal = chess.moves({ verbose: true }) as unknown as VMove[];
  if (legal.length <= 1) return forced();

  const chosen = legal.find((m) => m.from === move.from && m.to === move.to);
  if (!chosen) return forced();

  // Search every legal move once; remember the chosen move's value as we pass it
  // (it's one of `legal`, same object) instead of re-searching it afterwards.
  let bestVal = -Infinity;
  let chosenVal = 0;
  for (const m of legal) {
    const v = valueOf(chess, m, depth);
    if (v > bestVal) bestVal = v;
    if (m === chosen) chosenVal = v;
  }
  return classify(bestVal - chosenVal);
}

/**
 * Classify EVERY legal move of `fenBefore` in a single pass — the same search
 * `moveAdvice` does, but paying for it once instead of once per candidate.
 * Agrees with `moveAdvice(fenBefore, move, depth)` for every legal move.
 *
 * Returns {} for an invalid FEN or a finished game (the caller then falls back
 * to moveAdvice, which returns "ok" for those).
 */
export function adviceMap(fenBefore: string, depth = 2): AdviceMap {
  const out: AdviceMap = {};
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return out;
  }
  const legal = chess.moves({ verbose: true }) as unknown as VMove[];
  if (legal.length === 0) return out;
  if (legal.length === 1) {
    out[legal[0].from + legal[0].to] = forced(); // forced move is never judged
    return out;
  }

  const values = legal.map((m) => valueOf(chess, m, depth));
  let bestVal = -Infinity;
  for (const v of values) if (v > bestVal) bestVal = v;

  legal.forEach((m, i) => {
    const key = m.from + m.to;
    // First occurrence wins, mirroring moveAdvice's `legal.find` — the four
    // promotion moves of one pawn push share a key and must resolve the same way.
    if (key in out) return;
    out[key] = classify(bestVal - values[i]);
  });
  return out;
}
