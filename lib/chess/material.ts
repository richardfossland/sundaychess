/** Can `winner` still checkmate, for the win-on-time rule? When a player's clock
 * falls (FIDE 6.9 / common online practice, e.g. lichess), the opponent wins
 * UNLESS they have insufficient material to checkmate — then it's a draw, not a
 * win. Returns false for a lone king, king + a single minor (B or N), or king +
 * two knights (KNN) — none of which can force mate. Pawns/rooks/queens, or two
 * different minors, can. Pure FEN parsing (no chess.js needed). */
export function winnerCanMate(fen: string, winner: "white" | "black"): boolean {
  const board = fen.split(" ")[0] ?? "";
  // The winner's own (non-king) pieces: uppercase for white, lowercase for black.
  const re = winner === "white" ? /[PNBRQ]/g : /[pnbrq]/g;
  const up = (board.match(re) ?? []).map((c) => c.toUpperCase());
  if (up.some((c) => c === "P" || c === "R" || c === "Q")) return true;
  const knights = up.filter((c) => c === "N").length;
  const bishops = up.filter((c) => c === "B").length;
  const minors = knights + bishops;
  // ≥2 minors can mate, except two knights (KNN cannot force mate).
  if (minors >= 2 && !(knights === 2 && bishops === 0)) return true;
  return false; // K, K+N, K+B, K+N+N → cannot force mate
}
