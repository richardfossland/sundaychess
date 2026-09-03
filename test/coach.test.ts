import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { adviceMap, moveAdvice } from "@/lib/chess/coach";
import { LESSONS, checkLessonGoal } from "@/lib/coach/lessons";

// White: Ke1 + Pe4; Black: Ke8 + Qd5 (undefended). exd5 wins the queen.
const HANGING_Q = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";

describe("moveAdvice", () => {
  it("the best move (winning the free queen) is ok", () => {
    expect(moveAdvice(HANGING_Q, { from: "e4", to: "d5" }).kind).toBe("ok");
  });

  it("ignoring a free queen is a blunder", () => {
    const a = moveAdvice(HANGING_Q, { from: "e1", to: "e2" });
    expect(a.kind).toBe("blunder");
    expect(a.lossCp).toBeGreaterThan(500);
  });

  it("does not judge a forced (only-legal) move", () => {
    // Black king in check from the rook with a single legal escape.
    const forced = "k7/8/8/8/8/8/8/K6R b - - 0 1"; // ...not forced; use a real one below
    // A true single-legal position: black king a8, white Ra7+ — Kb8 is forced
    const oneMove = "k7/R7/1K6/8/8/8/8/8 b - - 0 1";
    expect(moveAdvice(oneMove, { from: "a8", to: "b8" }).kind).toBe("ok");
    // sanity: the contrived `forced` fen still returns a defined advice
    expect(["ok", "inaccuracy", "blunder"]).toContain(
      moveAdvice(forced, { from: "a8", to: "b8" }).kind,
    );
  });
});

// ---------------------------------------------------------------------------
// adviceMap: the same verdicts, computed once for the whole position. The solo
// coach reads it out of a ref on the move path, so if it ever disagreed with
// moveAdvice a student would get a different verdict depending on how fast they
// moved. These positions cover a tactic, a promotion and an endgame with a wide
// choice of moves.
//
// The exhaustive comparison is deliberately expensive — it runs moveAdvice once
// PER LEGAL MOVE, which is exactly the work adviceMap exists to avoid — so
// these get a generous timeout.
// ---------------------------------------------------------------------------

// White pawn on b7 promotes; the black queen on g2 fences the white king in.
const PROMOTION = "4k3/1P6/8/8/8/8/6q1/4K3 w - - 0 1";
const ROOK_ENDGAME = "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1";
const AFTER_1E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

function legalMoves(fen: string) {
  return new Chess(fen).moves({ verbose: true }) as unknown as {
    from: string;
    to: string;
    promotion?: string;
  }[];
}

describe("adviceMap", () => {
  for (const [name, fen] of [
    ["a tactic (free queen)", HANGING_Q],
    ["a promotion position", PROMOTION],
    ["a rook endgame", ROOK_ENDGAME],
  ] as const) {
    it(
      `agrees with moveAdvice for every legal move — ${name}`,
      () => {
        const map = adviceMap(fen);
        const legal = legalMoves(fen);
        expect(legal.length).toBeGreaterThan(1);
        for (const m of legal) {
          expect(map[m.from + m.to]).toEqual(moveAdvice(fen, { from: m.from, to: m.to }));
        }
      },
      30_000,
    );
  }

  it("agrees on a wide opening position too (spot check)", () => {
    // 29 legal moves: comparing all of them means 29 full searches, so check the
    // best move, a quiet move and a piece give-away instead.
    const map = adviceMap(AFTER_1E4_E5);
    for (const mv of [
      { from: "g1", to: "f3" },
      { from: "a2", to: "a3" },
      { from: "d1", to: "h5" },
    ]) {
      expect(map[mv.from + mv.to]).toEqual(moveAdvice(AFTER_1E4_E5, mv));
    }
  }, 30_000);

  it("collapses the four promotion moves onto one key", () => {
    const map = adviceMap(PROMOTION);
    expect(legalMoves(PROMOTION).filter((m) => m.promotion)).toHaveLength(4); // q r b n
    expect(Object.keys(map).filter((k) => k === "b7b8")).toHaveLength(1);
  });

  it("never judges a forced move, and returns nothing for a finished game", () => {
    const oneMove = "k7/R7/1K6/8/8/8/8/8 b - - 0 1";
    expect(adviceMap(oneMove)).toEqual({ a8b8: { kind: "ok", lossCp: 0 } });
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(adviceMap(mated)).toEqual({});
    expect(adviceMap("not a fen")).toEqual({});
  });
});

describe("lessons", () => {
  it("every lesson has a reachable, legal solution shape", () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(3);
    for (const l of LESSONS) {
      expect(l.fen.split(" ")).toHaveLength(6);
      expect(l.hint.length).toBeGreaterThan(0);
    }
  });

  it("first-move lesson: e2-e4 completes it, d2-d4 does not", () => {
    const l = LESSONS.find((x) => x.id === "first-move")!;
    expect(checkLessonGoal(l.goal, l.fen, { from: "e2", to: "e4" })).toBe(true);
    expect(checkLessonGoal(l.goal, l.fen, { from: "d2", to: "d4" })).toBe(false);
  });

  it("win-queen lesson: exd5 completes it, a king move does not", () => {
    const l = LESSONS.find((x) => x.id === "win-queen")!;
    expect(checkLessonGoal(l.goal, l.fen, { from: "e4", to: "d5" })).toBe(true);
    expect(checkLessonGoal(l.goal, l.fen, { from: "e1", to: "e2" })).toBe(false);
  });

  it("mate-rook lesson: Ra8 mates, Ra7 does not", () => {
    const l = LESSONS.find((x) => x.id === "mate-rook")!;
    expect(checkLessonGoal(l.goal, l.fen, { from: "a1", to: "a8" })).toBe(true);
    expect(checkLessonGoal(l.goal, l.fen, { from: "a1", to: "a7" })).toBe(false);
  });
});
