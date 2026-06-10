// Captured-pieces + material from a FEN — pure, no chess.js needed (we only
// read the piece-placement field). Used by the player + spectator views.

export type PieceType = "p" | "n" | "b" | "r" | "q";
const ORDER: PieceType[] = ["q", "r", "b", "n", "p"];
const START: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export interface Captured {
  /** Black pieces White has captured (rendered on White's side). */
  byWhite: PieceType[];
  /** White pieces Black has captured. */
  byBlack: PieceType[];
  /** Material difference (White − Black) in pawns; + favours White. */
  materialDiff: number;
}

export function capturedFromFen(fen: string): Captured {
  const board = fen.split(" ")[0] ?? "";
  const white: Record<PieceType, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const black: Record<PieceType, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower === "p" || lower === "n" || lower === "b" || lower === "r" || lower === "q") {
      if (ch === ch.toUpperCase()) white[lower as PieceType]++;
      else black[lower as PieceType]++;
    }
  }

  const byWhite: PieceType[] = [];
  const byBlack: PieceType[] = [];
  let diff = 0;
  for (const t of ORDER) {
    const blackTaken = Math.max(0, START[t] - black[t]); // black pieces gone → White captured
    const whiteTaken = Math.max(0, START[t] - white[t]);
    for (let i = 0; i < blackTaken; i++) byWhite.push(t);
    for (let i = 0; i < whiteTaken; i++) byBlack.push(t);
    diff += (white[t] - black[t]) * VALUE[t];
  }
  return { byWhite, byBlack, materialDiff: diff };
}

// Unicode glyphs (use the solid black glyphs; colour is applied via CSS).
const GLYPH: Record<PieceType, string> = {
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};
export function glyph(t: PieceType): string {
  return GLYPH[t];
}
