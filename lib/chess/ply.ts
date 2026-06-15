/** Approx half-move count from a FEN — lets us merge poll vs realtime updates
 * without ever regressing to an older position. Shared by the host live grid and
 * the player's board so a delayed/out-of-order "position" broadcast can never
 * roll the shown position backwards. */
export function plyOf(fen: string): number {
  const parts = fen.split(" ");
  const full = parseInt(parts[5] ?? "1", 10) || 1;
  return (full - 1) * 2 + (parts[1] === "b" ? 1 : 0);
}
