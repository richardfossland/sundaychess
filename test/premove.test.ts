import { describe, expect, it } from "vitest";
import { resolvePremove, pieceColorAt } from "@/lib/chess/premove";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// After 1.e4 — it's Black to move.
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("resolvePremove", () => {
  it("returns the move when it is legal now", () => {
    expect(resolvePremove(START, { from: "e2", to: "e4" })).toMatchObject({
      from: "e2",
      to: "e4",
      promotion: "q",
    });
  });

  it("returns null when the queued move is illegal in the new position", () => {
    // Black queued ...e5 expecting it to be legal, but here it's White to move
    // and a black move is not legal → discard.
    expect(resolvePremove(START, { from: "e7", to: "e5" })).toBeNull();
  });

  it("resolves a black pre-move once it is Black's turn", () => {
    expect(resolvePremove(AFTER_E4, { from: "e7", to: "e5" })).toMatchObject({
      from: "e7",
      to: "e5",
    });
  });

  it("returns null on an unparseable fen", () => {
    expect(resolvePremove("not a fen", { from: "e2", to: "e4" })).toBeNull();
  });
});

describe("pieceColorAt", () => {
  it("reads the colour of the piece on a square", () => {
    expect(pieceColorAt(START, "e2")).toBe("w");
    expect(pieceColorAt(START, "e7")).toBe("b");
  });
  it("is null on an empty square", () => {
    expect(pieceColorAt(START, "e4")).toBeNull();
  });
});
