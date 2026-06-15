// The strong engine behind the "umulig" bot: iterative deepening with a
// quiescence search at the leaves (so it doesn't stop mid-capture and walk into
// a recapture — the "horizon effect"). PURE and node-budgeted, so it always
// terminates; runs off-thread in a Web Worker for solo play and stays bounded
// even on a synchronous fallback. Shares the eval + piece values with bot.ts.

import { Chess } from "chess.js";
import type { MoveIntent } from "@/lib/chess/validateMove";
import { evaluate, VALUE, type PieceType } from "@/lib/chess/bot";

const MATE = 1_000_000;

interface VMove {
  from: string;
  to: string;
  promotion?: string;
  captured?: string;
  piece: string;
}

/** Captures first, by MVV-LVA, so alpha-beta prunes hard. */
function order(moves: VMove[]): VMove[] {
  return moves
    .map((m) => {
      let s = 0;
      if (m.captured) s += VALUE[m.captured as PieceType] * 10 - VALUE[m.piece as PieceType];
      if (m.promotion) s += 800;
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

type Budget = { n: number };

/** Quiescence: from a quiet stand-pat, keep searching only captures/promotions
 * until the position is calm, so tactical sequences resolve. */
function quiesce(chess: Chess, alpha: number, beta: number, budget: Budget): number {
  const stand = evaluate(chess);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (budget.n <= 0) return alpha;

  const noisy = (chess.moves({ verbose: true }) as unknown as VMove[]).filter(
    (m) => m.captured || m.promotion,
  );
  for (const m of order(noisy)) {
    if (budget.n <= 0) break;
    budget.n--;
    chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
    const score = -quiesce(chess, -beta, -alpha, budget);
    chess.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  budget: Budget,
): number {
  if (chess.isGameOver()) {
    if (chess.isCheckmate()) return -MATE - depth; // prefer quicker mates
    return 0;
  }
  if (depth === 0 || budget.n <= 0) return quiesce(chess, alpha, beta, budget);

  for (const m of order(chess.moves({ verbose: true }) as unknown as VMove[])) {
    if (budget.n <= 0) break;
    budget.n--;
    chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
    const score = -negamax(chess, depth - 1, -beta, -alpha, budget);
    chess.undo();
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return alpha;
}

/**
 * Best move for `fen` via iterative deepening to `maxDepth`, bounded by
 * `nodeBudget` so it always terminates. Returns null if there is no legal move
 * (or the FEN is unparseable). Deterministic.
 */
export function searchBestMove(
  fen: string,
  opts: { maxDepth?: number; nodeBudget?: number } = {},
): MoveIntent | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const rootMoves = order(chess.moves({ verbose: true }) as unknown as VMove[]);
  if (rootMoves.length === 0) return null;

  const maxDepth = Math.max(1, opts.maxDepth ?? 5);
  const budget: Budget = { n: opts.nodeBudget ?? 150_000 };

  let best = rootMoves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    let localBest = best;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    for (const m of rootMoves) {
      if (budget.n <= 0) break;
      budget.n--;
      chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
      const score = -negamax(chess, depth - 1, -Infinity, -alpha, budget);
      chess.undo();
      if (score > bestScore) {
        bestScore = score;
        localBest = m;
        if (score > alpha) alpha = score;
      }
    }
    // Keep the best move from the deepest iteration we actually completed work on.
    best = localBest;
    if (budget.n <= 0) break;
  }

  return { from: best.from, to: best.to, promotion: (best.promotion as MoveIntent["promotion"]) ?? "q" };
}
