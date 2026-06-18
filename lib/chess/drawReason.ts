import { Chess } from "chess.js";

export type DrawReason =
  | "agreement"
  | "threefold"
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

/** Draw reason using the full move history (PGN), so threefold repetition — which
 * a FEN alone cannot see — is named correctly. Falls back to the FEN-only checks
 * (and to "agreement") when the PGN is missing/unparseable. */
export function drawReasonFromPgn(pgn: string, fen: string): DrawReason {
  if (pgn && pgn.trim()) {
    try {
      const c = new Chess();
      c.loadPgn(pgn);
      if (c.isThreefoldRepetition()) return "threefold";
      if (c.isStalemate()) return "stalemate";
      if (c.isInsufficientMaterial()) return "insufficient";
      if (c.isDrawByFiftyMoves?.()) return "fifty_move";
    } catch {
      // fall through to the FEN-only reason
    }
  }
  return drawReasonFromFen(fen);
}
