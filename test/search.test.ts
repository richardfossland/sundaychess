import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { searchBestMove } from "@/lib/chess/search";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("searchBestMove (strong engine)", () => {
  it("returns a legal move from the start position", () => {
    const m = searchBestMove(START, { maxDepth: 3, nodeBudget: 30_000 });
    expect(m).not.toBeNull();
    const chess = new Chess(START);
    expect(() => chess.move({ from: m!.from, to: m!.to, promotion: "q" })).not.toThrow();
  });

  it("finds a forced mate in one", () => {
    const fen = "6k1/5ppp/8/8/8/8/8/R6K w - - 0 1"; // Ra8#
    expect(searchBestMove(fen, { maxDepth: 4 })).toMatchObject({ from: "a1", to: "a8" });
  });

  it("wins a hanging queen", () => {
    const fen = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1"; // exd5
    expect(searchBestMove(fen)?.to).toBe("d5");
  });

  it("does not blunder back a piece (quiescence): recaptures a defended capture", () => {
    // White just has Nf3 vs a pawn on e5 defended by d6+f6 — capturing Nxe5
    // loses the knight, so the engine must NOT play it.
    const fen = "rnbqkb1r/ppp2ppp/3p1n2/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1";
    const m = searchBestMove(fen, { maxDepth: 3, nodeBudget: 60_000 });
    expect(m).not.toBeNull();
    expect(m && `${m.from}${m.to}`).not.toBe("f3e5");
  });

  it("returns null when there are no legal moves (checkmate)", () => {
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(searchBestMove(mated)).toBeNull();
  });

  it("terminates within a tiny node budget", () => {
    // The budget guarantees termination; just assert it still returns a move.
    expect(searchBestMove(START, { maxDepth: 99, nodeBudget: 500 })).not.toBeNull();
  });
});
