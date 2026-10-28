// Avledede visninger over PhysicalTournament. Alle rene funksjoner.

import { buildFirstRound, nextRound, type BracketMatch } from "@/lib/tournament/bracket";
import { cupBracketSize } from "@/lib/tournament/bracket";
import { pairRound } from "@/lib/tournament/pairing";
import { colourStatesFromHistory } from "@/lib/tournament/pairing/colors";
import type { BoardPairing, ColourState, GameResult, HistoryGame, PairingPlayer } from "@/lib/tournament/pairing/types";
import { computeStandings, DEFAULT_TIEBREAKS, type StandingRow } from "@/lib/tournament/tiebreaks";
import { fail } from "./errors";
import { makeEvent, type EventMeta } from "./events";
import { assertCanPair, reduce } from "./reducer";
import type { PhysicalPairing, PhysicalPlayer, PhysicalTournament, ResultCode } from "./schema";

const GAME_RESULT: Record<ResultCode, { result: GameResult; forfeit: boolean }> = {
  "1-0": { result: "1-0", forfeit: false },
  "0-1": { result: "0-1", forfeit: false },
  "½-½": { result: "1/2-1/2", forfeit: false },
  "+-": { result: "1-0", forfeit: true },
  "-+": { result: "0-1", forfeit: true },
  "=": { result: "0-0", forfeit: true },
};

/** Poeng (hvit, svart) for et resultat. */
export function resultPoints(r: ResultCode): [number, number] {
  switch (r) {
    case "1-0":
    case "+-":
      return [1, 0];
    case "0-1":
    case "-+":
      return [0, 1];
    case "½-½":
      return [0.5, 0.5];
    default:
      return [0, 0];
  }
}

/** Spillhistorikk i motorens format. Standard: bare fullførte runder (det parring bygger på). */
export function historyOf(t: PhysicalTournament, opts: { includeOpen?: boolean } = {}): HistoryGame[] {
  const out: HistoryGame[] = [];
  for (const r of t.rounds) {
    if (r.status !== "completed" && !opts.includeOpen) continue;
    if (r.status === "draft") continue;
    // Senpåmeldte med ½ poeng for tapte runder: virtuell halv frirunde.
    for (const pl of t.players) {
      if (pl.missedRoundPoints === 0.5 && pl.lateEntryRound !== undefined && r.number < pl.lateEntryRound) {
        out.push({ round: r.number, white: pl.id, black: null, result: "bye", byeType: "half" });
      }
    }
    for (const p of r.pairings) {
      if (p.black === null) {
        out.push({ round: r.number, white: p.white, black: null, result: "bye", byeType: p.byeType ?? "full" });
        continue;
      }
      if (!p.result) continue;
      const g = GAME_RESULT[p.result];
      out.push({
        round: r.number,
        white: p.white,
        black: p.black,
        result: g.result,
        ...(g.forfeit ? { forfeit: true } : {}),
      });
    }
  }
  return out;
}

export type StandingWithPlayer = StandingRow & { player: PhysicalPlayer };

/** Stilling via computeStandings med turneringens tiebreaks. */
export function standings(t: PhysicalTournament, opts: { includeOpen?: boolean } = {}): StandingWithPlayer[] {
  const history = historyOf(t, opts);
  const R = history.reduce((m, g) => Math.max(m, g.round), 0);
  const rows = computeStandings(
    t.players.map((p) => ({ id: p.id, rating: p.rating })),
    history,
    t.settings.tiebreaks.length ? t.settings.tiebreaks : DEFAULT_TIEBREAKS,
    R,
  );
  const byId = new Map(t.players.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, player: byId.get(r.playerId)! }));
}

export interface CrosstableCell {
  round: number;
  /** Poeng for raden-spilleren. */
  points: number;
  colour: "W" | "B";
  forfeit: boolean;
}
export interface CrosstableRow {
  playerId: string;
  score: number;
  /** nøkkel = motstander-id */
  cells: Record<string, CrosstableCell[]>;
  /** poeng fra frirunder */
  byePoints: number;
}

export function crosstable(t: PhysicalTournament, opts: { includeOpen?: boolean } = {}): CrosstableRow[] {
  const rows = new Map<string, CrosstableRow>(
    t.players.map((p) => [p.id, { playerId: p.id, score: 0, cells: {}, byePoints: 0 }]),
  );
  for (const r of t.rounds) {
    if (r.status === "draft" || (r.status !== "completed" && !opts.includeOpen)) continue;
    for (const pl of t.players) {
      if (pl.missedRoundPoints === 0.5 && pl.lateEntryRound !== undefined && r.number < pl.lateEntryRound) {
        const row = rows.get(pl.id)!;
        row.byePoints += 0.5;
        row.score += 0.5;
      }
    }
    for (const p of r.pairings) {
      if (p.black === null) {
        const pts = p.byeType === "half" ? 0.5 : p.byeType === "zero" ? 0 : 1;
        const row = rows.get(p.white)!;
        row.byePoints += pts;
        row.score += pts;
        continue;
      }
      if (!p.result) continue;
      const [w, b] = resultPoints(p.result);
      const forfeit = p.result === "+-" || p.result === "-+" || p.result === "=";
      const wr = rows.get(p.white)!;
      const br = rows.get(p.black)!;
      (wr.cells[p.black] ??= []).push({ round: r.number, points: w, colour: "W", forfeit });
      (br.cells[p.white] ??= []).push({ round: r.number, points: b, colour: "B", forfeit });
      wr.score += w;
      br.score += b;
    }
  }
  return t.players.map((p) => rows.get(p.id)!);
}

/** Farger per runde ("W" | "B" | "-" for frirunde/ikke parret), indeksert fra runde 1. */
export function colourHistory(t: PhysicalTournament): Map<string, ("W" | "B" | "-")[]> {
  const out = new Map<string, ("W" | "B" | "-")[]>(t.players.map((p) => [p.id, []]));
  for (const r of t.rounds) {
    const seen = new Set<string>();
    for (const p of r.pairings) {
      out.get(p.white)?.push(p.black === null ? "-" : "W");
      seen.add(p.white);
      if (p.black) {
        out.get(p.black)?.push("B");
        seen.add(p.black);
      }
    }
    for (const [id, arr] of out) if (!seen.has(id)) arr.push("-");
  }
  return out;
}

/** Fargetilstand slik parringsmotoren ser den (walkover teller ikke som farge). */
export function colourStates(t: PhysicalTournament): Map<string, ColourState> {
  return colourStatesFromHistory(historyOf(t));
}

function winnerOf(p: PhysicalPairing): string | null {
  if (p.black === null) return p.white;
  if (p.result === "1-0" || p.result === "+-") return p.white;
  if (p.result === "0-1" || p.result === "-+") return p.black;
  return null;
}

function knockoutPairings(t: PhysicalTournament, round: number): PhysicalPairing[] {
  let matches: BracketMatch[];
  if (round === 1) {
    const seeded = [...t.players]
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.startNo - b.startNo)
      .map((p, i) => ({ playerId: p.id, seed: i + 1 }));
    matches = buildFirstRound(seeded, cupBracketSize(t.players.length));
  } else {
    const prev = t.rounds[round - 2];
    const current: BracketMatch[] = [...prev.pairings]
      .sort((a, b) => a.board - b.board)
      .map((p, i) => ({
        matchId: `R${prev.number}-M${i}`,
        round: prev.number,
        slot: i,
        topSeed: null,
        bottomSeed: null,
        topPlayerId: p.white,
        bottomPlayerId: p.black,
        winnerPlayerId: winnerOf(p),
      }));
    matches = nextRound(current);
  }
  return matches.map((m, i) => ({
    board: i + 1,
    white: m.topPlayerId as string,
    black: m.bottomPlayerId,
    ...(m.bottomPlayerId === null ? { byeType: "full" as const } : {}),
    result: null,
  }));
}

/** Beregner parringene for neste runde med fase 1-motoren. Kaster PhysicalError hvis neste runde ikke kan pares nå. */
export function nextRoundPairing(t: PhysicalTournament): { round: number; pairings: PhysicalPairing[] } {
  const round = t.rounds.length + 1;
  assertCanPair(t, round);
  if (t.settings.system === "knockout") return { round, pairings: knockoutPairings(t, round) };

  const rows = standings(t);
  const byRow = new Map(rows.map((r) => [r.playerId, r]));
  const requests = new Map(t.byeRequests.filter((r) => r.round === round).map((r) => [r.playerId, r.byeType]));
  const players: PairingPlayer[] = t.players.map((p) => {
    const row = byRow.get(p.id);
    return {
      id: p.id,
      startNo: p.startNo,
      rating: p.rating,
      score: row?.score ?? 0,
      tiebreak: row?.values.buchholz ?? 0,
      status: p.status,
      ...(requests.has(p.id) ? { byeRequest: requests.get(p.id) } : {}),
    };
  });
  const out = pairRound(
    t.settings.system,
    { players, history: historyOf(t), round },
    { double: !!t.settings.doubleRoundRobin },
  );
  const requested = new Set(requests.keys());
  const pairings = out.pairings.map((b: BoardPairing): PhysicalPairing => {
    const p: PhysicalPairing = { board: b.board, white: b.white, black: b.black, result: null };
    if (b.black === null) {
      let bt = b.byeType ?? "full";
      if (bt === "full" && t.settings.byePoints === 0.5 && t.settings.system !== "roundRobin" && !requested.has(b.white)) bt = "half";
      p.byeType = bt;
    }
    if (b.rematch) p.rematch = true;
    return p;
  });
  return { round, pairings };
}

/** Par neste runde og lagre den som hendelse. */
export function pairNextRound(t: PhysicalTournament, meta?: EventMeta): PhysicalTournament {
  const { round, pairings } = nextRoundPairing(t);
  if (pairings.length === 0) fail("notEnoughPlayers");
  return reduce(t, makeEvent({ type: "pairRound", round, pairings }, meta));
}

/** Gjeldende (siste) runde som ikke er fullført, ellers null. */
export function openRound(t: PhysicalTournament) {
  const last = t.rounds[t.rounds.length - 1];
  return last && last.status !== "completed" ? last : null;
}
