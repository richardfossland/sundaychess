import { createTournament, dispatch } from "@/lib/physical/reducer";
import type { PhysicalPairing, PhysicalTournament } from "@/lib/physical/schema";

/** Håndbygd 5-spillers turnering (ingen parringsmotor): 2 fullførte runder, frirunde, walkover, remis. */
export function goldenTournament(): PhysicalTournament {
  let n = 0;
  const m = () => ({ id: `g${++n}`, at: new Date(Date.UTC(2026, 9, 28, 10, 0, n)).toISOString() });
  let t = createTournament(
    { id: "golden", title: "Skolemesterskap Ås", settings: { system: "monrad", rounds: 3, tiebreaks: ["buchholz"], byePoints: 1, allowLateEntry: false, groupLabel: "Klasse" } },
    m(),
  );
  const ps: [string, string, number | undefined, string | undefined][] = [
    ["a", "Ola Nordmann", 1800, "7A"],
    ["b", "Åse Østby", 1650, "7B"],
    ["c", "Kari Hansen-Berg", undefined, "7A"],
    ["d", "Bjørn Æsøy", 1200, "7B"],
    ["e", "Li", undefined, undefined],
  ];
  for (const [id, name, rating, club] of ps) {
    t = dispatch(t, { type: "addPlayer", playerId: id, name, ...(rating ? { rating } : {}), ...(club ? { club } : {}) }, m());
  }
  const play = (round: number, pairings: PhysicalPairing[], results: Record<number, "1-0" | "0-1" | "½-½" | "+-" | "-+" | "=">) => {
    t = dispatch(t, { type: "pairRound", round, pairings }, m());
    t = dispatch(t, { type: "publishRound", round }, m());
    for (const [board, result] of Object.entries(results)) t = dispatch(t, { type: "setResult", round, board: Number(board), result }, m());
    t = dispatch(t, { type: "completeRound", round }, m());
  };
  play(
    1,
    [
      { board: 1, white: "a", black: "b" },
      { board: 2, white: "c", black: "d" },
      { board: 3, white: "e", black: null, byeType: "full" },
    ],
    { 1: "1-0", 2: "½-½" },
  );
  play(
    2,
    [
      { board: 1, white: "c", black: "a" },
      { board: 2, white: "b", black: "e" },
      { board: 3, white: "d", black: null, byeType: "half" },
    ],
    { 1: "0-1", 2: "-+" },
  );
  return t;
}
