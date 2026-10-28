// Scoring + standings. Pure functions, recomputed from the game list so the
// board is always correct even if the denormalised players.score drifts.
//
// Points (spec §6): win 1, draw 0.5, loss 0, bye 1, aborted 0.

import type { Game, GameStatus, Player, Round } from "@/lib/types";
import {
  computeStandings as computeTiebreakStandings,
  type TiebreakGame,
  type TiebreakKey,
} from "@/lib/tournament/tiebreaks";

export interface StandingRow {
  playerId: string;
  displayName: string;
  score: number;
  tiebreak: number; // Buchholz
  rank: number;
  /** Alle tiebreak-verdier; kun satt når en rekkefølge er konfigurert. */
  tiebreaks?: Partial<Record<TiebreakKey, number | null>>;
}

export interface StandingsOptions {
  /** Konfigurert rekkefølge (config.tiebreaks, validert med resolveTiebreaks).
   * Uten dette brukes dagens oppførsel: score → Buchholz → navn. */
  tiebreaks?: TiebreakKey[];
  /** Nødvendig sammen med `tiebreaks` for å kjenne rundenummer per parti. */
  rounds?: Round[];
}

const FORFEIT_SOURCES = new Set(["walkover", "opponent_absent"]);

/** Game-rader → historikk for tiebreak-motoren. Pågående partier utelates. */
export function gamesToHistory(games: Game[], rounds: Round[]): TiebreakGame[] {
  const num = new Map(rounds.map((r) => [r.id, r.number]));
  const out: TiebreakGame[] = [];
  for (const g of games) {
    if (!isResolved(g.status)) continue;
    const round = num.get(g.round_id) ?? 0;
    const base = { round, white: g.white_player_id, black: g.black_player_id };
    if (g.status === "bye" || g.black_player_id === null) {
      out.push({ ...base, black: null, result: "bye" });
      continue;
    }
    const result =
      g.status === "white_win" ? "1-0" : g.status === "black_win" ? "0-1" : g.status === "draw" ? "1/2-1/2" : "0-0";
    out.push({
      ...base,
      result,
      ...(isUnplayed(g) ? { forfeit: true } : {}),
    });
  }
  return out;
}

/** Points earned by each side from a single finished game. */
export function pointsFor(status: GameStatus): { white: number; black: number } {
  switch (status) {
    case "white_win":
      return { white: 1, black: 0 };
    case "black_win":
      return { white: 0, black: 1 };
    case "draw":
      return { white: 0.5, black: 0.5 };
    case "bye":
      return { white: 1, black: 0 }; // black is null on a bye
    case "live":
    case "aborted":
    default:
      return { white: 0, black: 0 };
  }
}

const RESOLVED: GameStatus[] = [
  "white_win",
  "black_win",
  "draw",
  "bye",
  "aborted",
];
export function isResolved(status: GameStatus): boolean {
  return RESOLVED.includes(status);
}

/** Raw score per player id, summed across all resolved games. */
export function computeScores(games: Game[]): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (id: string, n: number) =>
    scores.set(id, (scores.get(id) ?? 0) + n);

  for (const g of games) {
    if (!isResolved(g.status)) continue;
    const pts = pointsFor(g.status);
    add(g.white_player_id, pts.white);
    if (g.black_player_id) add(g.black_player_id, pts.black);
  }
  return scores;
}

/** Map each player to the list of opponent ids they actually faced (no byes). */
export function opponentsOf(games: Game[]): Map<string, string[]> {
  const opps = new Map<string, string[]>();
  const add = (id: string, opp: string) => {
    const list = opps.get(id) ?? [];
    list.push(opp);
    opps.set(id, list);
  };
  for (const g of games) {
    if (!isResolved(g.status) || !g.black_player_id) continue;
    add(g.white_player_id, g.black_player_id);
    add(g.black_player_id, g.white_player_id);
  }
  return opps;
}

/** Buchholz = sum of each opponent's total score. */
export function computeBuchholz(games: Game[]): Map<string, number> {
  const scores = computeScores(games);
  const opps = opponentsOf(games);
  const buch = new Map<string, number>();
  for (const [id, list] of opps) {
    buch.set(
      id,
      list.reduce((sum, oppId) => sum + (scores.get(oppId) ?? 0), 0),
    );
  }
  return buch;
}

/** Full ranked standings for the board. */
export function computeStandings(
  players: Player[],
  games: Game[],
  opts: StandingsOptions = {},
): StandingRow[] {
  if (opts.tiebreaks && opts.rounds) return configuredStandings(players, games, opts);
  const scores = computeScores(games);
  const buch = computeBuchholz(games);

  const rows = players
    .filter((p) => p.status === "active")
    .map((p) => ({
      playerId: p.id,
      displayName: p.display_name,
      score: scores.get(p.id) ?? 0,
      tiebreak: buch.get(p.id) ?? 0,
      rank: 0,
    }));

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.tiebreak !== a.tiebreak) return b.tiebreak - a.tiebreak;
    return a.displayName.localeCompare(b.displayName, "no");
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** True for a game that was never actually played (walkover / opponent absent).
 * FIDE: such a game gives points but is neither a meeting nor a colour. */
export function isUnplayed(g: Pick<Game, "result_source">): boolean {
  return !!g.result_source && FORFEIT_SOURCES.has(g.result_source);
}

/** Pairs that have already played (for the no-rematch constraint). Unplayed
 * (forfeit) games do not count as a meeting. */
export function metBeforeSet(games: Game[]): Set<string> {
  const set = new Set<string>();
  for (const g of games) {
    if (!g.black_player_id || isUnplayed(g)) continue;
    const a = g.white_player_id;
    const b = g.black_player_id;
    set.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return set;
}

/** Player ids who have already had a bye. */
export function hadByeSet(games: Game[]): Set<string> {
  const set = new Set<string>();
  for (const g of games) if (g.status === "bye") set.add(g.white_player_id);
  return set;
}

/** How many byes each player has had — for even bye distribution (a second/third
 * bye is a second/third free point, so spread them). */
export function byeCounts(games: Game[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of games) {
    if (g.status === "bye") {
      counts.set(g.white_player_id, (counts.get(g.white_player_id) ?? 0) + 1);
    }
  }
  return counts;
}

/** White/black counts per player, for colour balancing in pairing. */
export function colorCounts(
  games: Game[],
): Map<string, { white: number; black: number }> {
  const counts = new Map<string, { white: number; black: number }>();
  const bump = (id: string, side: "white" | "black") => {
    const c = counts.get(id) ?? { white: 0, black: 0 };
    c[side]++;
    counts.set(id, c);
  };
  for (const g of games) {
    if (g.status === "bye" || isUnplayed(g)) continue; // byes / forfeits have no colour
    bump(g.white_player_id, "white");
    if (g.black_player_id) bump(g.black_player_id, "black");
  }
  return counts;
}

function configuredStandings(
  players: Player[],
  games: Game[],
  opts: StandingsOptions,
): StandingRow[] {
  const order = opts.tiebreaks!;
  const active = players.filter((p) => p.status === "active");
  const table = computeTiebreakStandings(
    active.map((p) => ({ id: p.id })),
    gamesToHistory(games, opts.rounds!),
    order,
  );
  const byId = new Map(active.map((p) => [p.id, p]));
  const rows: StandingRow[] = [];
  for (const t of table) {
    const p = byId.get(t.playerId);
    if (!p) continue; // spillere som har forlatt turneringen dukker ikke opp
    rows.push({
      playerId: p.id,
      displayName: p.display_name,
      score: t.score,
      tiebreak: t.values[order[0]] ?? 0,
      tiebreaks: t.values,
      rank: 0,
    });
  }
  // Motoren gir delt rang ved full likhet; brettet viser fortsatt entydig rekkefølge (navn).
  const tbRank = new Map(table.map((t) => [t.playerId, t.rank]));
  rows.sort(
    (a, b) =>
      tbRank.get(a.playerId)! - tbRank.get(b.playerId)! ||
      a.displayName.localeCompare(b.displayName, "no"),
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
