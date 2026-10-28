import { dispatch, createTournament } from "@/lib/physical/reducer";
import { pairNextRound } from "@/lib/physical/selectors";
import type { PhysicalSettings, PhysicalTournament, ResultCode } from "@/lib/physical/schema";

let n = 0;
/** Deterministiske id-er og stigende tid for tester. */
export function meta() {
  n++;
  return { id: `e${n}`, at: new Date(Date.UTC(2026, 9, 28, 10, 0, n)).toISOString() };
}

export const baseSettings = (over: Partial<PhysicalSettings> = {}): PhysicalSettings => ({
  system: "monrad",
  rounds: 5,
  tiebreaks: ["buchholz", "sonneborn_berger"],
  byePoints: 1,
  allowLateEntry: true,
  ...over,
});

export function newTournament(over: Partial<PhysicalSettings> = {}, players = 8, title = "Test"): PhysicalTournament {
  let t = createTournament({ id: "t1", title, settings: baseSettings(over) }, meta());
  for (let i = 1; i <= players; i++) {
    t = dispatch(t, { type: "addPlayer", playerId: `p${i}`, name: `Spiller ${i}`, rating: 2000 - i * 10 }, meta());
  }
  return t;
}

/** Høyest rating vinner; lik rating → hvit. */
export function strongerWins(t: PhysicalTournament, white: string, black: string): ResultCode {
  const r = (id: string) => t.players.find((p) => p.id === id)!.rating ?? 0;
  return r(white) >= r(black) ? "1-0" : "0-1";
}

/** Par, publiser, før alle resultater, fullfør. */
export function playRound(
  t: PhysicalTournament,
  pick: (t: PhysicalTournament, white: string, black: string) => ResultCode = strongerWins,
): PhysicalTournament {
  t = pairNextRound(t, meta());
  const round = t.rounds[t.rounds.length - 1];
  t = dispatch(t, { type: "publishRound", round: round.number }, meta());
  for (const p of round.pairings) {
    if (p.black === null) continue;
    t = dispatch(t, { type: "setResult", round: round.number, board: p.board, result: pick(t, p.white, p.black) }, meta());
  }
  return dispatch(t, { type: "completeRound", round: round.number }, meta());
}
