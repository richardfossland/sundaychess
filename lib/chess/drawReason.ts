import { Chess } from "chess.js";

export type DrawReason =
  | "agreement"
  | "insufficient"
  | "stalemate"
  | "fifty_move"
  | "draw";

/** Best-effort draw reason derivable from a FEN alone. Stalemate, insufficient
 * material and the 50-move clock are encoded in the FEN; threefold needs move
 * history, so a non-rule draw is reported as "agreement" (the player path). */
export function drawReasonFromFen(fen: string): DrawReason {
  try {
    const c = new Chess(fen);
    if (c.isStalemate()) return "stalemate";
    if (c.isInsufficientMaterial()) return "insufficient";
    if (c.isDrawByFiftyMoves?.()) return "fifty_move";
    return "agreement";
  } catch {
    return "draw";
  }
}
