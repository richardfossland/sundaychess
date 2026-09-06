// Lesson content for solo "Lær"-mode. Each lesson is a start position + a goal
// the move must satisfy + a hint + the move we mean. Goal checking is PURE +
// node-testable.
//
// EVERY lesson here is verified by test/lessons.test.ts, which loads the FEN,
// checks the side to move, checks that the position is legal (the side NOT to
// move must not already be in check — a shipped lesson used to fail exactly
// that), replays all legal moves to prove the goal is reachable, and asserts
// that `solution` is one of them. Mate lessons additionally assert that the
// mating moves are EXACTLY the ones the lesson declares.
//
// Add a lesson by appending to LESSONS with a `solution` — the test is what
// keeps a broken position from shipping.

import { Chess } from "chess.js";
import { VALUE, type PieceType } from "@/lib/chess/bot";
import type { MoveIntent } from "@/lib/chess/validateMove";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type LessonGoal =
  | { type: "mate_in_one" }
  | { type: "win_material"; minCp: number }
  | { type: "move_to"; to: string }
  /** Any castle (king- or queenside). Needed because no ordinary king move can
   *  express "rokade" — the king travels two squares and the rook jumps over. */
  | { type: "castle" };

export interface Lesson {
  id: string;
  title: string;
  blurb: string;
  fen: string;
  goal: LessonGoal;
  hint: string;
  /** The move we mean, in from+to(+promotion) form, e.g. "e2e4" / "a7a8q".
   *  Verified against `goal` in test/lessons.test.ts. */
  solution: string;
  /** Other moves that ALSO satisfy the goal, listed so the test can pin the
   *  exact solution set for mate lessons. Omit when `solution` is the only one. */
  altSolutions?: string[];
}

export const LESSONS: Lesson[] = [
  // ---- how the pieces move -------------------------------------------------
  {
    id: "bonde-fram",
    title: "Bonden går framover",
    blurb: "Bønder går bare én vei: framover. Første gang får de gå to skritt.",
    fen: "4k3/8/8/8/8/8/3P4/4K3 w - - 0 1",
    goal: { type: "move_to", to: "d4" },
    hint: "Dra bonden fra d2 helt til d4 – to skritt, det får den lov til nå.",
    solution: "d2d4",
  },
  {
    id: "win-queen",
    title: "Bonden slår på skrå",
    blurb: "Bonden går rett fram, men slår skrått. Her står dronningen i slag.",
    fen: "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1",
    goal: { type: "win_material", minCp: 600 },
    hint: "Bonden på e4 kan slå skrått til d5 – og der står dronningen.",
    solution: "e4d5",
  },
  {
    id: "springer-hopp",
    title: "Springeren hopper over",
    blurb: "Springeren går i en L – og den er den eneste brikken som hopper over andre.",
    fen: "4k3/8/8/8/8/8/4P1PP/5KN1 w - - 0 1",
    goal: { type: "move_to", to: "f3" },
    hint: "To opp og én til siden: springeren fra g1 til f3, rett over bøndene.",
    solution: "g1f3",
  },
  {
    id: "loper-diagonal",
    title: "Løperen går skrått",
    blurb: "Løperen går skrått så langt den vil – og blir alltid på samme farge.",
    fen: "4k3/8/7r/8/8/8/8/2B1K3 w - - 0 1",
    goal: { type: "move_to", to: "h6" },
    hint: "Følg diagonalen c1–d2–e3–f4–g5–h6 og slå tårnet.",
    solution: "c1h6",
  },
  {
    id: "tarn-linje",
    title: "Tårnet går rett",
    blurb: "Tårnet går rett opp, ned eller til siden – så langt linja er åpen.",
    fen: "4k3/p7/8/8/8/8/8/R3K3 w - - 0 1",
    goal: { type: "move_to", to: "a7" },
    hint: "A-linja er helt åpen. Kjør tårnet fra a1 opp til a7 og ta bonden.",
    solution: "a1a7",
  },
  {
    id: "dronning-kraft",
    title: "Dronningen kan begge deler",
    blurb: "Dronningen går som tårn OG som løper. Derfor er den den sterkeste brikken.",
    fen: "4k3/8/8/8/8/8/8/3QK3 w - - 0 1",
    goal: { type: "move_to", to: "a4" },
    hint: "Her bruker du løper-siden av dronningen: d1–c2–b3–a4.",
    solution: "d1a4",
  },
  {
    id: "konge-skritt",
    title: "Kongen går ett skritt",
    blurb: "Kongen går bare ett felt om gangen – men den kan slå, som alle andre.",
    fen: "8/8/8/4k3/8/8/3p4/3K4 w - - 0 1",
    goal: { type: "move_to", to: "d2" },
    hint: "Bonden på d2 er ubeskyttet. Ta den med kongen.",
    solution: "d1d2",
  },
  {
    id: "rokade",
    title: "Rokade – kongen i sikkerhet",
    blurb: "I ett trekk flytter du kongen to felt mot tårnet, og tårnet hopper over.",
    fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    goal: { type: "castle" },
    hint: "Feltene mellom kongen og h1-tårnet er tomme: flytt kongen fra e1 til g1.",
    solution: "e1g1",
  },
  {
    id: "forvandling",
    title: "Bonden blir dronning",
    blurb: "Kommer bonden helt fram til siste rad, bytter den seg til en ny dronning.",
    fen: "4k3/P7/8/8/8/8/8/4K3 w - - 0 1",
    goal: { type: "move_to", to: "a8" },
    hint: "Ett skritt igjen: a7–a8, så står det en dronning der.",
    solution: "a7a8q",
  },

  // ---- taktikk -------------------------------------------------------------
  {
    id: "gaffel",
    title: "Springergaffel",
    blurb: "En gaffel angriper to brikker samtidig. Motstanderen rekker bare å redde én.",
    fen: "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1",
    goal: { type: "move_to", to: "c7" },
    hint: "Finn feltet der springeren treffer både kongen på e8 og tårnet på a8.",
    solution: "d5c7",
  },
  {
    id: "avdekket-angrep",
    title: "Avdekket angrep",
    blurb: "Flytter du brikken foran, får brikken bak fri bane. Her gir det sjakk – og dronningen.",
    fen: "4k3/1p6/2q5/4N3/8/8/8/4RK2 w - - 0 1",
    goal: { type: "win_material", minCp: 900 },
    hint: "Slå dronningen på c6. Bonden kan ikke slå tilbake – tårnet på e1 gir sjakk i samme trekk.",
    solution: "e5c6",
  },
  {
    id: "binding",
    title: "Binding",
    blurb: "En bundet brikke tør ikke flytte, for da står noe enda dyrere i slag bak den.",
    fen: "3q2k1/5n2/8/8/8/8/8/2B1K3 w - - 0 1",
    goal: { type: "move_to", to: "g5" },
    hint: "Sett løperen på g5. Da står springeren på f6 fast foran dronningen på d8.",
    solution: "c1g5",
  },

  // ---- matt i ett ----------------------------------------------------------
  {
    id: "mate-rook",
    title: "Sjakkmatt med tårn",
    blurb: "Sett svart sjakkmatt i ett trekk.",
    fen: "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1",
    goal: { type: "mate_in_one" },
    hint: "Tårnet til den åpne siste raden. Bøndene sperrer for kongens egen flukt.",
    solution: "a1a8",
  },
  {
    id: "bakerste-rad",
    title: "Matt på bakerste rad",
    blurb: "Tårnet på d8 er alt som forsvarer siste rad. Fjern forsvareren.",
    fen: "3r2k1/5ppp/8/8/8/8/8/3RR1K1 w - - 0 1",
    goal: { type: "mate_in_one" },
    hint: "Slå tårnet på d8 med tårnet ditt fra d1 – da er raden din.",
    solution: "d1d8",
  },
  {
    id: "kvelermatt",
    title: "Kvelermatt",
    blurb: "Kongen er kvalt av sine egne brikker. Da holder det med en springer.",
    fen: "6rk/6pp/3N4/8/8/8/8/6K1 w - - 0 1",
    goal: { type: "mate_in_one" },
    hint: "Springeren til f7. Ingen av de svarte brikkene kan slå den.",
    solution: "d6f7",
  },
  {
    id: "mate-queen-king",
    title: "Dronning + konge gir matt",
    blurb: "Kongen din dekker fluktfeltene, dronningen setter matt.",
    fen: "7k/8/6K1/8/8/8/8/1Q6 w - - 0 1",
    goal: { type: "mate_in_one" },
    hint: "Kjør dronningen helt opp til b8 – kongen på g6 passer på g7 og h7.",
    solution: "b1b8",
  },

  // ---- prinsipper ----------------------------------------------------------
  {
    id: "redd-dronningen",
    title: "Ikke heng dronningen",
    blurb: "Dronningen din er angrepet. Sjekk alltid hva som står i slag før du flytter.",
    fen: "k7/8/2n5/8/3Q2r1/8/8/K7 w - - 0 1",
    goal: { type: "move_to", to: "g4" },
    hint: "Både springeren og tårnet angriper dronningen. Slå tårnet på g4 – da er den både reddet og i vinning.",
    solution: "d4g4",
  },
  {
    id: "first-move",
    title: "Åpne i sentrum",
    blurb: "Første trekk: ta plass i midten, så får brikkene dine plass til å komme ut.",
    fen: START,
    goal: { type: "move_to", to: "e4" },
    hint: "Dra kongebonden fra e2 til e4.",
    solution: "e2e4",
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
    case "castle":
      return mv.isKingsideCastle() || mv.isQueensideCastle();
    default:
      return false;
  }
}
