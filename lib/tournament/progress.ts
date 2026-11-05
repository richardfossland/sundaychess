// Round-progress line for the waiting room (between-rounds / bye screens).
// Pure — no React, no fetching — so it's covered directly by unit tests
// instead of only through the component that renders it.

import type { BoardState } from "@/lib/dto";
import {
  bracketRounds,
  cupBracketSize,
  effectivePlayoffSize,
} from "@/lib/tournament/bracket";

type Round = BoardState["rounds"][number];

export interface WaitingProgress {
  /** "Runde n av N · X partier igjen", or "Venter på at arrangøren starter
   * runde n+1" once every game in the current round is resolved. */
  label: string;
  /** The current round number, and how many of its games are still live. With
   * `live === 0` the round is over and the next one waits for the host — the
   * waiting room then says "Venter på runde n+1" once instead of two lines. */
  round: number;
  live: number;
  /** Every game of the LAST round is done and nothing follows (no playoff
   * left to start): the host only has to finish the tournament, so the
   * waiting room must not promise a "round n+1" that will never come. */
  awaitingFinish: boolean;
  /** The current round's timer, ready for a compact <RoundTimer>. Null when no
   * timer is configured for the tournament, or the round hasn't started yet. */
  timer: { startedAt: string | null; durationSec: number; extendedMs: number } | null;
}

/** Total rounds for the tournament's CURRENT phase — the denominator in
 * "Runde n av N". League: the wizard's fixed round count. Playoff/cup: derived
 * from the same bracket-size formula the server used to build round 1 (mirrors
 * lib/server/playoff.ts's maybeStartPlayoff/startCup), using the CURRENT
 * active-player count — stable once the bracket has started, since players
 * are never removed from the roster, only excluded from later rounds. */
function totalRounds(state: BoardState): number {
  const { tournament, players } = state;
  if (tournament.status !== "playoff") return tournament.config.leagueRounds;
  const active = players.filter((p) => p.status === "active").length;
  const size =
    tournament.config.format === "cup"
      ? cupBracketSize(active)
      : effectivePlayoffSize(tournament.config.playoffSize, active);
  return bracketRounds(size);
}

/** Is `playerId` out of the running for the CURRENT playoff round? Either not
 * present in any of its games (the bracket has moved on without them), or
 * they LOST their decided game in it — a knockout loss is final, so between
 * rounds the loser must not be told to wait for the next one. A draw is not a
 * loss here: knockout draws are settled by a separate rule. Always false
 * outside a playoff — league byes/waits are never "eliminated". */
function eliminatedFromRound(
  state: BoardState,
  playerId: string,
  round: Round | undefined,
): boolean {
  if (state.tournament.status !== "playoff" || !round) return false;
  const mine = state.games.find(
    (g) =>
      g.roundId === round.id &&
      (g.whitePlayerId === playerId || g.blackPlayerId === playerId),
  );
  if (!mine) return true;
  return (
    (mine.status === "white_win" && mine.blackPlayerId === playerId) ||
    (mine.status === "black_win" && mine.whitePlayerId === playerId)
  );
}

/** The CURRENT playoff round's elimination check, for the waiting room. */
export function eliminatedFromCurrentPlayoff(
  state: BoardState,
  playerId: string,
): boolean {
  const round = state.rounds.find(
    (r) => r.phase === "playoff" && r.number === state.tournament.currentRound,
  );
  return eliminatedFromRound(state, playerId, round);
}

/** What (if anything) the waiting room should tell `me` about the current
 * round: how far the tournament has gotten, how many games are still live,
 * and — when configured — the round timer. Null when there's nothing to
 * report: the lobby, a finished tournament, a round that hasn't been created
 * yet, or `me` themself is out of the current (playoff) round. */
export function waitingProgress(
  state: BoardState,
  me: { playerId: string },
): WaitingProgress | null {
  const { tournament, rounds, games } = state;
  if (tournament.status === "lobby" || tournament.status === "finished") {
    return null;
  }

  const phase = tournament.status === "playoff" ? "playoff" : "league";
  const round = rounds.find(
    (r) => r.phase === phase && r.number === tournament.currentRound,
  );
  if (!round) return null;
  if (eliminatedFromRound(state, me.playerId, round)) return null;

  const total = totalRounds(state);
  const live = games.filter(
    (g) => g.roundId === round.id && g.status === "live",
  ).length;

  // A league followed by a playoff still has a "next round"; otherwise the
  // last round is the end.
  const awaitingFinish =
    live === 0 &&
    tournament.currentRound >= total &&
    !(tournament.status === "league" && tournament.config.playoff);

  const label =
    live > 0
      ? `Runde ${tournament.currentRound} av ${total} · ${live} partier igjen`
      : awaitingFinish
        ? "Venter på at arrangøren avslutter turneringen"
        : `Venter på at arrangøren starter runde ${tournament.currentRound + 1}`;

  const timerSec = tournament.config.roundTimerSec;
  const timer =
    timerSec && round.startedAt
      ? {
          startedAt: round.startedAt,
          durationSec: timerSec,
          extendedMs: round.extendedMs,
        }
      : null;

  return { label, round: tournament.currentRound, live, awaitingFinish, timer };
}

/** Should the waiting room offer "play solo while you wait" (linking out to
 * /solo)? True once there is nothing left for `playerId` to do right now:
 *  - marked "left" (a walkover / lobby ghost-kick that outlived the lobby —
 *    mirrors WaitingRoom's own component-local `isOut`, first branch), or
 *  - eliminated from the CURRENT playoff round (reuses `eliminatedFromRound`
 *    above — same `isOut` second branch; a knockout loss is final, so unlike
 *    the league branch below, "waiting between playoff rounds" alone doesn't
 *    count), or
 *  - in a LEAGUE round: has a bye, or already finished their game while other
 *    boards are still live (their most recent game exists and isn't "live").
 * Always false in the lobby (nothing paired yet) or once the tournament is
 * "finished" (the final-results card owns that screen instead). */
export function offerSoloWhileWaiting(state: BoardState, playerId: string): boolean {
  const { tournament, players, games, rounds } = state;
  if (tournament.status === "lobby" || tournament.status === "finished") {
    return false;
  }

  const me = players.find((p) => p.id === playerId);
  if (me?.status === "left" || me?.status === "kicked") return true;

  if (tournament.status === "playoff") {
    const round = rounds.find(
      (r) => r.phase === "playoff" && r.number === tournament.currentRound,
    );
    return eliminatedFromRound(state, playerId, round);
  }

  const mine = games.filter(
    (g) => g.whitePlayerId === playerId || g.blackPlayerId === playerId,
  );
  if (mine.length === 0) return false;
  const current = mine.find((g) => g.status === "live") ?? mine[mine.length - 1];
  return current.status !== "live";
}
