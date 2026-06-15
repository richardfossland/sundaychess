import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { bookMove, __bookSize } from "@/lib/chess/openings";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("opening book", () => {
  it("built some positions at load", () => {
    expect(__bookSize).toBeGreaterThan(5);
  });

  it("returns a legal opening move from the start position", () => {
    const m = bookMove(START);
    expect(m).not.toBeNull();
    const chess = new Chess(START);
    expect(() => chess.move({ from: m!.from, to: m!.to, promotion: "q" })).not.toThrow();
  });

  it("plays e4 first by default (deterministic)", () => {
    expect(bookMove(START)).toMatchObject({ from: "e2", to: "e4" });
  });

  it("normalizes away move clocks (same position, different counters)", () => {
    const sameButLaterClocks =
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 9 9";
    expect(bookMove(sameButLaterClocks)).toEqual(bookMove(START));
  });

  it("answers a known line: after 1.e4 it has a reply for Black", () => {
    const chess = new Chess(START);
    chess.move("e4");
    const m = bookMove(chess.fen());
    expect(m).not.toBeNull();
    expect(() => chess.move({ from: m!.from, to: m!.to, promotion: "q" })).not.toThrow();
  });

  it("returns null for an out-of-book position", () => {
    // a random middlegame-ish position not in any line
    expect(bookMove("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1")).toBeNull();
  });
});
