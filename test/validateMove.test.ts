import { describe, expect, it } from "vitest";
import {
  applyMove,
  legalDestinations,
  turnFromFen,
} from "@/lib/chess/validateMove";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("turnFromFen", () => {
  it("reads the side to move", () => {
    expect(turnFromFen(START)).toBe("w");
    expect(turnFromFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")).toBe("b");
  });
});

describe("applyMove", () => {
  it("applies a legal opening move and flips the turn", () => {
    const r = applyMove(START, { from: "e2", to: "e4" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.san).toBe("e4");
      expect(r.turn).toBe("b");
      expect(r.status).toBe("live");
      expect(r.fen.split(" ")[1]).toBe("b");
    }
  });

  it("rejects an illegal move", () => {
    const r = applyMove(START, { from: "e2", to: "e5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal");
  });

  it("rejects a malformed FEN", () => {
    const r = applyMove("not a fen", { from: "e2", to: "e4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_fen");
  });

  it("detects Fool's mate as a black win", () => {
    // 1. f3 e5 2. g4 Qh4#
    let fen = START;
    let pgn = "";
    for (const m of [
      { from: "f2", to: "f3" },
      { from: "e7", to: "e5" },
      { from: "g2", to: "g4" },
      { from: "d8", to: "h4" },
    ]) {
      const r = applyMove(fen, m, pgn);
      expect(r.ok).toBe(true);
      if (r.ok) {
        fen = r.fen;
        pgn = r.pgn;
      }
    }
    const final = applyMove(
      "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
      { from: "a2", to: "a3" },
    );
    // White has no escape — but a3 is itself just illegal-into-check handling;
    // instead assert the mate status from the move that delivered it:
    void final;
    const mate = applyMove(
      "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",
      { from: "d8", to: "h4" },
    );
    expect(mate.ok).toBe(true);
    if (mate.ok) {
      expect(mate.status).toBe("black_win");
      expect(mate.endReason).toBe("checkmate");
    }
  });

  it("rejects moving when the game is already over", () => {
    const matedFen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    const r = applyMove(matedFen, { from: "e1", to: "f2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("game_over");
  });

  it("promotes a pawn (default queen)", () => {
    const r = applyMove("8/P7/8/8/8/8/8/k6K w - - 0 1", { from: "a7", to: "a8" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toContain("=Q");
  });
});

describe("legalDestinations", () => {
  it("lists pawn + knight openings from the start", () => {
    expect(legalDestinations(START, "e2").sort()).toEqual(["e3", "e4"]);
    expect(legalDestinations(START, "g1").sort()).toEqual(["f3", "h3"]);
    expect(legalDestinations(START, "e1")).toEqual([]);
  });
});
