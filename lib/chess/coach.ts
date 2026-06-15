// Coaching helpers for solo "Coach" mode. PURE + node-testable.
//
// moveAdvice classifies a candidate move by how much worse it is than the best
// move available, using a shallow negamax over the shared evaluation. The
// beginner coach uses it to warn BEFORE a blunder; the "get better" coach uses
// it to tag each move played (Bra / Unøyaktig / Tabbe) and offer a do-over.

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

const INACCURACY_CP = 110;
const BLUNDER_CP = 280;

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
    return { kind: "ok", lossCp: 0 };
  }
  const legal = chess.moves({ verbose: true }) as unknown as VMove[];
  if (legal.length <= 1) return { kind: "ok", lossCp: 0 };

  const valueOf = (m: VMove): number => {
    chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
    const v = -negamax(chess, depth - 1, -Infinity, Infinity);
    chess.undo();
    return v;
  };

  const chosen = legal.find((m) => m.from === move.from && m.to === move.to);
  if (!chosen) return { kind: "ok", lossCp: 0 };

  let bestVal = -Infinity;
  for (const m of legal) {
    const v = valueOf(m);
    if (v > bestVal) bestVal = v;
  }
  const loss = Math.max(0, bestVal - valueOf(chosen));
  const kind: AdviceKind =
    loss >= BLUNDER_CP ? "blunder" : loss >= INACCURACY_CP ? "inaccuracy" : "ok";
  return { kind, lossCp: Math.round(loss) };
}
