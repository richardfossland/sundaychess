// Promotion detection — pure, no I/O. Used by the board UIs to decide whether a
// drag/tap needs the piece chooser before the move is committed (otherwise we'd
// silently auto-queen, which loses underpromotion tactics).

import { Chess } from "chess.js";

export type PromoPiece = "q" | "r" | "b" | "n";

/** Does moving from→to require choosing a promotion piece? True iff there is a
 * LEGAL move from `from` to `to` that carries a promotion (a pawn reaching the
 * last rank). False for any illegal/blocked move, a non-pawn, or a bad FEN. */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return false;
  }
  try {
    const moves = chess.moves({ square: from as never, verbose: true }) as Array<{
      to: string;
      promotion?: string;
    }>;
    return moves.some((m) => m.to === to && !!m.promotion);
  } catch {
    return false;
  }
}
