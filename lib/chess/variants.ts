// Theme variants: different starting positions with completely standard rules,
// so chess.js (client + server validation) works untouched. True Chess960 is
// out of scope — chess.js v1 can't castle from arbitrary squares.

export type Variant = "standard" | "no_queens" | "pawn_war";

export const VARIANTS: Variant[] = ["standard", "no_queens", "pawn_war"];

const FENS: Record<Variant, string> = {
  standard: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  // queens removed — calmer, longer games; great for teaching piece play
  no_queens: "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1",
  // kings + pawns only — promotion race; quick, chaotic, very fun
  pawn_war: "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1",
};

export function isVariant(v: unknown): v is Variant {
  return typeof v === "string" && (VARIANTS as string[]).includes(v);
}

/** Start FEN for a (possibly missing/unknown) variant value. */
export function variantStartFen(v: unknown): string {
  return FENS[isVariant(v) ? v : "standard"];
}
