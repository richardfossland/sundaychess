import { describe, expect, it } from "vitest";
import { drawReasonFromFen } from "@/lib/chess/drawReason";

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
