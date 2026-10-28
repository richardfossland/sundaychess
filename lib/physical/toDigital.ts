// Fysisk -> digital (M5b). Ren funksjon: lager en PLAN (spillere, runder,
// resultat-only-partier, config) som serveren skriver til databasen. Ingen I/O.
//
// Koding av resultater i `games` (se migrasjon 0017):
//  1-0 / 0-1 / ½-½  -> white_win / black_win / draw, result_source 'physical'
//  +- / -+          -> white_win / black_win, 'walkover' (teller poeng, ikke møte/farge)
//  =                -> aborted (0-0), 'walkover'
//  frirunde full / ½ / 0 -> black=null: 'bye' (1) / 'draw' (½) / 'aborted' (0)

import { totalRounds } from "@/lib/physical/reducer";
import type { PhysicalPairing, PhysicalTournament } from "@/lib/physical/schema";
import type { GameStatus, ResultSource, TournamentConfig } from "@/lib/types";

/** Digital støtter maks så mange ligarunder (samme tak som wizard/config). */
export const MAX_DIGITAL_ROUNDS = 7;

export type ContinueRefusal =
  | "knockout"
  | "roundOpen"
  | "noRoundsLeft"
  | "tooManyRounds"
  | "tooFewPlayers";

export interface PlanGame {
  white: string;
  black: string | null;
  status: GameStatus;
  resultSource: ResultSource;
  slot: number;
}
export interface PlanPlayer {
  key: string;
  name: string;
  rating?: number;
  club?: string;
  startNo: number;
  status: "active" | "left";
}
export interface DigitalPlan {
  title: string;
  config: TournamentConfig;
  players: PlanPlayer[];
  rounds: { number: number; games: PlanGame[] }[];
}

export function continueRefusal(t: PhysicalTournament): ContinueRefusal | null {
  if (t.settings.system === "knockout") return "knockout";
  if (t.rounds.some((r) => r.status !== "completed")) return "roundOpen";
  const total = totalRounds(t);
  if (t.rounds.length >= total) return "noRoundsLeft";
  if (total > MAX_DIGITAL_ROUNDS) return "tooManyRounds";
  if (t.players.filter((p) => p.status === "active").length < 2) return "tooFewPlayers";
  return null;
}

function gameOf(p: PhysicalPairing, slot: number): PlanGame {
  if (p.black === null) {
    const bt = p.byeType ?? "full";
    return {
      white: p.white,
      black: null,
      slot,
      status: bt === "half" ? "draw" : bt === "zero" ? "aborted" : "bye",
      resultSource: bt === "full" ? "bye" : "physical",
    };
  }
  const base = { white: p.white, black: p.black, slot };
  switch (p.result) {
    case "1-0":
      return { ...base, status: "white_win", resultSource: "physical" };
    case "0-1":
      return { ...base, status: "black_win", resultSource: "physical" };
    case "½-½":
      return { ...base, status: "draw", resultSource: "physical" };
    case "+-":
      return { ...base, status: "white_win", resultSource: "walkover" };
    case "-+":
      return { ...base, status: "black_win", resultSource: "walkover" };
    default:
      return { ...base, status: "aborted", resultSource: "walkover" };
  }
}

export function buildDigitalPlan(t: PhysicalTournament): DigitalPlan {
  const total = totalRounds(t);
  const config: TournamentConfig = {
    format: "league",
    leagueRounds: total,
    playoff: false,
    playoffSize: 0,
    roundTimerSec: null,
    pairingSystem: t.settings.system as "monrad" | "swiss" | "roundRobin",
    tiebreaks: [...t.settings.tiebreaks],
    byePoints: t.settings.byePoints,
    ...(t.settings.system === "roundRobin" && t.settings.doubleRoundRobin ? { doubleRoundRobin: true } : {}),
    fromPhysical: {
      sourceId: t.id,
      allowFreeJoin: t.settings.allowLateEntry && t.settings.system !== "roundRobin",
      ...(t.settings.groupLabel ? { groupLabel: t.settings.groupLabel } : {}),
    },
  };
  const rounds = t.rounds.map((r) => {
    const games = [...r.pairings].sort((a, b) => a.board - b.board).map((p, i) => gameOf(p, i));
    // Senpåmeldte med ½ poeng for tapte runder: virtuell ½-frirunde (som historyOf).
    for (const pl of t.players) {
      if (pl.missedRoundPoints === 0.5 && pl.lateEntryRound !== undefined && r.number < pl.lateEntryRound) {
        games.push({ white: pl.id, black: null, status: "draw", resultSource: "physical", slot: games.length });
      }
    }
    return { number: r.number, games };
  });
  return {
    title: t.title,
    config,
    players: [...t.players]
      .sort((a, b) => a.startNo - b.startNo)
      .map((p) => ({
        key: p.id,
        name: p.name,
        ...(p.rating !== undefined ? { rating: p.rating } : {}),
        ...(p.club ? { club: p.club } : {}),
        startNo: p.startNo,
        status: p.status === "withdrawn" ? "left" : "active",
      })),
    rounds,
  };
}
