// Lesson foundation for solo "Lær"-mode. A small, extensible framework: each
// lesson is a start position + a goal the move must satisfy + a hint. Goal
// checking is PURE + node-testable. Content is intentionally small (the
// framework is the deliverable); add lessons by appending to LESSONS.
//
// FENs reuse positions already verified elsewhere (the mate-in-1 pack in
// lib/puzzles.ts) so a broken position can't ship.

import { Chess } from "chess.js";
import { VALUE, type PieceType } from "@/lib/chess/bot";
import type { MoveIntent } from "@/lib/chess/validateMove";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type LessonGoal =
  | { type: "mate_in_one" }
  | { type: "win_material"; minCp: number }
  | { type: "move_to"; to: string };

export interface Lesson {
  id: string;
  title: string;
  blurb: string;
  fen: string;
  goal: LessonGoal;
  hint: string;
}

export const LESSONS: Lesson[] = [
  {
    id: "first-move",
    title: "Ditt første trekk",
    blurb: "Åpne partiet ved å flytte en bonde ut i sentrum.",
    fen: START,
    goal: { type: "move_to", to: "e4" },
    hint: "Dra kongebonden fra e2 til e4.",
  },
  {
    id: "win-queen",
    title: "Vinn dronningen",
    blurb: "Motstanderens dronning står ubeskyttet. Slå den!",
    fen: "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1",
    goal: { type: "win_material", minCp: 600 },
    hint: "Bonden på e4 kan slå skrått til d5.",
  },
  {
    id: "mate-rook",
    title: "Sjakkmatt med tårn",
    blurb: "Sett svart sjakkmatt i ett trekk.",
    fen: "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1",
    goal: { type: "mate_in_one" },
    hint: "Tårnet til den åpne siste raden.",
  },
  {
    id: "mate-queen-king",
    title: "Dronning + konge gir matt",
    blurb: "Kongen din støtter dronningen. Sett matt i ett.",
    fen: "7k/8/6K1/8/8/8/8/7Q w - - 0 1",
    goal: { type: "mate_in_one" },
    hint: "Dronningen kan gå helt bort til kongen.",
  },
];

/** Did `move` (played from `lesson.fen`) satisfy the goal? Pure + deterministic. */
export function checkLessonGoal(
  goal: LessonGoal,
  fenBefore: string,
  move: MoveIntent,
): boolean {
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return false;
  }
  let mv;
  try {
    mv = chess.move({ from: move.from, to: move.to, promotion: (move.promotion ?? "q") as "q" });
  } catch {
    return false;
  }
  if (!mv) return false;

  switch (goal.type) {
    case "mate_in_one":
      return chess.isCheckmate();
    case "move_to":
      return mv.to === goal.to;
    case "win_material":
      return Boolean(mv.captured) && VALUE[mv.captured as PieceType] >= goal.minCp;
    default:
      return false;
  }
}
