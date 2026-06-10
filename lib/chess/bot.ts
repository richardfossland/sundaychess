// Client-side chess bot for single-player mode. Negamax + alpha-beta over
// chess.js move generation, with a material + piece-square-table evaluation.
// Pure (RNG injectable) so it can be unit-tested. Three difficulty levels.

import { Chess } from "chess.js";
import type { MoveIntent } from "@/lib/chess/validateMove";

export type BotLevel = "easy" | "medium" | "hard";

type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

const VALUE: Record<PieceType, number> = {
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

/** Static evaluation from the side-to-move's perspective. */
function evaluate(chess: Chess): number {
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

const DEPTH: Record<BotLevel, number> = { easy: 1, medium: 2, hard: 3 };

/** Choose the bot's move for `fen` at the given level. Returns null if there is
 * no legal move (game already over). */
export function bestMove(
  fen: string,
  level: BotLevel,
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

  // Easy: often just play a reasonable-but-random move so it's beatable.
  if (level === "easy" && rng() < 0.4) {
    const m = moves[Math.floor(rng() * moves.length)];
    return { from: m.from, to: m.to, promotion: (m.promotion as MoveIntent["promotion"]) ?? "q" };
  }

  const depth = DEPTH[level];
  // Random noise breaks ties and adds variety; larger on easier levels.
  const noise = level === "easy" ? 90 : level === "medium" ? 30 : 10;

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
  return {
    from: best.from,
    to: best.to,
    promotion: (best.promotion as MoveIntent["promotion"]) ?? "q",
  };
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
