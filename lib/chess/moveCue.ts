import { Chess } from "chess.js";

/** Piece count from a FEN board field — a drop between positions = capture. */
export function pieceCount(fen: string): number {
  return (fen.split(" ")[0].match(/[a-zA-Z]/g) ?? []).length;
}

/** Pick the sound cue for arriving at `fen` from `prevFen`.
 *
 * L5: when the SAN of the move is available — it always is on our own move
 * (`applyMove` returns it) and on an opponent broadcast that carries
 * `lastMove.san` — read check/mate straight off it instead of parsing the FEN
 * into a whole `Chess` instance a second time. SAN's `+` and `#` are exactly
 * the marks chess.js writes from the same `inCheck()`/`isCheckmate()` it would
 * recompute here, so the cue is byte-for-byte the one the FEN path produces:
 * mate and check both sound "check" (as before), and a checking CAPTURE still
 * sounds "check" because the check test wins in both paths.
 *
 * Without a SAN (a broadcast from an older client, a lastMove we never got) it
 * falls back to the original FEN parse. */
export function moveCue(
  prevFen: string,
  fen: string,
  san?: string | null,
): "move" | "capture" | "check" {
  if (san) {
    if (san.endsWith("#")) return "check"; // mate — same cue as check, as before
    if (san.includes("+")) return "check";
  } else {
    try {
      if (new Chess(fen).inCheck()) return "check";
    } catch {
      // unparseable fen → fall through to the count check
    }
  }
  return prevFen && pieceCount(fen) < pieceCount(prevFen) ? "capture" : "move";
}
