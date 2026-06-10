import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { VARIANTS, variantStartFen } from "@/lib/chess/variants";
import { capturedFromFen } from "@/lib/chess/captured";

describe("variant start positions", () => {
  for (const v of VARIANTS) {
    it(`${v} is a legal, playable position`, () => {
      const fen = variantStartFen(v);
      const chess = new Chess(fen); // throws if illegal
      expect(chess.isGameOver()).toBe(false);
      expect(chess.turn()).toBe("w");
      expect(chess.moves().length).toBeGreaterThan(0);
    });
  }

  it("falls back to standard for unknown values", () => {
    expect(variantStartFen(undefined)).toBe(variantStartFen("standard"));
    expect(variantStartFen("hacky")).toBe(variantStartFen("standard"));
  });
});

// variant baseline must stop never-existing pieces being shown as captured
describe("capturedFromFen with variant baseline", () => {
  it("shows nothing captured at a variant start", () => {
    const fen = variantStartFen("pawn_war");
    const cap = capturedFromFen(fen, fen);
    expect(cap.byWhite).toEqual([]);
    expect(cap.byBlack).toEqual([]);
    expect(cap.materialDiff).toBe(0);
  });

  it("counts a real capture in a variant game", () => {
    const start = variantStartFen("pawn_war");
    const chess = new Chess(start);
    chess.move("e4");
    chess.move("d5");
    chess.move("exd5"); // white takes a black pawn
    const cap = capturedFromFen(chess.fen(), start);
    expect(cap.byWhite).toEqual(["p"]);
    expect(cap.byBlack).toEqual([]);
    expect(cap.materialDiff).toBe(1);
  });

  it("standard baseline unchanged when omitted", () => {
    const cap = capturedFromFen(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    expect(cap.byWhite).toEqual([]);
    expect(cap.byBlack).toEqual([]);
  });
});
