import { describe, expect, it } from "vitest";
import { needsPromotion } from "@/lib/chess/promotion";

describe("needsPromotion", () => {
  it("true when a white pawn steps to the last rank", () => {
    // White pawn on e7, e8 empty (black king tucked on a8); e7-e8 promotes.
    expect(needsPromotion("k7/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7", "e8")).toBe(true);
  });

  it("true when a white pawn captures onto the last rank", () => {
    // Pawn e7 can take a rook on d8 (promoting).
    expect(needsPromotion("3rk3/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7", "d8")).toBe(true);
  });

  it("true for a black pawn reaching rank 1", () => {
    // Black pawn e2, e1 empty (white king on a1); e2-e1 promotes.
    expect(needsPromotion("4k3/8/8/8/8/8/4p3/K7 b - - 0 1", "e2", "e1")).toBe(true);
  });

  it("false for an ordinary pawn push", () => {
    expect(needsPromotion("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "e2", "e4")).toBe(false);
  });

  it("false for a non-pawn move", () => {
    expect(needsPromotion("4k3/8/8/8/8/8/8/4K2R w K - 0 1", "h1", "h8")).toBe(false);
  });

  it("false for a pawn move that isn't actually legal (empty diagonal, no capture)", () => {
    // e7-d8 is only legal as a capture; d8 is empty here, so there is no such move.
    expect(needsPromotion("4k3/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7", "d8")).toBe(false);
  });

  it("false on a bad FEN", () => {
    expect(needsPromotion("not-a-fen", "e7", "e8")).toBe(false);
  });
});
