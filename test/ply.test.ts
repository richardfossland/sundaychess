import { describe, expect, it } from "vitest";
import { plyOf } from "@/lib/chess/ply";

const START = "rnbqkbnr/pppppppp/rnbqkbnr/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("plyOf", () => {
  it("counts the start position as 0", () => {
    expect(plyOf(START)).toBe(0);
  });

  it("increments by one for black-to-move on move 1", () => {
    // after 1. e4 — black to move, still fullmove 1
    expect(plyOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1")).toBe(1);
  });

  it("increments by two per full move", () => {
    // after 1. e4 e5 — white to move, fullmove 2
    expect(plyOf("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2")).toBe(2);
    // after 1. e4 e5 2. Nf3 — black to move, fullmove 2
    expect(plyOf("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2")).toBe(3);
  });

  it("never lets a later position rank below an earlier one (merge guard)", () => {
    const earlier = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const later = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";
    expect(plyOf(later)).toBeGreaterThan(plyOf(earlier));
  });

  it("defaults a malformed/empty FEN to 0 instead of NaN", () => {
    expect(plyOf("")).toBe(0);
    expect(plyOf("garbage")).toBe(0);
  });
});
