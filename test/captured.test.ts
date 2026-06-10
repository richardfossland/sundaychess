import { describe, expect, it } from "vitest";
import { capturedFromFen } from "@/lib/chess/captured";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("capturedFromFen", () => {
  it("nothing captured at the start", () => {
    const c = capturedFromFen(START);
    expect(c.byWhite).toEqual([]);
    expect(c.byBlack).toEqual([]);
    expect(c.materialDiff).toBe(0);
  });

  it("counts a captured queen + pawn and material diff", () => {
    // White is missing its queen; Black is missing two pawns.
    // White captured: 2 black pawns. Black captured: 1 white queen.
    const fen = "rnb1kbnr/pp2pppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1";
    const c = capturedFromFen(fen);
    // black is missing q and two pawns → byWhite = q + p + p (order q first)
    expect(c.byWhite).toContain("q");
    expect(c.byWhite.filter((p) => p === "p")).toHaveLength(2);
    // white is missing its queen → byBlack = q
    expect(c.byBlack).toEqual(["q"]);
    // material: white has all but Q; black has all but Q + 2 pawns → white +2 pawns
    expect(c.materialDiff).toBe(2);
  });
});
