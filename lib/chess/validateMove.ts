// Pure chess-rules helpers built on chess.js. Used on the SERVER as the
// authority and on the CLIENT only for optimistic hints. No I/O here.
//
// NOTE: chess.js 1.x throws on an illegal move (it does NOT return null like
// 0.x). We wrap every .move() in try/catch and surface a typed result.

import { Chess } from "chess.js";
import type { GameStatus, Turn } from "@/lib/types";

export interface MoveIntent {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

export interface AppliedMove {
  ok: true;
  fen: string;
  pgn: string;
  san: string;
  turn: Turn;
  /** Outcome status if the game ended on this move, else "live". */
  status: GameStatus;
  endReason: EndReason | null;
}

export interface RejectedMove {
  ok: false;
  reason: "illegal" | "bad_fen" | "game_over";
}

export type MoveResult = AppliedMove | RejectedMove;

export type EndReason =
  | "checkmate"
  | "stalemate"
  | "threefold"
  | "insufficient"
  | "fifty_move"
  | "draw";

/** The colour to move in a FEN, without constructing a full game when we only
 * need the turn (FEN field 2). */
export function turnFromFen(fen: string): Turn {
  const field = fen.split(" ")[1];
  return field === "b" ? "b" : "w";
}

/** Classify a terminal position. Call only when isGameOver() is true. */
function classifyEnd(chess: Chess): { status: GameStatus; reason: EndReason } {
  if (chess.isCheckmate()) {
    // The side to move is checkmated → the OTHER side won.
    const winner = chess.turn() === "w" ? "black_win" : "white_win";
    return { status: winner, reason: "checkmate" };
  }
  if (chess.isStalemate()) return { status: "draw", reason: "stalemate" };
  if (chess.isThreefoldRepetition())
    return { status: "draw", reason: "threefold" };
  if (chess.isInsufficientMaterial())
    return { status: "draw", reason: "insufficient" };
  if (chess.isDrawByFiftyMoves?.())
    return { status: "draw", reason: "fifty_move" };
  return { status: "draw", reason: "draw" };
}

/** Apply a move intent to a position (optionally continuing a PGN line).
 * Returns the authoritative next state, or a typed rejection. */
export function applyMove(
  fen: string,
  intent: MoveIntent,
  priorPgn?: string,
): MoveResult {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { ok: false, reason: "bad_fen" };
  }

  // Re-hydrate prior history so threefold/fifty-move detection is accurate and
  // the resulting PGN carries the full game.
  if (priorPgn && priorPgn.trim().length > 0) {
    try {
      const replay = new Chess();
      replay.loadPgn(priorPgn);
      // Only trust the replay if it lands on the same position we were given.
      if (replay.fen() === fen) chess = replay;
    } catch {
      // Fall back to FEN-only (history-less) game; still legal-correct for the
      // immediate move, just can't see repetition across the whole game.
    }
  }

  if (chess.isGameOver()) return { ok: false, reason: "game_over" };

  let move;
  try {
    move = chess.move({
      from: intent.from,
      to: intent.to,
      promotion: intent.promotion ?? "q",
    });
  } catch {
    return { ok: false, reason: "illegal" };
  }
  if (!move) return { ok: false, reason: "illegal" };

  let status: GameStatus = "live";
  let endReason: EndReason | null = null;
  if (chess.isGameOver()) {
    const end = classifyEnd(chess);
    status = end.status;
    endReason = end.reason;
  }

  return {
    ok: true,
    fen: chess.fen(),
    pgn: chess.pgn(),
    san: move.san,
    turn: chess.turn() as Turn,
    status,
    endReason,
  };
}

/** Legal destination squares from a source square — for client-side hint dots. */
export function legalDestinations(fen: string, from: string): string[] {
  try {
    const chess = new Chess(fen);
    return chess
      .moves({ square: from as never, verbose: true })
      .map((m) => (m as { to: string }).to);
  } catch {
    return [];
  }
}
