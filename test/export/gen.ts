import { createTournament, dispatch } from "@/lib/physical/reducer";
import type { PhysicalSystem, PhysicalTournament, ResultCode } from "@/lib/physical/schema";
import { nextRoundPairing } from "@/lib/physical/selectors";
import { makeEvent } from "@/lib/physical/events";
import { reduce } from "@/lib/physical/reducer";

/** Deterministisk PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Åse Østby", "Ola Nordmann", "Kari Hansen", "Bjørn Æsøy", "Zoë Müller", "Li Wei", "Per Olsen", "=Formel Test", "Anna Berg", "Tor Lie", "Ida Dahl", "Jon Moe", "Eva Ly"];

/** Tilfeldig turnering fullstendig bygget via reduceren. */
export function randomTournament(seed: number): PhysicalTournament {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  let n = 0;
  const meta = () => ({ id: `s${seed}e${++n}`, at: new Date(Date.UTC(2026, 9, 28, 10, 0, n)).toISOString() });
  const system: PhysicalSystem = pick(["monrad", "swiss", "roundRobin", "knockout"] as const);
  const players = 3 + Math.floor(r() * 9);
  let t = createTournament(
    {
      id: `t${seed}`,
      title: `Turnering ${seed}`,
      settings: {
        system,
        rounds: 2 + Math.floor(r() * 4),
        tiebreaks: pick([["buchholz"], ["buchholz", "sonneborn_berger", "wins"], ["direct_encounter", "progressive"]] as const).slice(),
        byePoints: pick([1, 0.5] as const),
        allowLateEntry: true,
        groupLabel: "Klubb",
        ...(system === "roundRobin" ? { doubleRoundRobin: r() < 0.3 } : {}),
      },
    },
    meta(),
  );
  for (let i = 1; i <= players; i++) {
    t = dispatch(
      t,
      { type: "addPlayer", playerId: `p${i}`, name: NAMES[(i - 1) % NAMES.length], ...(r() < 0.8 ? { rating: 1000 + Math.floor(r() * 1200) } : {}), ...(r() < 0.5 ? { club: pick(["A", "B", "7A"]) } : {}) },
      meta(),
    );
  }
  const maxRounds = 1 + Math.floor(r() * 4);
  for (let k = 0; k < maxRounds; k++) {
    let pr;
    try {
      pr = nextRoundPairing(t);
    } catch {
      break;
    }
    if (pr.pairings.length === 0) break;
    t = reduce(t, makeEvent({ type: "pairRound", round: pr.round, pairings: pr.pairings }, meta()));
    t = dispatch(t, { type: "publishRound", round: pr.round }, meta());
    for (const p of pr.pairings) {
      if (p.black === null) continue;
      const opts: ResultCode[] = system === "knockout" ? ["1-0", "0-1", "+-", "-+"] : ["1-0", "0-1", "½-½", "½-½", "+-", "-+", "="];
      t = dispatch(t, { type: "setResult", round: pr.round, board: p.board, result: pick(opts) }, meta());
    }
    t = dispatch(t, { type: "completeRound", round: pr.round }, meta());
    if (r() < 0.2 && t.status === "running" && system !== "knockout" && system !== "roundRobin") {
      const act = t.players.filter((p) => p.status === "active");
      if (act.length > 3) t = dispatch(t, { type: "withdrawPlayer", playerId: pick(act).id }, meta());
    }
  }
  if (r() < 0.3 && t.rounds.length > 0 && t.rounds.every((x) => x.status === "completed")) {
    t = dispatch(t, { type: "finishTournament" }, meta());
  }
  return t;
}
