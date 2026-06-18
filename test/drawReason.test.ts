import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { drawReasonFromFen, drawReasonFromPgn } from "@/lib/chess/drawReason";

describe("drawReasonFromFen", () => {
  it("detects insufficient material (K vs K)", () => {
    expect(drawReasonFromFen("8/8/4k3/8/8/4K3/8/8 w - - 0 1")).toBe("insufficient");
  });

  it("detects stalemate", () => {
    // Black to move, no legal move, not in check.
    expect(drawReasonFromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toBe("stalemate");
  });

  it("falls back to agreement for an ordinary live position", () => {
    expect(
      drawReasonFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
    ).toBe("agreement");
  });
});

describe("drawReasonFromPgn", () => {
  it("detects threefold repetition (which a FEN alone cannot)", () => {
    // Shuffle both knights out and back twice → start position seen 3×.
    const c = new Chess();
    for (const san of ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]) {
      c.move(san);
    }
    expect(c.isThreefoldRepetition()).toBe(true);
    expect(drawReasonFromPgn(c.pgn(), c.fen())).toBe("threefold");
  });

  it("falls back to the FEN reason when there's no useful history", () => {
    expect(drawReasonFromPgn("", "8/8/4k3/8/8/4K3/8/8 w - - 0 1")).toBe("insufficient");
    expect(drawReasonFromPgn("garbage", "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toBe("stalemate");
  });
});
