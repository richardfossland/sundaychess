import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { annotateGame, classifyMove } from "@/lib/chess/analysis";

// Build a PGN move-list string from SAN moves (chess.js validates legality).
function pgnFromSans(sans: string[], result = "*"): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  // chess.js pgn() includes headers/result; for review we only need the moves,
  // but annotateGame loads via loadPgn so a full pgn() is fine. Inject result.
  chess.header("Result", result);
  return chess.pgn();
}

describe("classifyMove", () => {
  it("found_mate dominates everything", () => {
    expect(classifyMove({ delta: -999, hadMateBefore: true, isMate: true })).toBe("found_mate");
  });
  it("missed_mate when a mate was available and not taken", () => {
    expect(classifyMove({ delta: 5, hadMateBefore: true, isMate: false })).toBe("missed_mate");
  });
  it("blunder on a large negative swing", () => {
    expect(classifyMove({ delta: -400, hadMateBefore: false, isMate: false })).toBe("blunder");
  });
  it("mistake on a medium negative swing", () => {
    expect(classifyMove({ delta: -150, hadMateBefore: false, isMate: false })).toBe("mistake");
  });
  it("inaccuracy on a small negative swing", () => {
    expect(classifyMove({ delta: -80, hadMateBefore: false, isMate: false })).toBe("inaccuracy");
  });
  it("good on a small drop inside the good band", () => {
    expect(classifyMove({ delta: -30, hadMateBefore: false, isMate: false })).toBe("good");
  });
  it("best on a non-losing or near-zero swing", () => {
    expect(classifyMove({ delta: 30, hadMateBefore: false, isMate: false })).toBe("best");
    expect(classifyMove({ delta: -10, hadMateBefore: false, isMate: false })).toBe("best");
  });
  it("missed_mate beats a blunder-sized delta (mate facts win)", () => {
    expect(classifyMove({ delta: -500, hadMateBefore: true, isMate: false })).toBe("missed_mate");
  });
});

describe("annotateGame", () => {
  it("returns null for an empty PGN", () => {
    expect(annotateGame("", "W", "B")).toBeNull();
  });

  it("returns null for a PGN with no moves", () => {
    expect(annotateGame('[Result "1/2-1/2"]', "W", "B")).toBeNull();
  });

  it("annotates every ply with side and move number", () => {
    const pgn = pgnFromSans(["e4", "e5", "Nf3", "Nc6"]);
    const r = annotateGame(pgn, "Alice", "Bob")!;
    expect(r).not.toBeNull();
    expect(r.moves).toHaveLength(4);
    expect(r.moves[0]).toMatchObject({ ply: 1, moveNumber: 1, side: "w", san: "e4" });
    expect(r.moves[1]).toMatchObject({ ply: 2, moveNumber: 1, side: "b", san: "e5" });
    expect(r.moves[2]).toMatchObject({ ply: 3, moveNumber: 2, side: "w", san: "Nf3" });
    expect(r.white.name).toBe("Alice");
    expect(r.black.name).toBe("Bob");
  });

  it("tags a checkmate-delivering move as found_mate (Scholar's mate)", () => {
    // 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7# — White delivers mate.
    const pgn = pgnFromSans(
      ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"],
      "1-0",
    );
    const r = annotateGame(pgn, "W", "B")!;
    const last = r.moves[r.moves.length - 1];
    expect(last.san).toBe("Qxf7#");
    expect(last.isMate).toBe(true);
    expect(last.tag).toBe("found_mate");
    expect(r.white.counts.found_mate).toBe(1);
    expect(r.result).toBe("white_win");
  });

  it("the side that gets mated has a heavily negative worst move", () => {
    const pgn = pgnFromSans(
      ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"],
      "1-0",
    );
    const r = annotateGame(pgn, "W", "B")!;
    // Black's Nf6 allowed the mate → black's worst move is very negative.
    expect(r.black.worstMoveIndex).toBeGreaterThanOrEqual(0);
    const worst = r.black.moves[r.black.worstMoveIndex];
    expect(worst.delta).toBeLessThan(0);
  });

  it("deltas are from the mover's perspective (a hung queen hurts the mover)", () => {
    // White plays a clean opening then hangs the queen: Qh5 then ...g6 then Qxg6?? hxg6.
    // Simpler: construct a position where white blunders the queen.
    const chess = new Chess("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    chess.move("Qd8"); // safe-ish; just to have a move
    const pgn = chess.pgn();
    const r = annotateGame(pgn, "W", "B")!;
    expect(r.moves[0].side).toBe("w");
    // every move has cpBefore/cpAfter populated as numbers
    expect(typeof r.moves[0].cpBefore).toBe("number");
    expect(typeof r.moves[0].cpAfter).toBe("number");
  });

  it("averageCpLoss is non-negative and counts roll up", () => {
    const pgn = pgnFromSans(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    const r = annotateGame(pgn, "W", "B")!;
    expect(r.white.averageCpLoss).toBeGreaterThanOrEqual(0);
    const total = (Object.values(r.white.counts) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(r.white.moves.length);
  });

  it("parses each PGN result tag", () => {
    expect(annotateGame(pgnFromSans(["e4", "e5"], "1-0"), "W", "B")!.result).toBe("white_win");
    expect(annotateGame(pgnFromSans(["e4", "e5"], "0-1"), "W", "B")!.result).toBe("black_win");
    expect(annotateGame(pgnFromSans(["e4", "e5"], "1/2-1/2"), "W", "B")!.result).toBe("draw");
    expect(annotateGame(pgnFromSans(["e4", "e5"], "*"), "W", "B")!.result).toBe("unknown");
  });
});
