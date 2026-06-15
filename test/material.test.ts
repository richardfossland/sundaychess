import { describe, expect, it } from "vitest";
import { winnerCanMate } from "@/lib/chess/material";

// Only the board field matters; the rest of the FEN is filler.
const fen = (board: string) => `${board} w - - 0 1`;

describe("winnerCanMate (win-on-time → draw on insufficient material)", () => {
  it("lone king cannot mate", () => {
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/8"), "white")).toBe(false);
  });
  it("king + single minor cannot mate (KB, KN)", () => {
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/5B2"), "white")).toBe(false);
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/5N2"), "white")).toBe(false);
  });
  it("king + two knights cannot force mate (KNN)", () => {
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/4NN2"), "white")).toBe(false);
  });
  it("a pawn, rook or queen can mate", () => {
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/4P3/8"), "white")).toBe(true);
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/4R3"), "white")).toBe(true);
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/4Q3"), "white")).toBe(true);
  });
  it("bishop + knight (two different minors) can mate", () => {
    expect(winnerCanMate(fen("8/8/8/4k3/8/4K3/8/4BN2"), "white")).toBe(true);
  });
  it("reads the correct side's material", () => {
    // White has only K+B (can't mate); black has a queen (could). Winner=white → false.
    const board = "4q3/8/8/4k3/8/4K3/8/5B2";
    expect(winnerCanMate(fen(board), "white")).toBe(false);
    expect(winnerCanMate(fen(board), "black")).toBe(true);
  });
});
