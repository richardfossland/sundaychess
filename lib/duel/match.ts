// Duel (1v1) match logic. Pure functions — no DB, no I/O — so the race-to-K
// scoring, colour alternation and "is the match decided" rules are fully unit
// tested and shared by the server (advance) and the client (room UI).
//
// A duel is modelled as a Tournament with config.format = "duel" and exactly
// two players. Each game is one round. The match is a RACE: first to
// clinchTarget(bestOf) points wins (win 1, draw ½), colours alternating every
// game. Because draws give ½, a best-of-3 (target 2) may need a 4th game when
// players keep splitting points — that's intentional and natural ("first to 2").

import type { Game, GameStatus } from "@/lib/types";
import { pointsFor, isResolved } from "@/lib/tournament/score";

export type DuelGameOutcome = "p1" | "p2" | "draw";

/** Points needed to clinch the match. bestOf 1→1, 3→2, 5→3. */
export function clinchTarget(bestOf: number): number {
  const n = Number.isFinite(bestOf) && bestOf >= 1 ? Math.floor(bestOf) : 1;
  return Math.floor(n / 2) + 1;
}

/** Allowed match lengths. Anything else clamps to the nearest sensible value. */
export function normalizeBestOf(bestOf: unknown): number {
  const n = typeof bestOf === "number" ? Math.round(bestOf) : NaN;
  return [1, 3, 5].includes(n) ? n : 1;
}

/** Which of the two players is White in game `gameIndex` (0-based). Player 1
 * (the duel creator) takes White in even games; colours alternate after that. */
export function whiteForGame(
  gameIndex: number,
  p1Id: string,
  p2Id: string,
): string {
  return gameIndex % 2 === 0 ? p1Id : p2Id;
}

export interface DuelState {
  p1Id: string;
  p2Id: string;
  p1Score: number;
  p2Score: number;
  /** Resolved games so far (excludes the live one). */
  gamesPlayed: number;
  /** Points needed to win the match. */
  target: number;
  /** Per-game outcomes from p1's perspective, in play order. */
  results: DuelGameOutcome[];
  /** True once a player has reached `target`. */
  decided: boolean;
  /** Winner id once decided, else null. */
  winnerId: string | null;
  /** Who is ahead right now (null on a tie). */
  leaderId: string | null;
}

/** Minimal game shape the scoring core needs. Both the server's `Game` and the
 * client's `PublicGame` satisfy it. */
export interface DuelGameLike {
  whitePlayerId: string;
  blackPlayerId: string | null;
  status: GameStatus;
}

/** Compute the full duel state from games ALREADY in chronological (play)
 * order. The client passes the API's pre-sorted PublicGame list; the server
 * sorts `Game[]` by updated_at via {@link duelState}. */
export function duelStateOrdered(
  ordered: DuelGameLike[],
  p1Id: string,
  p2Id: string,
  bestOf: number,
): DuelState {
  const target = clinchTarget(bestOf);
  const resolved = ordered.filter(
    (g) => isResolved(g.status) && g.blackPlayerId !== null,
  );

  let p1Score = 0;
  let p2Score = 0;
  const results: DuelGameOutcome[] = [];

  for (const g of resolved) {
    const pts = pointsFor(g.status);
    const p1White = g.whitePlayerId === p1Id;
    const p1Pts = p1White ? pts.white : pts.black;
    const p2Pts = p1White ? pts.black : pts.white;
    p1Score += p1Pts;
    p2Score += p2Pts;
    results.push(p1Pts === p2Pts ? "draw" : p1Pts > p2Pts ? "p1" : "p2");
  }

  const decided = p1Score >= target || p2Score >= target;
  const winnerId = !decided
    ? null
    : p1Score >= target && p1Score >= p2Score
      ? p1Id
      : p2Id;
  const leaderId =
    p1Score === p2Score ? null : p1Score > p2Score ? p1Id : p2Id;

  return {
    p1Id,
    p2Id,
    p1Score,
    p2Score,
    gamesPlayed: resolved.length,
    target,
    results,
    decided,
    winnerId,
    leaderId,
  };
}

/** Server-side: compute duel state from raw `Game[]`, sorting by updated_at to
 * recover play order. */
export function duelState(
  games: Game[],
  p1Id: string,
  p2Id: string,
  bestOf: number,
): DuelState {
  const ordered = games
    .slice()
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .map((g) => ({
      whitePlayerId: g.white_player_id,
      blackPlayerId: g.black_player_id,
      status: g.status,
    }));
  return duelStateOrdered(ordered, p1Id, p2Id, bestOf);
}

/** The colour assignment for the NEXT game of an undecided duel. gameIndex is
 * the count of games created so far (resolved + any live). */
export function nextGameColours(
  gameIndex: number,
  p1Id: string,
  p2Id: string,
): { whitePlayerId: string; blackPlayerId: string } {
  const whitePlayerId = whiteForGame(gameIndex, p1Id, p2Id);
  return {
    whitePlayerId,
    blackPlayerId: whitePlayerId === p1Id ? p2Id : p1Id,
  };
}

/** Does a live (unresolved, real) game already exist? Guards double-advance. */
export function hasLiveGame(games: Game[]): boolean {
  return games.some((g) => (g.status as GameStatus) === "live");
}
