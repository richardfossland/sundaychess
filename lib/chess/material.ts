/** Can `winner` still checkmate, for the win-on-time rule? When a player's clock
 * falls (FIDE 6.9 / common online practice, e.g. lichess), the opponent wins
 * UNLESS they have insufficient material to checkmate — then it's a draw, not a
 * win. Returns false for a lone king, king + a single minor (B or N), king + two
 * knights (KNN), or king + any number of SAME-COLOURED bishops (they only ever
 * control one square colour, so the lone king can never be cornered). Returns
 * true for pawns/rooks/queens, bishop + knight, or two bishops on opposite
 * colours. Pure FEN parsing (no chess.js needed). */
export function winnerCanMate(fen: string, winner: "white" | "black"): boolean {
  const board = fen.split(" ")[0] ?? "";
  const isWinners =
    winner === "white"
      ? (c: string) => c >= "A" && c <= "Z"
      : (c: string) => c >= "a" && c <= "z";

  let pawnRookQueen = 0;
  let knights = 0;
  let bishops = 0;
  const bishopColors = new Set<number>();
  // Walk the board left→right, rank 8→1. (rank + file) parity = square colour.
  let rank = 0;
  let file = 0;
  for (const ch of board) {
    if (ch === "/") {
      rank++;
      file = 0;
      continue;
    }
    if (ch >= "1" && ch <= "8") {
      file += ch.charCodeAt(0) - 48; // skip empty squares
      continue;
    }
    if (isWinners(ch)) {
      const u = ch.toUpperCase();
      if (u === "P" || u === "R" || u === "Q") pawnRookQueen++;
      else if (u === "N") knights++;
      else if (u === "B") {
        bishops++;
        bishopColors.add((rank + file) % 2);
      }
    }
    file++;
  }

  if (pawnRookQueen > 0) return true;
  // The "cannot mate" sets (everything else — incl. 3+ knights, bishop+knight,
  // opposite-coloured bishop pair — can):
  //  • no bishops and ≤2 knights → K, KN, KNN
  //  • no knights and bishops all on one colour → K, KB, K + same-colour bishops
  if (bishops === 0 && knights <= 2) return false;
  if (knights === 0 && bishopColors.size <= 1) return false;
  return true;
}
