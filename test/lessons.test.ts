import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { LESSONS, checkLessonGoal, type Lesson } from "@/lib/coach/lessons";

/** "e2e4" / "a7a8q" → the MoveIntent the app would produce. */
function parse(uci: string) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? undefined,
  };
}

function uciOf(m: { from: string; to: string; promotion?: string }) {
  return `${m.from}${m.to}${m.promotion ?? ""}`;
}

/** Every legal move from the lesson position that satisfies the goal. */
function solvingMoves(lesson: Lesson): string[] {
  const chess = new Chess(lesson.fen);
  return chess
    .moves({ verbose: true })
    .filter((m) => checkLessonGoal(lesson.goal, lesson.fen, parse(uciOf(m))))
    .map(uciOf);
}

describe("lesson pack", () => {
  it("has unique ids", () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships the whole course", () => {
    expect(LESSONS.length).toBe(18);
  });

  it("gives every lesson a title, blurb, hint and solution", () => {
    for (const l of LESSONS) {
      expect(l.title.length, l.id).toBeGreaterThan(0);
      expect(l.blurb.length, l.id).toBeGreaterThan(0);
      expect(l.hint.length, l.id).toBeGreaterThan(0);
      expect(l.solution, l.id).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    }
  });

  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      // (a) the FEN loads at all — chess.js throws on an illegal position.
      it("loads as a legal, live position", () => {
        const chess = new Chess(lesson.fen);
        expect(chess.isGameOver(), "position is already over").toBe(false);

        // ...and the side that is NOT to move must not already be in check.
        // chess.js accepts such a FEN, but the position can never arise in a
        // real game — a shipped lesson (mate-queen-king) was broken this way,
        // which made "any move" count as mate.
        const [placement, turn, ...rest] = lesson.fen.split(" ");
        const flipped = [placement, turn === "w" ? "b" : "w", ...rest].join(" ");
        expect(new Chess(flipped).inCheck(), "the side not to move is in check").toBe(false);
      });

      // (b) the side to move is the side the lesson (and the board) expects.
      it("has a side to move that matches the FEN field", () => {
        const chess = new Chess(lesson.fen);
        const expected = lesson.fen.split(" ")[1] === "b" ? "b" : "w";
        expect(chess.turn()).toBe(expected);
      });

      // (c) the goal is actually reachable in one move.
      it("is solvable in one move", () => {
        expect(solvingMoves(lesson).length, "no legal move satisfies the goal").toBeGreaterThan(0);
      });

      // (e) the move the lesson claims is the answer really is one.
      it("accepts its own listed solution", () => {
        expect(checkLessonGoal(lesson.goal, lesson.fen, parse(lesson.solution))).toBe(true);
        expect(solvingMoves(lesson)).toContain(lesson.solution);
      });

      it("lists every declared alternative as a real solution", () => {
        const solving = solvingMoves(lesson);
        for (const alt of lesson.altSolutions ?? []) {
          expect(solving, `${alt} does not satisfy the goal`).toContain(alt);
        }
      });

      // (d) for mate lessons: exactly the declared move(s) mate — nothing else.
      if (lesson.goal.type === "mate_in_one") {
        it("has exactly the declared mating move(s)", () => {
          const chess = new Chess(lesson.fen);
          const mates = chess
            .moves({ verbose: true })
            .filter((m) => {
              const probe = new Chess(lesson.fen);
              probe.move(m.san);
              return probe.isCheckmate();
            })
            .map(uciOf);
          const declared = [lesson.solution, ...(lesson.altSolutions ?? [])];
          expect([...mates].sort()).toEqual([...declared].sort());
        });
      }

      // A wrong-but-legal move must NOT be accepted, or the lesson can't fail.
      it("rejects at least one legal non-solution", () => {
        const chess = new Chess(lesson.fen);
        const all = chess.moves({ verbose: true }).map(uciOf);
        const solving = new Set(solvingMoves(lesson));
        const wrong = all.filter((m) => !solving.has(m));
        expect(wrong.length, "every legal move solves this lesson").toBeGreaterThan(0);
        for (const m of wrong) {
          expect(checkLessonGoal(lesson.goal, lesson.fen, parse(m)), `${m} wrongly accepted`).toBe(
            false,
          );
        }
      });
    });
  }
});

describe("checkLessonGoal", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("rejects an illegal move", () => {
    expect(checkLessonGoal({ type: "move_to", to: "e5" }, start, { from: "e2", to: "e5" })).toBe(
      false,
    );
  });

  it("rejects a broken FEN instead of throwing", () => {
    expect(checkLessonGoal({ type: "move_to", to: "e4" }, "not a fen", { from: "e2", to: "e4" })).toBe(
      false,
    );
  });

  it("only counts a castle for the castle goal", () => {
    const fen = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(checkLessonGoal({ type: "castle" }, fen, { from: "e1", to: "g1" })).toBe(true);
    expect(checkLessonGoal({ type: "castle" }, fen, { from: "e1", to: "f1" })).toBe(false);
    expect(checkLessonGoal({ type: "castle" }, fen, { from: "d2", to: "d3" })).toBe(false);
  });

  it("counts a promotion as reaching the promotion square", () => {
    const fen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
    expect(
      checkLessonGoal({ type: "move_to", to: "a8" }, fen, { from: "a7", to: "a8", promotion: "q" }),
    ).toBe(true);
  });

  it("weighs win_material by the captured piece", () => {
    const fen = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";
    expect(checkLessonGoal({ type: "win_material", minCp: 600 }, fen, { from: "e4", to: "d5" })).toBe(
      true,
    );
    expect(
      checkLessonGoal({ type: "win_material", minCp: 600 }, fen, { from: "e1", to: "e2" }),
    ).toBe(false);
  });
});
