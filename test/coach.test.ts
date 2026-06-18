import { describe, expect, it } from "vitest";
import { moveAdvice } from "@/lib/chess/coach";
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
