// Client-side chess bot for single-player mode. Negamax + alpha-beta over
// chess.js move generation, with a material + piece-square-table evaluation.
// Pure (RNG injectable) so it can be unit-tested.
//
// Strength is driven by a continuous `skill` value via `bestMoveBySkill`
// (see lib/chess/skill.ts). The legacy fixed easy/medium/hard `bestMove` is
// kept as a thin wrapper for callers/tests that still pass a BotLevel.

import { Chess } from "chess.js";
import type { MoveIntent } from "@/lib/chess/validateMove";
import { skillToParams, type BotParams } from "@/lib/chess/skill";

export type BotLevel = "easy" | "medium" | "hard" | "impossible";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export const VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables — white's perspective, row 0 = rank 8 (a8..h8).
// Source: the classic "Simplified Evaluation Function" (public domain).
// prettier-ignore
const PST: Record<PieceType, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

const MATE = 1_000_000;

/** Static evaluation from the side-to-move's perspective. Exported so the
 * stronger iterative-deepening search (lib/chess/search.ts) shares one eval. */
export function evaluate(chess: Chess): number {
  const board = chess.board();
  let white = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const t = cell.type as PieceType;
      const base = VALUE[t];
      if (cell.color === "w") white += base + PST[t][r * 8 + c];
      else white -= base + PST[t][(7 - r) * 8 + c];
    }
  }
  return chess.turn() === "w" ? white : -white;
}

interface VMove {
  from: string;
  to: string;
  promotion?: string;
  captured?: string;
  piece: string;
}

/** Order moves captures-first (MVV-LVA-ish) so alpha-beta prunes more. */
function ordered(moves: VMove[]): VMove[] {
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

function negamax(chess: Chess, depth: number, alpha: number, beta: number): number {
  if (chess.isGameOver()) {
    if (chess.isCheckmate()) return -MATE - depth; // prefer quicker mates
    return 0; // stalemate / draw
  }
  if (depth === 0) return evaluate(chess);

  let best = -Infinity;
  for (const m of ordered(chess.moves({ verbose: true }) as unknown as VMove[])) {
    chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function toIntent(m: VMove): MoveIntent {
  return { from: m.from, to: m.to, promotion: (m.promotion as MoveIntent["promotion"]) ?? "q" };
}

/**
 * Core move chooser shared by every difficulty entry point. Given concrete
 * search knobs, picks a move for `fen`. Returns null if the game is over.
 *
 * - `randomMoveProb`: chance of an outright blunder (uniform random legal move).
 * - `depth`: negamax search depth in plies (clamped to ≥ 1).
 * - `noise`: centipawns of uniform random slop added per candidate, so the bot
 *   sometimes prefers a slightly worse move (weaker, more human play).
 *
 * Pure given `rng` (defaults to Math.random) so it is unit-testable.
 */
export function chooseMove(
  fen: string,
  params: BotParams,
  rng: () => number = Math.random,
): MoveIntent | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const moves = ordered(chess.moves({ verbose: true }) as unknown as VMove[]);
  if (moves.length === 0) return null;

  // Outright blunder: ignore the search and play a random legal move.
  if (params.randomMoveProb > 0 && rng() < params.randomMoveProb) {
    return toIntent(moves[Math.floor(rng() * moves.length) % moves.length]);
  }

  const depth = Math.max(1, Math.floor(params.depth));
  const noise = Math.max(0, params.noise);

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    chess.move({ from: m.from, to: m.to, promotion: (m.promotion ?? "q") as "q" });
    const score = -negamax(chess, depth - 1, -Infinity, Infinity) + rng() * noise;
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return toIntent(best);
}

/**
 * Adaptive bot: choose a move for `fen` at the given continuous `skill`
 * (≈ an Elo rating). The skill→knobs mapping lives in lib/chess/skill.ts and
 * is the single thing that varies strength. Returns null if no legal move.
 */
export function bestMoveBySkill(
  fen: string,
  skill: number,
  rng: () => number = Math.random,
): MoveIntent | null {
  return chooseMove(fen, skillToParams(skill), rng);
}

// Fixed levels expressed as skill points. "medium" was eased (950 → 700) so the
// ladder is gentler; "impossible" is NOT a skill point — it uses the dedicated
// strong search (iterative deepening + quiescence + opening book) below.
const LEVEL_SKILL: Record<Exclude<BotLevel, "impossible">, number> = {
  easy: 450,
  medium: 700,
  hard: 1700,
};

/**
 * The strongest bot: an opening book for principled early play, then an
 * iterative-deepening + quiescence search. It is deliberately NOT noisy — it
 * just tries to play the best move it can within a node budget. Off-thread in a
 * Web Worker for solo play, so its longer think never freezes the tab; the
 * `nodeBudget` keeps even a synchronous fallback bounded. Returns null if no
 * legal move.
 *
 * Imported lazily (inside the function) to avoid a static import cycle with
 * lib/chess/search.ts, which imports the shared `evaluate`/`VALUE` from here.
 */
export async function bestMoveStrong(
  fen: string,
  rng: () => number = Math.random,
  nodeBudget?: number,
): Promise<MoveIntent | null> {
  const { bookMove } = await import("@/lib/chess/openings");
  const book = bookMove(fen, rng);
  if (book) return book;
  const { searchBestMove } = await import("@/lib/chess/search");
  return searchBestMove(fen, { maxDepth: 5, nodeBudget });
}

/**
 * Legacy entry point: choose the bot's move for `fen` at a fixed level.
 * Thin wrapper over the adaptive path. Returns null if no legal move.
 * NOTE: "impossible" is async (uses bestMoveStrong); use bestMoveStrong directly
 * for that level. This sync wrapper falls back to the strongest skill point for
 * "impossible" so existing synchronous callers/tests still get a strong move.
 */
export function bestMove(
  fen: string,
  level: BotLevel,
  rng: () => number = Math.random,
): MoveIntent | null {
  if (level === "impossible") return bestMoveBySkill(fen, 2000, rng);
  return bestMoveBySkill(fen, LEVEL_SKILL[level], rng);
}

/** Position evaluation for the spectator eval bar. Returns centipawns from
 * White's perspective (+ = White better) and a mate flag. Uses a shallow
 * negamax for stability. */
export function evaluateFen(
  fen: string,
  depth = 2,
): { cp: number; mate: 1 | -1 | null } {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { cp: 0, mate: null };
  }
  if (chess.isGameOver()) {
    if (chess.isCheckmate()) {
      const whiteWon = chess.turn() === "b"; // black to move & mated → White won
      return { cp: whiteWon ? 100000 : -100000, mate: whiteWon ? 1 : -1 };
    }
    return { cp: 0, mate: null }; // draw
  }
  const stm = negamax(chess, depth, -Infinity, Infinity);
  const white = chess.turn() === "w" ? stm : -stm;
  if (Math.abs(white) > MATE - 10000) return { cp: white, mate: white > 0 ? 1 : -1 };
  return { cp: white, mate: null };
}
