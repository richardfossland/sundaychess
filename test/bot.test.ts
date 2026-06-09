import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { bestMove } from "@/lib/chess/bot";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const constRng = (v: number) => () => v;

describe("bestMove", () => {
  it("returns a legal move from the start position", () => {
    const m = bestMove(START, "hard", constRng(0.5));
    expect(m).not.toBeNull();
    const chess = new Chess(START);
    // Applying it must not throw → it is legal.
    expect(() => chess.move({ from: m!.from, to: m!.to, promotion: "q" })).not.toThrow();
  });

  it("plays a forced mate-in-1 (back-rank)", () => {
    // White: Ra1 + Kh1; Black: Kg8 boxed in by its own pawns. Ra8#.
    const fen = "6k1/5ppp/8/8/8/8/8/R6K w - - 0 1";
    const m = bestMove(fen, "hard", constRng(0.5));
    expect(m).toMatchObject({ from: "a1", to: "a8" });
  });

  it("grabs a hanging queen", () => {
    // White pawn e4 can capture an undefended black queen on d5.
    const fen = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";
    const m = bestMove(fen, "medium", constRng(0.5));
    expect(m?.to).toBe("d5");
  });

  it("returns null when there are no legal moves (checkmate)", () => {
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(bestMove(mated, "hard")).toBeNull();
  });

  it("easy level still returns legal moves", () => {
    for (let i = 0; i < 10; i++) {
      const m = bestMove(START, "easy", constRng(i / 10));
      expect(m).not.toBeNull();
    }
  });
});
